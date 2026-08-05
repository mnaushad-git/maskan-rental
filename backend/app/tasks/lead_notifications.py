"""Generic lead notifications (Phase 3).

Mirrors the saved-search-alert flow exactly: an outbox event (emitted in the
SAME transaction as the lead state change — see app/api/routes/leads.py) is
picked up by the publisher, a lightweight handler here hands off to Celery
via `app.core.jobs.enqueue()`, and `create_lead_notification` does the real
work — recipient resolution, dedupe, template rendering, and delivery
through the exact same `_deliver()` pipeline saved-search alerts use (Phase
2/13 delivery tracking, quiet hours, category preferences all apply
identically to lead notifications with zero extra code).

Recipient resolution is domain-driven, not generic "notify the lead's
customer" — see `_recipients_for_event()`. The user who performed the
action is always excluded (never self-notify) via `actor_user_id` in the
outbox payload.

Scope note: `lead.viewing_scheduled` and `lead.reopened` from the platform
spec have no backing feature in this codebase (no viewing-scheduling flow,
no "reopen a closed lead" action) — not modeled here, see app/core/outbox.py.
`lead.created` also has no handler here: at creation a lead has no assigned
mediator yet (status="pending_review"), so there is no natural per-user
recipient beyond what the existing admin leads queue already surfaces.
"""
import logging
from datetime import datetime, timedelta, timezone

import redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.feature_flags import is_enabled
from app.core.metrics import lead_notifications_total, notifications_created_total
from app.core.notification_stream import publish_invalidate
from app.core.outbox import EventType
from app.core.redis_client import get_redis_client
from app.db.session import SessionLocal
from app.models.device import Device
from app.models.lead import Lead, LeadAssignment, LeadMessage
from app.models.mediator import Mediator
from app.models.notification import Notification
from app.tasks.outbox import register_handler

logger = logging.getLogger("app.tasks.lead_notifications")

DEDUPE_TTL_SECONDS = 24 * 60 * 60

_TITLES = {
    "en": {
        "lead_approved": "Your request was approved",
        "lead_rejected": "Update on your request",
        "lead_assigned_customer": "An agent picked up your request",
        "lead_assigned_mediator": "You've been assigned a new lead",
        "lead_closed": "Your request has been closed",
        "lead_status_update": "Your request status changed",
        "lead_message": "New message about your request",
    },
    "ar": {
        "lead_approved": "تمت الموافقة على طلبك",
        "lead_rejected": "تحديث بخصوص طلبك",
        "lead_assigned_customer": "قام وسيط بمتابعة طلبك",
        "lead_assigned_mediator": "تم تعيين طلب جديد لك",
        "lead_closed": "تم إغلاق طلبك",
        "lead_status_update": "تغيرت حالة طلبك",
        "lead_message": "رسالة جديدة بخصوص طلبك",
    },
}


def _lead_label(lead: Lead, locale: str) -> str:
    return f"{lead.area_name}, {lead.city}" if locale != "ar" else f"{lead.area_name}، {lead.city}"


def _render(event_type: str, lead: Lead, *, locale: str, notification_key: str, extra: dict | None = None) -> tuple[str, str]:
    extra = extra or {}
    titles = _TITLES.get(locale, _TITLES["en"])
    title = titles.get(notification_key, titles["lead_status_update"])
    label = _lead_label(lead, locale)

    if notification_key == "lead_approved":
        body = f"طلبك في {label} أصبح مرئيًا للوسطاء الموثقين." if locale == "ar" else f"Your request in {label} is now visible to verified agents."
    elif notification_key == "lead_rejected":
        body = f"لم تتم الموافقة على طلبك في {label}. تواصل مع الدعم لمزيد من التفاصيل." if locale == "ar" else f"Your request in {label} could not be approved. Contact support for details."
    elif notification_key == "lead_assigned_customer":
        body = f"قام وسيط عقاري بمتابعة طلبك في {label} وسيتواصل معك قريبًا." if locale == "ar" else f"A real-estate agent picked up your request in {label} and will reach out soon."
    elif notification_key == "lead_assigned_mediator":
        body = f"تم تعيين طلب جديد لك في {label}." if locale == "ar" else f"A new lead in {label} was assigned to you."
    elif notification_key == "lead_closed":
        outcome = extra.get("outcome", "")
        won = outcome == "closed_won"
        if locale == "ar":
            body = f"تم إغلاق طلبك في {label} بنجاح." if won else f"تم إغلاق طلبك في {label}."
        else:
            body = f"Your request in {label} was closed successfully." if won else f"Your request in {label} was closed."
    elif notification_key == "lead_message":
        sender = extra.get("sender_role", "")
        who = {"customer": "العميل" if locale == "ar" else "the customer", "mediator": "الوسيط" if locale == "ar" else "the agent", "admin": "فريق myHome" if locale == "ar" else "the myHome team"}.get(sender, "")
        body = f"رسالة جديدة من {who} بخصوص {label}." if locale == "ar" else f"New message from {who} about {label}."
    else:  # lead_status_update fallback
        body = f"تغيرت حالة طلبك في {label}." if locale == "ar" else f"Your request in {label} changed status."

    return title, body


# ── Outbox handlers: hand off to Celery, keep the publisher batch fast ──────

def _enqueue(event) -> None:
    from app.core.jobs import enqueue

    enqueue(create_lead_notification, event.event_type, event.aggregate_id, event.payload, event.trace_id)


@register_handler(EventType.LEAD_APPROVED)
def _on_lead_approved(event) -> None:
    _enqueue(event)


@register_handler(EventType.LEAD_REJECTED)
def _on_lead_rejected(event) -> None:
    _enqueue(event)


@register_handler(EventType.LEAD_ASSIGNED)
def _on_lead_assigned(event) -> None:
    _enqueue(event)


@register_handler(EventType.LEAD_CLOSED)
def _on_lead_closed(event) -> None:
    _enqueue(event)


@register_handler(EventType.LEAD_STATUS_CHANGED)
def _on_lead_status_changed(event) -> None:
    _enqueue(event)


@register_handler(EventType.LEAD_MESSAGE_ADDED)
def _on_lead_message_added(event) -> None:
    _enqueue(event)


# ── Recipient resolution (domain rules, Phase 3) ────────────────────────────

def _accepted_mediator_user_id(db: Session, lead: Lead) -> int | None:
    assignment = db.scalar(
        select(LeadAssignment)
        .where(LeadAssignment.lead_id == lead.id, LeadAssignment.status == "accepted")
        .order_by(LeadAssignment.accepted_at.desc())
    )
    if assignment is None or assignment.mediator_id is None:
        return None
    mediator = db.get(Mediator, assignment.mediator_id)
    return mediator.user_id if mediator else None


def _recipients_for_event(db: Session, event_type: str, lead: Lead, payload: dict) -> list[tuple[int, str]]:
    """Returns [(user_id, notification_key), ...]. `notification_key`
    selects which template variant to render (some events read differently
    depending on who receives them, e.g. lead.assigned)."""
    actor_user_id = payload.get("actor_user_id")
    recipients: list[tuple[int, str]] = []

    if event_type == EventType.LEAD_APPROVED:
        recipients.append((lead.customer_user_id, "lead_approved"))
    elif event_type == EventType.LEAD_REJECTED:
        recipients.append((lead.customer_user_id, "lead_rejected"))
    elif event_type == EventType.LEAD_ASSIGNED:
        if actor_user_id is not None:
            # Mediator self-accept flow: notify the customer only.
            recipients.append((lead.customer_user_id, "lead_assigned_customer"))
        else:
            # Admin-assignment flow: notify the newly assigned mediator.
            mediator_id = payload.get("mediator_id")
            mediator = db.get(Mediator, mediator_id) if mediator_id else None
            if mediator:
                recipients.append((mediator.user_id, "lead_assigned_mediator"))
    elif event_type in (EventType.LEAD_CLOSED, EventType.LEAD_STATUS_CHANGED):
        recipients.append((lead.customer_user_id, "lead_closed" if event_type == EventType.LEAD_CLOSED else "lead_status_update"))
        mediator_user_id = _accepted_mediator_user_id(db, lead)
        if mediator_user_id:
            recipients.append((mediator_user_id, "lead_closed" if event_type == EventType.LEAD_CLOSED else "lead_status_update"))
    elif event_type == EventType.LEAD_MESSAGE_ADDED:
        sender_role = payload.get("sender_role")
        mediator_user_id = _accepted_mediator_user_id(db, lead)
        if sender_role == "customer" and mediator_user_id:
            recipients.append((mediator_user_id, "lead_message"))
        elif sender_role == "mediator":
            recipients.append((lead.customer_user_id, "lead_message"))
        elif sender_role == "admin":
            recipients.append((lead.customer_user_id, "lead_message"))
            if mediator_user_id:
                recipients.append((mediator_user_id, "lead_message"))

    # Never notify the user who performed the action, and never duplicate a
    # user_id (e.g. an admin who is also somehow the customer, defensively).
    seen: set[int] = set()
    result = []
    for user_id, key in recipients:
        if user_id is None or user_id == actor_user_id or user_id in seen:
            continue
        seen.add(user_id)
        result.append((user_id, key))
    return result


def _recipient_locale(db: Session, user_id: int) -> str:
    device = db.scalar(select(Device).where(Device.user_id == user_id).order_by(Device.last_active_at.desc()).limit(1))
    return device.locale if device and device.locale in ("en", "ar") else "en"


def _redis_dedupe_seen(event_id: str, recipient_id: int) -> bool:
    client = get_redis_client()
    if client is None:
        return False
    key = f"maskan:lead-notification:dedupe:{event_id}:{recipient_id}"
    try:
        return not client.set(key, "1", nx=True, ex=DEDUPE_TTL_SECONDS)
    except redis.RedisError as exc:
        logger.warning("_redis_dedupe_seen: Redis error, proceeding without dedupe cache: %s", exc)
        return False


_NOTIFICATION_TYPE = {
    "lead_approved": "lead_status_update",
    "lead_rejected": "lead_status_update",
    "lead_assigned_customer": "lead_status_update",
    "lead_assigned_mediator": "lead_status_update",
    "lead_closed": "lead_status_update",
    "lead_status_update": "lead_status_update",
    "lead_message": "lead_message",
}


@celery_app.task(
    name="app.tasks.lead_notifications.create_lead_notification",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=5,
)
def create_lead_notification(self, event_type: str, aggregate_id: str, payload: dict, trace_id: str | None = None) -> dict:
    if not is_enabled("lead_generic_notifications"):
        return {"skipped": "feature_disabled"}

    from app.tasks.notifications import _deliver  # local import: avoids a module-load cycle at import time

    event_id = f"{event_type}:{aggregate_id}:{payload.get('message_id', payload.get('mediator_id', ''))}"

    db = SessionLocal()
    try:
        lead = db.get(Lead, int(aggregate_id))
        if not lead:
            return {"skipped": "lead_not_found"}

        recipients = _recipients_for_event(db, event_type, lead, payload)
        created = 0
        for user_id, notification_key in recipients:
            if _redis_dedupe_seen(event_id, user_id):
                continue
            dedupe_key = f"{event_id}:{user_id}"[:160]

            # DB-level dedupe pre-check (the `notifications.dedupe_key`
            # partial unique index is the real guarantee — Redis above is
            # just a fast-path skip). A pre-check SELECT rather than
            # catching IntegrityError on INSERT keeps this task's retry
            # semantics simple: a genuine race that slips past both checks
            # still hits the unique index and raises, which Celery's
            # autoretry_for=(Exception,) retries — the retry then finds the
            # row via this same SELECT and skips cleanly.
            if db.scalar(select(Notification.id).where(Notification.dedupe_key == dedupe_key)) is not None:
                continue

            locale = _recipient_locale(db, user_id)
            title, body = _render(event_type, lead, locale=locale, notification_key=notification_key, extra=payload)
            notification_type = _NOTIFICATION_TYPE.get(notification_key, "lead_status_update")

            notification = Notification(
                user_id=user_id,
                type=notification_type,
                title=title,
                body=body,
                locale=locale,
                entity_type="lead",
                entity_id=lead.id,
                deep_link=f"myhome://lead/{lead.id}",
                delivery_status={},
                meta={"event_type": event_type},
                trace_id=trace_id,
                dedupe_key=dedupe_key,
                expires_at=datetime.now(timezone.utc) + timedelta(days=settings.NOTIFICATION_RETENTION_DAYS),
            )
            db.add(notification)
            db.flush()

            notifications_created_total.labels(type=notification_type).inc()
            lead_notifications_total.labels(event_type=event_type).inc()
            _deliver(db, notification, ["in_app", "push"])
            db.commit()
            publish_invalidate(user_id, reason=notification_type)
            created += 1

        return {"created": created}
    finally:
        db.close()
