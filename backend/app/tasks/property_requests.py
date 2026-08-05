"""Property Request matching background work (Phase 6/7) — runs on the
`notifications` Celery queue alongside saved-search matching, since it's the
same kind of workload (react to a property/request event, score, persist,
maybe notify).

Two entry points, both funnelling into the same persist+notify helpers:
  - `match_property_event`: reacts to a `property.*` outbox event — finds
    every active request this property could newly satisfy.
  - `backfill_request_matches`: reacts to `property_request.activated` /
    `.updated` / `.resumed` — finds every property this request could newly
    satisfy. Also directly callable for admin "retry matching".

Locking follows the app's existing `redis_lock`/`_best_effort_lock`
convention (app.core.distributed_lock, app.tasks.notifications) rather than
introducing a second locking scheme; lock *names* use the
`property-request:*` namespaces from the platform plan's Redis section.
Idempotency's real guarantee is always the DB unique constraint on
`PropertyRequestMatch(request_id, property_id)` — Redis locks/dedupe here are
work-avoidance optimizations only, never load-bearing (Phase 7: "Do not lose
matching work if Redis is unavailable").
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.feature_flags import is_enabled
from app.core.outbox import EventType
from app.db.session import SessionLocal
from app.models.property import Property
from app.models.property_request import PropertyRequest
from app.models.property_request_match import PropertyRequestMatch
from app.services import property_request_notifications
from app.services.property_request_matcher import MatchResult, match_properties_for_request, match_requests_for_property
from app.tasks.outbox import register_handler

logger = logging.getLogger("app.tasks.property_requests")


def _persist_match(db: Session, pr: PropertyRequest, result: MatchResult, *, event_id: str, trace_id: str | None) -> tuple[PropertyRequestMatch | None, bool, bool]:
    """Returns (match, is_new, is_meaningfully_improved). Idempotent: a
    retried job re-scoring the same (request, property) pair either finds
    the existing row (updates it, never re-notifies unless the score moved
    by more than the configured threshold) or safely handles a concurrent
    insert race via the unique constraint."""
    from app.core.config import settings

    existing = db.scalar(select(PropertyRequestMatch).where(PropertyRequestMatch.request_id == pr.id, PropertyRequestMatch.property_id == result.property.id))

    if existing is None:
        match = PropertyRequestMatch(
            request_id=pr.id,
            property_id=result.property.id,
            match_score=result.match_score,
            hard_pass=result.hard_pass,
            must_have_failures=result.must_have_failures,
            flexible_coverage=result.flexible_coverage,
            preference_score=result.preference_score,
            price_fit_score=result.price_fit_score,
            area_fit_score=result.area_fit_score,
            commute_fit_score=result.commute_fit_score,
            listing_quality_score=result.listing_quality_score,
            confidence=result.confidence,
            match_reasons=result.match_reasons,
            trade_offs=result.trade_offs,
            rejection_reasons=result.rejection_reasons,
            match_version=result.match_version,
            event_id=event_id,
            trace_id=trace_id,
        )
        try:
            with db.begin_nested():
                db.add(match)
                db.flush()
        except IntegrityError:
            existing = db.scalar(select(PropertyRequestMatch).where(PropertyRequestMatch.request_id == pr.id, PropertyRequestMatch.property_id == result.property.id))
            return existing, False, False
        return match, True, False

    old_score = existing.match_score
    existing.match_score = result.match_score
    existing.hard_pass = result.hard_pass
    existing.must_have_failures = result.must_have_failures
    existing.flexible_coverage = result.flexible_coverage
    existing.preference_score = result.preference_score
    existing.price_fit_score = result.price_fit_score
    existing.area_fit_score = result.area_fit_score
    existing.commute_fit_score = result.commute_fit_score
    existing.listing_quality_score = result.listing_quality_score
    existing.confidence = result.confidence
    existing.match_reasons = result.match_reasons
    existing.trade_offs = result.trade_offs
    existing.rejection_reasons = result.rejection_reasons
    existing.match_version = result.match_version
    existing.event_id = event_id
    existing.trace_id = trace_id
    is_improved = (result.match_score - old_score) >= settings.PROPERTY_REQUEST_MATCH_IMPROVEMENT_THRESHOLD
    return existing, False, is_improved


def _notify_if_needed(db: Session, pr: PropertyRequest, match: PropertyRequestMatch, prop: Property, *, is_new: bool, is_improved: bool) -> None:
    if pr.alert_frequency == "off" or not is_enabled("property_request_notifications"):
        return
    if is_new:
        property_request_notifications.create_and_deliver(db, request=pr, change_type="new_match", prop=prop, match=match)
    elif is_improved:
        property_request_notifications.create_and_deliver(db, request=pr, change_type="improved_match", prop=prop, match=match)


def _match_and_notify_for_property(db: Session, prop: Property, *, event_id: str, trace_id: str | None) -> tuple[int, int]:
    new_count = improved_count = 0
    for pr, result in match_requests_for_property(db, prop):
        match, is_new, is_improved = _persist_match(db, pr, result, event_id=event_id, trace_id=trace_id)
        if match is None:
            continue
        if is_new or is_improved:
            pr.last_matched_at = datetime.now(timezone.utc)
            _notify_if_needed(db, pr, match, prop, is_new=is_new, is_improved=is_improved)
        new_count += int(is_new)
        improved_count += int(is_improved)
    return new_count, improved_count


def match_and_notify_for_request(db: Session, pr: PropertyRequest, *, event_id: str, trace_id: str | None = None) -> tuple[int, int]:
    """Also used directly (not just via the Celery task) by the activation
    API route for a fast initial preview, and by admin "retry matching"."""
    new_count = improved_count = 0
    for result in match_properties_for_request(db, pr):
        match, is_new, is_improved = _persist_match(db, pr, result, event_id=event_id, trace_id=trace_id)
        if match is None:
            continue
        if is_new or is_improved:
            _notify_if_needed(db, pr, match, result.property, is_new=is_new, is_improved=is_improved)
        new_count += int(is_new)
        improved_count += int(is_improved)
    if new_count or improved_count:
        pr.last_matched_at = datetime.now(timezone.utc)
    return new_count, improved_count


@celery_app.task(
    name="app.tasks.property_requests.match_property_event",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    max_retries=5,
)
def match_property_event(self, event_type: str, aggregate_id: str, payload: dict, trace_id: str | None = None) -> dict:
    from app.tasks.notifications import _best_effort_lock

    if not is_enabled("property_requests"):
        return {"skipped": "feature_disabled"}

    event_id = f"pr:{event_type}:{aggregate_id}:{payload.get('new_price', payload.get('detail_changed', ''))}"
    with _best_effort_lock(f"property-request:event-lock:{event_id}", ttl_seconds=120) as acquired:
        if not acquired:
            return {"skipped": "locked"}

        db = SessionLocal()
        try:
            if event_type == EventType.MEDIATOR_VERIFIED:
                mediator_id = int(aggregate_id)
                props = db.scalars(select(Property).where(Property.mediator_id == mediator_id, Property.status == "Published")).all()
                total_new = total_improved = 0
                for prop in props:
                    n, i = _match_and_notify_for_property(db, prop, event_id=event_id, trace_id=trace_id)
                    total_new += n
                    total_improved += i
                db.commit()
                return {"new": total_new, "improved": total_improved}

            property_id = int(aggregate_id)
            prop = db.get(Property, property_id)
            if not prop:
                return {"skipped": "property_not_found"}
            new_count, improved_count = _match_and_notify_for_property(db, prop, event_id=event_id, trace_id=trace_id)
            db.commit()
            return {"new": new_count, "improved": improved_count}
        finally:
            db.close()


@celery_app.task(
    name="app.tasks.property_requests.backfill_request_matches",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=120,
    max_retries=5,
)
def backfill_request_matches(self, request_id: int, trace_id: str | None = None) -> dict:
    from app.tasks.notifications import _best_effort_lock

    if not is_enabled("property_requests"):
        return {"skipped": "feature_disabled"}

    with _best_effort_lock(f"property-request:backfill-lock:{request_id}", ttl_seconds=300) as acquired:
        if not acquired:
            return {"skipped": "locked"}

        db = SessionLocal()
        try:
            pr = db.get(PropertyRequest, request_id)
            if not pr or pr.status != "active" or not pr.matching_enabled:
                return {"skipped": "not_active"}
            event_id = f"pr-backfill:{request_id}:{datetime.now(timezone.utc).isoformat()}"
            new_count, improved_count = match_and_notify_for_request(db, pr, event_id=event_id, trace_id=trace_id)
            db.commit()
            return {"new": new_count, "improved": improved_count}
        finally:
            db.close()


# ── Outbox event handlers ────────────────────────────────────────────────────

def _enqueue_property_match(event) -> None:
    from app.core.jobs import enqueue

    enqueue(match_property_event, event.event_type, event.aggregate_id, event.payload, event.trace_id)


def _enqueue_backfill(event) -> None:
    from app.core.jobs import enqueue

    enqueue(backfill_request_matches, int(event.aggregate_id), event.trace_id)


@register_handler(EventType.PROPERTY_PUBLISHED)
def _on_property_published(event) -> None:
    _enqueue_property_match(event)


@register_handler(EventType.PROPERTY_PRICE_CHANGED)
def _on_property_price_changed(event) -> None:
    _enqueue_property_match(event)


@register_handler(EventType.PROPERTY_UPDATED)
def _on_property_updated(event) -> None:
    if event.payload.get("detail_changed"):
        _enqueue_property_match(event)


@register_handler(EventType.PROPERTY_AVAILABILITY_CHANGED)
def _on_property_availability_changed(event) -> None:
    _enqueue_property_match(event)


@register_handler(EventType.PROPERTY_VERIFIED)
def _on_property_verified(event) -> None:
    _enqueue_property_match(event)


@register_handler(EventType.MEDIATOR_VERIFIED)
def _on_mediator_verified_for_requests(event) -> None:
    _enqueue_property_match(event)


@register_handler(EventType.PROPERTY_REQUEST_ACTIVATED)
def _on_request_activated(event) -> None:
    _enqueue_backfill(event)


@register_handler(EventType.PROPERTY_REQUEST_UPDATED)
def _on_request_updated(event) -> None:
    _enqueue_backfill(event)


@register_handler(EventType.PROPERTY_REQUEST_RESUMED)
def _on_request_resumed(event) -> None:
    _enqueue_backfill(event)
