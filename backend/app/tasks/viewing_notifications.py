"""Visit & Viewing Management notifications. Mirrors
app/tasks/lead_notifications.py exactly: an outbox event (emitted in the
SAME transaction as the viewing state change — see
app/services/property_viewing.py) is picked up by the publisher, a
lightweight handler here hands off to Celery via app.core.jobs.enqueue(),
and create_viewing_notification does the real work — recipient resolution,
dedupe, template rendering, delivery through the same _deliver() pipeline
every other notification type uses.

Prompt 2 wires VIEWING_REQUESTED only (notify the mediator). Prompts 3-4
extend _recipients_for_event/_render for VIEWING_CONFIRMED,
VIEWING_RESCHEDULE_PROPOSED, VIEWING_CANCELLED, VIEWING_COMPLETED as those
transitions are built.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.celery_app import celery_app
from app.core.config import settings
from app.core.feature_flags import is_enabled
from app.core.notification_stream import publish_invalidate
from app.core.outbox import EventType
from app.db.session import SessionLocal
from app.models.mediator import Mediator
from app.models.notification import Notification
from app.models.property_viewing import PropertyViewing
from app.tasks.outbox import register_handler

logger = logging.getLogger("app.tasks.viewing_notifications")

_TITLES = {
    "en": {
        "viewing_requested": "New viewing request",
        "viewing_confirmed": "Viewing confirmed",
        "viewing_reschedule_proposed": "New time proposed",
        "viewing_cancelled": "Viewing cancelled",
        "viewing_completed": "Viewing completed",
    },
    "ar": {
        "viewing_requested": "طلب معاينة جديد",
        "viewing_confirmed": "تم تأكيد المعاينة",
        "viewing_reschedule_proposed": "تم اقتراح موعد جديد",
        "viewing_cancelled": "تم إلغاء المعاينة",
        "viewing_completed": "اكتملت المعاينة",
    },
}


def _property_label(viewing: PropertyViewing, locale: str) -> str:
    prop = viewing.property
    if not prop:
        return f"#{viewing.property_id}"
    return prop.title


def _render(notification_key: str, viewing: PropertyViewing, *, locale: str, extra: dict | None = None) -> tuple[str, str]:
    extra = extra or {}
    titles = _TITLES.get(locale, _TITLES["en"])
    title = titles.get(notification_key, titles["viewing_requested"])
    label = _property_label(viewing, locale)

    if notification_key == "viewing_requested":
        body = (
            f"طلب عميل معاينة {label}. راجع الطلب لتأكيده أو اقتراح موعد آخر."
            if locale == "ar"
            else f"A customer requested a viewing for {label}. Review the request to confirm or propose another time."
        )
    elif notification_key == "viewing_confirmed":
        body = f"تم تأكيد موعد معاينة {label}." if locale == "ar" else f"Your viewing for {label} is confirmed."
    elif notification_key == "viewing_reschedule_proposed":
        body = (
            f"تم اقتراح موعد جديد لمعاينة {label}. راجع الاقتراح للموافقة عليه أو اقتراح وقت آخر."
            if locale == "ar"
            else f"A new time was proposed for your viewing of {label}. Review it to accept or propose another time."
        )
    elif notification_key == "viewing_cancelled":
        reason = extra.get("reason")
        if locale == "ar":
            body = f"تم إلغاء معاينة {label}." + (f" السبب: {reason}." if reason else "")
        else:
            body = f"Your viewing for {label} was cancelled." + (f" Reason: {reason}." if reason else "")
    elif notification_key == "viewing_completed":
        body = f"اكتملت معاينة {label}. أخبرنا برأيك." if locale == "ar" else f"Your viewing for {label} is complete. Tell us what you thought."
    else:
        body = label

    return title, body


def _enqueue(event) -> None:
    from app.core.jobs import enqueue

    enqueue(create_viewing_notification, event.event_type, event.aggregate_id, event.payload, event.trace_id)


@register_handler(EventType.VIEWING_REQUESTED)
def _on_viewing_requested(event) -> None:
    _enqueue(event)


@register_handler(EventType.VIEWING_CONFIRMED)
def _on_viewing_confirmed(event) -> None:
    _enqueue(event)


@register_handler(EventType.VIEWING_RESCHEDULE_PROPOSED)
def _on_viewing_reschedule_proposed(event) -> None:
    _enqueue(event)


@register_handler(EventType.VIEWING_CANCELLED)
def _on_viewing_cancelled(event) -> None:
    _enqueue(event)


@register_handler(EventType.VIEWING_COMPLETED)
def _on_viewing_completed(event) -> None:
    _enqueue(event)


def _customer_and_mediator_user_ids(db: Session, viewing: PropertyViewing) -> tuple[int | None, int | None]:
    mediator = db.get(Mediator, viewing.mediator_id) if viewing.mediator_id else None
    return viewing.customer_user_id, (mediator.user_id if mediator else None)


def _recipients_for_event(db: Session, event_type: str, viewing: PropertyViewing, payload: dict) -> list[tuple[int, str]]:
    """Returns [(user_id, notification_key), ...]. The user who performed
    the action (payload["actor_user_id"]) is always excluded — never
    self-notify — same rule as lead_notifications.py."""
    actor_user_id = payload.get("actor_user_id")
    customer_user_id, mediator_user_id = _customer_and_mediator_user_ids(db, viewing)
    recipients: list[tuple[int, str]] = []

    if event_type == EventType.VIEWING_REQUESTED:
        mediator_id = payload.get("mediator_id") or viewing.mediator_id
        mediator = db.get(Mediator, mediator_id) if mediator_id else None
        if mediator:
            recipients.append((mediator.user_id, "viewing_requested"))
    elif event_type == EventType.VIEWING_CONFIRMED:
        if customer_user_id:
            recipients.append((customer_user_id, "viewing_confirmed"))
        if mediator_user_id:
            recipients.append((mediator_user_id, "viewing_confirmed"))
    elif event_type == EventType.VIEWING_RESCHEDULE_PROPOSED:
        proposed_by = payload.get("proposed_by")
        # Notify whoever did NOT propose — the counterparty needs to react.
        if proposed_by == "mediator" and customer_user_id:
            recipients.append((customer_user_id, "viewing_reschedule_proposed"))
        elif proposed_by == "customer" and mediator_user_id:
            recipients.append((mediator_user_id, "viewing_reschedule_proposed"))
    elif event_type == EventType.VIEWING_CANCELLED:
        if customer_user_id:
            recipients.append((customer_user_id, "viewing_cancelled"))
        if mediator_user_id:
            recipients.append((mediator_user_id, "viewing_cancelled"))
    elif event_type == EventType.VIEWING_COMPLETED:
        if customer_user_id:
            recipients.append((customer_user_id, "viewing_completed"))

    # Never notify the user who performed the action, and never duplicate a
    # user_id.
    seen: set[int] = set()
    result = []
    for user_id, key in recipients:
        if user_id is None or user_id == actor_user_id or user_id in seen:
            continue
        seen.add(user_id)
        result.append((user_id, key))
    return result


def _recipient_locale(db: Session, user_id: int) -> str:
    from app.models.device import Device

    device = db.scalar(select(Device).where(Device.user_id == user_id).order_by(Device.last_active_at.desc()).limit(1))
    return device.locale if device and device.locale in ("en", "ar") else "en"


@celery_app.task(
    name="app.tasks.viewing_notifications.create_viewing_notification",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=5,
)
def create_viewing_notification(self, event_type: str, aggregate_id: str, payload: dict, trace_id: str | None = None) -> dict:
    if not is_enabled("visit_management"):
        return {"skipped": "feature_disabled"}

    from app.tasks.notifications import _deliver  # local import: avoids a module-load cycle at import time

    db = SessionLocal()
    try:
        viewing = db.get(PropertyViewing, int(aggregate_id))
        if not viewing:
            return {"skipped": "viewing_not_found"}

        recipients = _recipients_for_event(db, event_type, viewing, payload)
        created = 0
        for user_id, notification_key in recipients:
            dedupe_key = f"{event_type}:{aggregate_id}:{user_id}"[:160]

            if db.scalar(select(Notification.id).where(Notification.dedupe_key == dedupe_key)) is not None:
                continue

            locale = _recipient_locale(db, user_id)
            title, body = _render(notification_key, viewing, locale=locale, extra=payload)

            notification = Notification(
                user_id=user_id,
                type=notification_key,
                title=title,
                body=body,
                locale=locale,
                entity_type="property_viewing",
                entity_id=viewing.id,
                property_id=viewing.property_id,
                deep_link=f"mymakan://partner/viewings/{viewing.id}",
                delivery_status={},
                meta={"event_type": event_type},
                trace_id=trace_id,
                dedupe_key=dedupe_key,
                expires_at=datetime.now(timezone.utc) + timedelta(days=settings.NOTIFICATION_RETENTION_DAYS),
            )
            db.add(notification)
            db.flush()

            _deliver(db, notification, ["in_app", "push"])
            db.commit()
            publish_invalidate(user_id, reason=notification_key)
            created += 1

        return {"created": created}
    finally:
        db.close()
