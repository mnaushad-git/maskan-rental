"""Saved-search alert & notification background work — runs on the
`notifications` Celery queue (see app/core/celery_app.py).

Flow (Phase 5): outbox publisher fires a registered handler for a property/
mediator event -> handler enqueues `match_property_event` via
`app.core.jobs.enqueue()` (so it degrades to inline execution if the broker
is down, same as every other async path in this app) -> matching writes
durable `SavedSearchMatch` rows (deduped via Redis pre-check + a DB unique
constraint) -> instant-frequency matches immediately create+deliver a
`Notification`; daily/weekly-frequency matches wait for the per-user
bucketed digest scheduler (`run_digest_bucket`, Phase 5) below to pick them
up. Generic lead notifications (Phase 3) live in the sibling module
`app.tasks.lead_notifications` but call back into `_deliver`/`_effective_channels`
here so both notification sources share one delivery pipeline.
"""
import logging
from contextlib import nullcontext
from datetime import date, datetime, timedelta, timezone

import redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.distributed_lock import redis_lock
from app.core.feature_flags import is_enabled
from app.core.metrics import (
    alerts_generated_total,
    digest_delivered_total,
    digest_failed_total,
    digest_generated_total,
    notification_delivery_total,
    notifications_created_total,
    push_accepted_total,
    push_attempted_total,
    push_failed_total,
    push_invalid_token_total,
)
from app.core.notification_providers import get_email_provider, get_push_provider
from app.core.notification_stream import publish_invalidate
from app.core.notification_templates import render
from app.core.outbox import EventType
from app.core.redis_client import get_redis_client, is_redis_available
from app.db.session import SessionLocal
from app.models.device import Device
from app.models.digest_run import DigestRun
from app.models.notification import Notification
from app.models.notification_delivery import NotificationDelivery
from app.models.notification_preference import NotificationPreference
from app.models.property import Property
from app.models.saved_search import SavedSearch
from app.models.saved_search_match import SavedSearchMatch
from app.services.ai_alert_explainer import rule_based_explanation, should_enrich
from app.services.digest_scheduler import in_quiet_hours, next_daily_run, next_weekly_run, reschedule
from app.services.saved_search_matcher import MatchCandidate, evaluate_property_change
from app.tasks.outbox import register_handler

logger = logging.getLogger("app.tasks.notifications")

DEDUPE_TTL_SECONDS = 24 * 60 * 60
PUSH_DEDUPE_TTL_SECONDS = 60 * 60

_CATEGORY_BY_TYPE_PREFIX = (
    ("saved_search_price_", "price_changes"),
    ("saved_search_digest", "saved_search_digest"),
    ("saved_search_", "property_alerts"),
    ("lead_message", "lead_messages"),
    ("lead_", "lead_updates"),
    ("review_", "review_updates"),
    ("subscription_", "subscription_payments"),
    ("ai_recommendation", "ai_recommendations"),
    ("property_request_", "property_request_updates"),
    ("security", "security"),
)


def category_for_type(notification_type: str) -> str:
    for prefix, category in _CATEGORY_BY_TYPE_PREFIX:
        if notification_type.startswith(prefix):
            return category
    return "product_announcements"


def _best_effort_lock(name: str, *, ttl_seconds: int):
    """`app.core.distributed_lock.redis_lock` treats "Redis unavailable" the
    same as "someone else holds the lock" (both report `acquired=False`) —
    the right call for the recurring outbox publisher (skip this tick, the
    next one in 15s retries), but wrong here: these are one-shot reactions
    to a specific event/day, nothing else will ever retry them, so treating
    "Redis is down" as "permanently drop this alert/digest" would silently
    lose data. This wrapper only skips on genuine contention (Redis up, lock
    held by another worker); when Redis itself is unavailable it proceeds
    without the lock — correctness still holds via the DB unique constraints
    on SavedSearchMatch / DigestRun, the lock is purely a work-avoidance
    optimization, never the source of truth."""
    if not is_redis_available():
        return nullcontext(True)
    return redis_lock(name, ttl_seconds=ttl_seconds, blocking_timeout=2)


# ── Outbox event handlers: hand off to Celery, keep the publisher batch fast ──

def _enqueue_match(event) -> None:
    from app.core.jobs import enqueue

    enqueue(match_property_event, event.event_type, event.aggregate_id, event.payload, event.trace_id)


@register_handler(EventType.PROPERTY_PUBLISHED)
def _on_property_published(event) -> None:
    _enqueue_match(event)


@register_handler(EventType.PROPERTY_PRICE_CHANGED)
def _on_property_price_changed(event) -> None:
    _enqueue_match(event)


@register_handler(EventType.PROPERTY_UPDATED)
def _on_property_updated(event) -> None:
    if event.payload.get("detail_changed"):
        _enqueue_match(event)


@register_handler(EventType.MEDIATOR_VERIFIED)
def _on_mediator_verified(event) -> None:
    _enqueue_match(event)


# ── Matching ────────────────────────────────────────────────────────────────

def _redis_dedupe_seen(saved_search_id: int, property_id: int, change_hash: str) -> bool:
    """True if this exact (saved search, property, change) was already
    dispatched recently. Best-effort speed-up only — the real guarantee is
    the DB unique constraint on SavedSearchMatch, checked regardless."""
    client = get_redis_client()
    if client is None:
        return False
    key = f"maskan:alert:dedupe:{saved_search_id}:{property_id}:{change_hash}"
    try:
        return not client.set(key, "1", nx=True, ex=DEDUPE_TTL_SECONDS)
    except redis.RedisError as exc:
        logger.warning("_redis_dedupe_seen: Redis error, proceeding without dedupe cache: %s", exc)
        return False


def _process_property_change(
    db: Session,
    prop: Property,
    *,
    change_type: str,
    change_context: dict,
    event_id: str,
    trace_id: str | None,
) -> int:
    candidates = evaluate_property_change(db, prop, change_type=change_type, change_context=change_context)
    created = 0
    for cand in candidates:
        if _redis_dedupe_seen(cand.saved_search.id, prop.id, cand.change_hash):
            continue

        match = SavedSearchMatch(
            saved_search_id=cand.saved_search.id,
            user_id=cand.saved_search.user_id,
            property_id=prop.id,
            change_type=cand.change_type,
            change_hash=cand.change_hash,
            match_reasons=cand.match_reasons,
            match_score=cand.match_score,
            event_id=event_id,
            trace_id=trace_id,
        )
        try:
            with db.begin_nested():
                db.add(match)
                db.flush()
        except IntegrityError:
            continue  # already recorded (DB unique constraint caught a race) — not a new match

        cand.saved_search.last_evaluated_at = datetime.now(timezone.utc)
        created += 1
        alerts_generated_total.labels(change_type=cand.change_type).inc()

        channels = cand.saved_search.channels or ["in_app"]
        if cand.saved_search.alert_frequency == "instant" and "in_app" in channels:
            _create_and_deliver_notification(db, match, cand, prop)
        # daily/weekly frequency: match stays notified=False; the bucketed
        # digest scheduler (run_digest_bucket) picks it up later.
    return created


@celery_app.task(
    name="app.tasks.notifications.match_property_event",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    max_retries=5,
)
def match_property_event(self, event_type: str, aggregate_id: str, payload: dict, trace_id: str | None = None) -> dict:
    if not is_enabled("saved_search_alerts"):
        return {"skipped": "feature_disabled"}

    event_id = f"{event_type}:{aggregate_id}:{payload.get('new_price', payload.get('detail_changed', ''))}"

    with _best_effort_lock(f"alert-event:{event_type}:{aggregate_id}", ttl_seconds=120) as acquired:
        if not acquired:
            logger.info("match_property_event(%s, %s): another worker holds the lock, skipping", event_type, aggregate_id)
            return {"skipped": "locked"}

        db = SessionLocal()
        try:
            if event_type == EventType.MEDIATOR_VERIFIED:
                mediator_id = int(aggregate_id)
                props = db.scalars(
                    select(Property).where(Property.mediator_id == mediator_id, Property.status == "Published")
                ).all()
                total = sum(
                    _process_property_change(db, prop, change_type="verified", change_context={}, event_id=event_id, trace_id=trace_id)
                    for prop in props
                )
                db.commit()
                return {"matches": total}

            property_id = int(aggregate_id)
            prop = db.get(Property, property_id)
            if not prop:
                return {"skipped": "property_not_found"}

            if event_type == EventType.PROPERTY_PUBLISHED:
                change_type = "back_on_market" if payload.get("republished") else "new_listing"
            elif event_type == EventType.PROPERTY_PRICE_CHANGED:
                change_type = "price_drop" if payload.get("direction") == "down" else "price_increase"
            elif event_type == EventType.PROPERTY_UPDATED and payload.get("detail_changed"):
                change_type = "detail_updated"
            else:
                return {"matches": 0}

            count = _process_property_change(db, prop, change_type=change_type, change_context=payload, event_id=event_id, trace_id=trace_id)
            db.commit()
            return {"matches": count}
        finally:
            db.close()


# ── Notification creation + delivery ────────────────────────────────────────

def _create_and_deliver_notification(db: Session, match: SavedSearchMatch, cand: MatchCandidate, prop: Property) -> Notification:
    saved_search = cand.saved_search
    title, body, deep_link = render(change_type=cand.change_type, prop=prop, saved_search=saved_search, change_context=cand.change_context)
    notification_type = f"saved_search_{cand.change_type}" if cand.change_type != "price_increase" else "saved_search_price_drop"

    notification = Notification(
        user_id=saved_search.user_id,
        type=notification_type,
        title=title,
        body=body,
        locale=saved_search.locale,
        entity_type="property",
        entity_id=prop.id,
        saved_search_id=saved_search.id,
        property_id=prop.id,
        match_reasons=cand.match_reasons,
        deep_link=deep_link,
        delivery_status={},
        meta={"rule_based_explanation": rule_based_explanation(match_reasons=cand.match_reasons, locale=saved_search.locale)},
        trace_id=match.trace_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.NOTIFICATION_RETENTION_DAYS),
    )
    db.add(notification)
    db.flush()

    match.notified = True
    match.notification_id = notification.id
    saved_search.last_notified_at = datetime.now(timezone.utc)

    notifications_created_total.labels(type=notification_type).inc()
    _deliver(db, notification, saved_search.channels or ["in_app"])

    if should_enrich(cand.change_type):
        from app.core.jobs import enqueue

        enqueue(enrich_notification_task, notification.id)

    _invalidate_unread_count_cache(saved_search.user_id)
    publish_invalidate(saved_search.user_id, reason=notification_type)
    return notification


def _load_or_create_preferences(db: Session, user_id: int) -> NotificationPreference:
    prefs = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    if prefs is None:
        prefs = NotificationPreference(user_id=user_id)
        db.add(prefs)
        db.flush()  # materializes column defaults (digest_hour, timezone, ...) before reschedule() reads them
        reschedule(prefs)
    return prefs


def _record_delivery(
    db: Session,
    *,
    notification: Notification,
    device: Device | None,
    channel: str,
    provider: str,
    status: str,
    provider_message_id: str | None = None,
    failure_code: str | None = None,
    failure_message: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    db.add(
        NotificationDelivery(
            notification_id=notification.id,
            device_id=device.id if device else None,
            channel=channel,
            provider=provider,
            provider_message_id=provider_message_id,
            status=status,
            failure_code=failure_code,
            failure_message=(failure_message or "")[:500] or None,
            accepted_at=now if status in ("accepted", "sent", "delivered") else None,
            trace_id=notification.trace_id,
        )
    )


def _push_dedupe_seen(notification_id: int, device_id: int) -> bool:
    """Redis dedupe namespace `maskan:push:dedupe:{notification_id}:{device_id}`
    (Phase 11) — prevents a duplicate push send for the same
    notification/device pair if `_deliver` is somehow invoked twice for the
    same notification (e.g. an outbox/task redelivery). Best-effort only;
    NotificationDelivery rows are the durable audit trail regardless."""
    client = get_redis_client()
    if client is None:
        return False
    key = f"maskan:push:dedupe:{notification_id}:{device_id}"
    try:
        return not client.set(key, "1", nx=True, ex=PUSH_DEDUPE_TTL_SECONDS)
    except redis.RedisError:
        return False


def _apply_push_result(db: Session, device: Device, result) -> None:
    """Mutates `device` per Phase 2E retry rules: never retry invalid
    tokens (disable immediately), disable after PUSH_DEVICE_FAILURE_THRESHOLD
    consecutive transient failures, reset the counter on any success."""
    now = datetime.now(timezone.utc)
    provider_name = settings.PUSH_PROVIDER
    push_attempted_total.labels(provider=provider_name).inc()

    if result.status in ("accepted", "sent", "delivered"):
        push_accepted_total.labels(provider=provider_name).inc()
        device.last_success_push_at = now
        device.failure_count = 0
        return

    if result.status in ("unregistered_token", "permanent_rejection"):
        push_invalid_token_total.labels(provider=provider_name).inc()
        device.enabled = False
        device.invalidated_at = now
        device.last_failed_push_at = now
        logger.info("device %s disabled: %s (%s)", device.id, result.status, result.failure_code)
        return

    if result.status in ("failed", "provider_unavailable", "rate_limited"):
        push_failed_total.labels(provider=provider_name, reason=result.status).inc()
        device.last_failed_push_at = now
        device.failure_count += 1
        if device.failure_count >= settings.PUSH_DEVICE_FAILURE_THRESHOLD:
            device.enabled = False
            device.invalidated_at = now
            logger.info("device %s disabled after %s consecutive push failures", device.id, device.failure_count)


def _effective_push_email(db: Session, notification: Notification, requested_channels: list[str]) -> tuple[bool, bool, str, str]:
    """Resolves whether push/email should actually be attempted for this
    notification, applying (in order) the recipient's category preference,
    global channel toggles, and quiet hours (Phase 4). Returns
    (push_allowed, email_allowed, push_title, push_body) — `push_body` may
    be a generic placeholder instead of `notification.body` when the user
    has hidden message previews for message-shaped categories."""
    prefs = _load_or_create_preferences(db, notification.user_id)
    category = category_for_type(notification.type)
    cat_pref = (prefs.category_preferences or {}).get(category, {"channels": ["in_app", "push"], "frequency": "instant"})
    cat_channels = set(cat_pref.get("channels", []))
    is_off = cat_pref.get("frequency") == "off"
    is_security = category == "security"

    push_allowed = (
        not is_off
        and "push" in requested_channels
        and "push" in cat_channels
        and prefs.push_enabled
        and settings.FEATURE_PUSH_NOTIFICATIONS
    )
    if push_allowed and is_enabled("notification_quiet_hours"):
        quiet = in_quiet_hours(prefs)
        if quiet and not (is_security and prefs.quiet_hours_allow_urgent):
            push_allowed = False

    email_allowed = not is_off and "email" in requested_channels and "email" in cat_channels and prefs.email_enabled

    push_title, push_body = notification.title, notification.body
    if category == "lead_messages" and prefs.hide_message_preview and is_enabled("notification_message_preview"):
        push_title = "New message" if notification.locale != "ar" else "رسالة جديدة"
        push_body = "You have a new message. Open the app to view it." if notification.locale != "ar" else "لديك رسالة جديدة. افتح التطبيق لعرضها."

    return push_allowed, email_allowed, push_title, push_body


def _deliver(db: Session, notification: Notification, channels: list[str]) -> None:
    """In-app delivery is implicit (the row exists — the client fetches it).
    Push is dispatched (batched across all of the recipient's enabled
    devices) through the provider abstraction and every attempt is recorded
    durably in `notification_deliveries` (Phase 13) — Redis/provider logs
    are never the only record. Email goes through the same
    provider-abstraction pattern, still a no-op today (no SendGrid key
    configured — see app.core.notification_providers)."""
    delivery_status = dict(notification.delivery_status or {})
    delivery_status["in_app"] = "delivered"
    _record_delivery(db, notification=notification, device=None, channel="in_app", provider="internal", status="delivered")

    push_allowed, email_allowed, push_title, push_body = _effective_push_email(db, notification, channels)

    if push_allowed:
        devices = db.scalars(
            select(Device).where(Device.user_id == notification.user_id, Device.enabled == True)  # noqa: E712
        ).all()
        sendable = [d for d in devices if not _push_dedupe_seen(notification.id, d.id)] if devices else []
        if sendable:
            provider = get_push_provider()
            sends = [(d, notification, push_title, push_body, None) for d in sendable]
            results = provider.send_batch(sends)
            any_success = False
            for device, result in zip(sendable, results):
                notification_delivery_total.labels(channel="push", status=result.status).inc()
                _apply_push_result(db, device, result)
                _record_delivery(
                    db, notification=notification, device=device, channel="push", provider=settings.PUSH_PROVIDER,
                    status=result.status, provider_message_id=result.provider_message_id,
                    failure_code=result.failure_code, failure_message=result.detail,
                )
                any_success = any_success or result.status in ("accepted", "sent", "delivered")
            delivery_status["push"] = "delivered" if any_success else "failed"
        else:
            delivery_status["push"] = "skipped"
    elif "push" in channels:
        delivery_status["push"] = "skipped"

    if email_allowed:
        prefs = _load_or_create_preferences(db, notification.user_id)
        if prefs.email_enabled:
            from app.models.user import User

            user = db.get(User, notification.user_id)
            provider = get_email_provider()
            result = provider.send(to_email=user.email, subject=notification.title, body=notification.body) if user else None
            if result:
                notification_delivery_total.labels(channel="email", status=result.status).inc()
                delivery_status["email"] = result.status
                _record_delivery(db, notification=notification, device=None, channel="email", provider="sendgrid", status=result.status, failure_message=result.detail)
        else:
            delivery_status["email"] = "skipped"
    elif "email" in channels:
        delivery_status["email"] = "skipped"

    notification_delivery_total.labels(channel="in_app", status="delivered").inc()
    notification.delivery_status = delivery_status


def _invalidate_unread_count_cache(user_id: int) -> None:
    client = get_redis_client()
    if client is None:
        return
    try:
        client.delete(f"maskan:cache:v1:notifications:unread:{user_id}")
    except redis.RedisError as exc:
        logger.warning("_invalidate_unread_count_cache(%s): Redis error: %s", user_id, exc)


@celery_app.task(name="app.tasks.notifications.enrich_notification_task", bind=True, autoretry_for=(Exception,), retry_backoff=True, max_retries=2)
def enrich_notification_task(self, notification_id: int) -> dict:
    from app.services.ai_alert_explainer import enrich_notification_with_ai

    db = SessionLocal()
    try:
        notification = db.get(Notification, notification_id)
        if not notification:
            return {"skipped": "not_found"}
        enrich_notification_with_ai(db, notification)
        db.commit()
        return {"ai_generated": notification.ai_generated}
    finally:
        db.close()


@celery_app.task(
    name="app.tasks.notifications.deliver_push_notification",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=3,
)
def deliver_push_notification(self, notification_id: int, device_id: int) -> dict:
    """Standalone redelivery task (Phase 12/9E) — used by the admin "retry
    failed delivery" action, not the normal instant-alert path (which
    delivers inline via `_deliver` for lower latency). Idempotent: reuses
    the same Redis dedupe key as `_deliver`, so retrying an already-delivered
    notification/device pair is a safe no-op."""
    db = SessionLocal()
    try:
        notification = db.get(Notification, notification_id)
        device = db.get(Device, device_id)
        if not notification or not device or not device.enabled:
            return {"skipped": "not_found_or_disabled"}
        if _push_dedupe_seen(notification_id, device_id):
            return {"skipped": "already_delivered"}
        provider = get_push_provider()
        result = provider.send(device, notification, title=notification.title, body=notification.body)
        _apply_push_result(db, device, result)
        _record_delivery(
            db, notification=notification, device=device, channel="push", provider=settings.PUSH_PROVIDER,
            status=result.status, provider_message_id=result.provider_message_id,
            failure_code=result.failure_code, failure_message=result.detail,
        )
        notification_delivery_total.labels(channel="push", status=result.status).inc()
        db.commit()
        return {"status": result.status}
    finally:
        db.close()


# ── Digests (Phase 5/6) ──────────────────────────────────────────────────────

def _run_digest_for_user(db: Session, user_id: int, *, period: str, run_date: date) -> int:
    """Compile + create one digest Notification for un-notified matches on
    this user's daily/weekly-frequency saved searches. Guarded by a unique
    (user_id, period, run_date) row in Postgres — inserted first, inside the
    same transaction as the digest itself — so a duplicate scheduler tick or
    task redelivery can never send the same digest twice, independent of
    Redis. Returns the number of matches included (0 if nothing to send or
    already run)."""
    existing = db.scalar(
        select(DigestRun).where(DigestRun.user_id == user_id, DigestRun.period == period, DigestRun.run_date == run_date)
    )
    if existing is not None:
        return 0

    max_per_digest = 12 if period == "daily" else 30
    matches = db.scalars(
        select(SavedSearchMatch)
        .join(SavedSearch, SavedSearchMatch.saved_search_id == SavedSearch.id)
        .where(
            SavedSearchMatch.user_id == user_id,
            SavedSearchMatch.notified == False,  # noqa: E712
            SavedSearch.alert_frequency == period,
            SavedSearch.status == "active",
            SavedSearch.alert_enabled == True,  # noqa: E712
        )
        .order_by(SavedSearchMatch.match_score.desc(), SavedSearchMatch.created_at.desc())
    ).all()

    db.add(DigestRun(user_id=user_id, period=period, run_date=run_date, notification_count=len(matches)))

    if not matches:
        db.commit()
        return 0

    by_search: dict[int, list[SavedSearchMatch]] = {}
    for m in matches:
        by_search.setdefault(m.saved_search_id, []).append(m)

    total_notified = 0
    for saved_search_id, search_matches in by_search.items():
        saved_search = db.get(SavedSearch, saved_search_id)
        if saved_search is None:
            continue
        capped = search_matches[:max_per_digest]
        prop_ids = [m.property_id for m in capped]
        first_prop = db.get(Property, prop_ids[0]) if prop_ids else None
        if first_prop is None:
            continue

        title, body, deep_link = render(
            change_type="digest", prop=first_prop, saved_search=saved_search, change_context={"count": len(search_matches)}
        )
        notification = Notification(
            user_id=user_id,
            type="saved_search_digest",
            title=title,
            body=body,
            locale=saved_search.locale,
            entity_type="saved_search",
            entity_id=saved_search.id,
            saved_search_id=saved_search.id,
            match_reasons=[{"code": "digest", "count": len(search_matches), "property_ids": prop_ids}],
            deep_link=deep_link,
            delivery_status={},
            meta={"period": period},
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.NOTIFICATION_RETENTION_DAYS),
        )
        db.add(notification)
        db.flush()
        for m in search_matches:
            m.notified = True
            m.notification_id = notification.id
        saved_search.last_notified_at = datetime.now(timezone.utc)
        notifications_created_total.labels(type="saved_search_digest").inc()
        channels = saved_search.channels or ["in_app"]
        _deliver(db, notification, channels)
        total_notified += 1

    db.commit()
    if total_notified:
        _invalidate_unread_count_cache(user_id)
        publish_invalidate(user_id, reason="saved_search_digest")
        digest_delivered_total.labels(period=period).inc()
        digest_generated_total.labels(period=period).inc()
    return total_notified


def _eligible_user_ids(db: Session, *, period: str) -> list[int]:
    return list(
        db.scalars(
            select(SavedSearch.user_id)
            .where(SavedSearch.alert_frequency == period, SavedSearch.status == "active", SavedSearch.alert_enabled == True)  # noqa: E712
            .distinct()
        ).all()
    )


def _run_digest(*, period: str) -> dict:
    """Legacy single-shot fixed-cron entrypoint. Kept for admin "re-run
    digest for a user" tooling (Phase 9E) and existing tests; the production
    schedule now runs through the per-user bucketed `run_digest_bucket`
    below (Phase 5), not this function."""
    if not is_enabled("daily_digest" if period == "daily" else "weekly_digest"):
        return {"skipped": "feature_disabled"}

    run_date = datetime.now(timezone.utc).date()
    with _best_effort_lock(f"digest:{period}:{run_date.isoformat()}", ttl_seconds=600) as acquired:
        if not acquired:
            return {"skipped": "locked"}
        db = SessionLocal()
        sent = 0
        failed = 0
        try:
            for user_id in _eligible_user_ids(db, period=period):
                try:
                    sent += 1 if _run_digest_for_user(db, user_id, period=period, run_date=run_date) else 0
                except Exception as exc:  # noqa: BLE001 — one user's failure must not abort the whole run
                    db.rollback()
                    failed += 1
                    digest_failed_total.labels(period=period).inc()
                    logger.error("_run_digest(%s): user %s failed: %s", period, user_id, exc)
            return {"sent": sent, "failed": failed}
        finally:
            db.close()


@celery_app.task(name="app.tasks.notifications.run_daily_digest")
def run_daily_digest() -> dict:
    return _run_digest(period="daily")


@celery_app.task(name="app.tasks.notifications.run_weekly_digest")
def run_weekly_digest() -> dict:
    return _run_digest(period="weekly")


# ── Per-user bucketed digest scheduler (Phase 5) ─────────────────────────────

DIGEST_BUCKET_LIMIT = 500  # per tick, per period — bounds worst-case tick duration


def _due_preference_ids(db: Session, *, column, now: datetime) -> list[int]:
    return list(
        db.scalars(
            select(NotificationPreference.id).where(column <= now).limit(DIGEST_BUCKET_LIMIT)
        ).all()
    )


def _run_digest_bucket_for_period(period: str) -> dict:
    if not is_enabled("per_user_digest_schedule"):
        return {"skipped": "feature_disabled"}
    if not is_enabled("daily_digest" if period == "daily" else "weekly_digest"):
        return {"skipped": "feature_disabled"}

    now = datetime.now(timezone.utc)
    db = SessionLocal()
    sent = 0
    failed = 0
    column = NotificationPreference.next_daily_digest_at if period == "daily" else NotificationPreference.next_weekly_digest_at
    try:
        pref_ids = _due_preference_ids(db, column=column, now=now)
        for pref_id in pref_ids:
            prefs = db.get(NotificationPreference, pref_id)
            if prefs is None:
                continue
            with _best_effort_lock(f"digest:lock:{prefs.user_id}:{period}", ttl_seconds=120) as acquired:
                if not acquired:
                    continue
                try:
                    run_date = datetime.now(timezone.utc).astimezone(_zone_or_utc(prefs.timezone)).date()
                    sent += 1 if _run_digest_for_user(db, prefs.user_id, period=period, run_date=run_date) else 0
                except Exception as exc:  # noqa: BLE001 — one user's failure must not abort the batch
                    db.rollback()
                    failed += 1
                    digest_failed_total.labels(period=period).inc()
                    logger.error("run_digest_bucket(%s): user %s failed: %s", period, prefs.user_id, exc)
                    prefs = db.get(NotificationPreference, pref_id)  # re-fetch after rollback
                    if prefs is None:
                        continue
                # Always reschedule the next run, success or failure — a
                # persistently-failing user must not jam the bucket by
                # staying "due" forever.
                now2 = datetime.now(timezone.utc)
                if period == "daily":
                    prefs.next_daily_digest_at = next_daily_run(digest_hour=prefs.digest_hour, tz_name=prefs.timezone, now=now2)
                else:
                    prefs.next_weekly_digest_at = next_weekly_run(digest_hour=prefs.digest_hour, weekly_day=prefs.weekly_digest_day, tz_name=prefs.timezone, now=now2)
                db.commit()
        return {"sent": sent, "failed": failed, "checked": len(pref_ids)}
    finally:
        db.close()


def _zone_or_utc(tz_name: str):
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


@celery_app.task(name="app.tasks.notifications.run_digest_bucket")
def run_digest_bucket() -> dict:
    """Runs every 15 minutes (see app/main.py scheduler). Processes every
    user whose `next_daily_digest_at`/`next_weekly_digest_at` has arrived —
    NOT "every user, once a day at a fixed hour" like the old cron jobs —
    so each user's digest fires at *their* configured local hour/weekday
    regardless of what time zone they're in."""
    daily = _run_digest_bucket_for_period("daily")
    weekly = _run_digest_bucket_for_period("weekly")
    return {"daily": daily, "weekly": weekly}
