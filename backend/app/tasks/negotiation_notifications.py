"""AI Negotiation & Offer Management notifications. Mirrors
app/tasks/viewing_notifications.py exactly: an outbox event (emitted in the
SAME transaction as the negotiation state change — see
app/services/property_negotiation.py) is picked up by the publisher, a
lightweight handler here hands off to Celery via app.core.jobs.enqueue(),
and create_negotiation_notification does the real work — recipient
resolution, dedupe, template rendering, delivery through the same
_deliver() pipeline every other notification type uses.

Prompt 2 wired NEGOTIATION_SUBMITTED only (notify the mediator). Prompt 3
adds NEGOTIATION_COUNTERED, NEGOTIATION_ACCEPTED, NEGOTIATION_WITHDRAWN —
all three notify whichever party did NOT perform the action (never
self-notify), resolved from the payload's `offer_type`/`accepted_by` since
this feature's transitions are shared by both sides (see
property_negotiation.submit_counter()/accept_offer()). Prompt 4 adds
NEGOTIATION_REJECTED — mediator-only action, always notifies the customer.

**Prompt 6 polishes `_TITLES`/`_render()`'s copy to match brief §19's exact
example strings:** "New offer received" / "SAR X offer received for
{property title}" (NEGOTIATION_SUBMITTED, notifying the mediator) and "New
counter offer" / "The mediator proposed SAR X for the {property type} in
{district}" (NEGOTIATION_COUNTERED, mediator -> customer direction; the
customer -> mediator direction, added in Prompt 4, gets the same title with
symmetric "The customer proposed..." body wording, since the brief doesn't
give a separate example string for that direction). `deep_link` stays the
same `mymakan://partner/negotiations/{id}` string every recipient already
got (unchanged from Prompt 3/4) — this already IS the "deep-link payload
the frontend can route on" brief §19 asks for: the negotiation id is
embedded directly in the URL path, the exact same shape
viewing_notifications.py's `mymakan://partner/viewings/{id}` uses.
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
from app.models.property_negotiation import PropertyNegotiation
from app.tasks.outbox import register_handler

logger = logging.getLogger("app.tasks.negotiation_notifications")

_TITLES = {
    "en": {
        # Brief §19's exact example title/body pair.
        "negotiation_offer_submitted": "New offer received",
        # Brief §19's exact example title (body wording differs by
        # direction — see _render() below).
        "negotiation_counter_received": "New counter offer",
        "negotiation_accepted": "Offer accepted",
        "negotiation_withdrawn": "Negotiation withdrawn",
        "negotiation_rejected": "Offer rejected",
    },
    "ar": {
        "negotiation_offer_submitted": "عرض جديد مستلم",
        "negotiation_counter_received": "عرض مضاد جديد",
        "negotiation_accepted": "تم قبول العرض",
        "negotiation_withdrawn": "تم سحب التفاوض",
        "negotiation_rejected": "تم رفض العرض",
    },
}


def _property_label(negotiation: PropertyNegotiation, locale: str) -> str:
    prop = negotiation.property
    if not prop:
        return f"#{negotiation.property_id}"
    return prop.title


def _property_type_label(negotiation: PropertyNegotiation) -> str:
    """Brief §19's example body says "the apartment in {district}" — uses
    the listing's own `property_type` (e.g. "apartment", "villa") when
    known, falling back to the generic word rather than fabricating a type
    the listing doesn't actually declare."""
    prop = negotiation.property
    return (prop.property_type if prop and prop.property_type else None) or "property"


def _district_label(negotiation: PropertyNegotiation) -> str | None:
    """This codebase treats Property.area as "district" everywhere else
    (see property_negotiation.py's to_negotiation_out() comment) — same
    convention here, no separate district field to read."""
    prop = negotiation.property
    return prop.area if prop and prop.area else None


def _render(notification_key: str, negotiation: PropertyNegotiation, *, locale: str, extra: dict | None = None) -> tuple[str, str]:
    extra = extra or {}
    titles = _TITLES.get(locale, _TITLES["en"])
    title = titles.get(notification_key, titles["negotiation_offer_submitted"])
    label = _property_label(negotiation, locale)
    amount = extra.get("amount")

    if notification_key == "negotiation_offer_submitted":
        # Brief §19's exact example: "SAR X offer received for {property
        # title}." — a short second sentence is appended for the
        # call-to-action, same 2-sentence shape every other notification in
        # this codebase uses.
        if locale == "ar":
            body = (
                f"تم استلام عرض بقيمة {amount} ريال مقابل {label}. راجعه للرد عليه."
                if amount
                else f"تم استلام عرض جديد مقابل {label}. راجعه للرد عليه."
            )
        else:
            body = (
                f"SAR {amount} offer received for {label}. Review it to respond."
                if amount
                else f"A new offer was received for {label}. Review it to respond."
            )
    elif notification_key == "negotiation_counter_received":
        # Brief §19's exact example (mediator -> customer direction): "The
        # mediator proposed SAR X for the apartment in {district}." The
        # customer -> mediator direction (Prompt 4's mediator_counter check
        # below is inverted — this is the "else" branch) has no brief
        # example string, so it mirrors the same sentence shape with
        # symmetric "The customer proposed..." wording.
        offer_type = extra.get("offer_type")
        ptype = _property_type_label(negotiation)
        district = _district_label(negotiation)
        if offer_type == "mediator_counter":
            if locale == "ar":
                body = (
                    f"اقترح الوسيط عرضًا مضادًا بقيمة {amount} ريال على {ptype} في {district}. راجعه للرد."
                    if amount and district
                    else f"اقترح الوسيط عرضًا مضادًا جديدًا على {label}. راجعه للرد."
                )
            else:
                body = (
                    f"The mediator proposed SAR {amount} for the {ptype} in {district}. Review it to respond."
                    if amount and district
                    else f"The mediator proposed a new counter-offer for {label}. Review it to respond."
                )
        else:  # "customer_counter" (or unknown — same wording either way)
            if locale == "ar":
                body = (
                    f"اقترح العميل عرضًا مضادًا بقيمة {amount} ريال على {label}. راجعه للرد."
                    if amount
                    else f"اقترح العميل عرضًا مضادًا جديدًا على {label}. راجعه للرد."
                )
            else:
                body = (
                    f"The customer proposed SAR {amount} for {label}. Review it to respond."
                    if amount
                    else f"The customer proposed a new counter-offer for {label}. Review it to respond."
                )
    elif notification_key == "negotiation_accepted":
        if locale == "ar":
            body = (
                f"تم قبول العرض بقيمة {amount} ريال على {label}."
                if amount
                else f"تم قبول العرض على {label}."
            )
        else:
            body = (
                f"The offer of SAR {amount} for {label} was accepted."
                if amount
                else f"The offer for {label} was accepted."
            )
    elif notification_key == "negotiation_withdrawn":
        reason = extra.get("reason")
        if locale == "ar":
            body = (
                f"قام العميل بسحب التفاوض على {label}. السبب: {reason}."
                if reason
                else f"قام العميل بسحب التفاوض على {label}."
            )
        else:
            body = (
                f"The customer withdrew their negotiation for {label}. Reason: {reason}."
                if reason
                else f"The customer withdrew their negotiation for {label}."
            )
    elif notification_key == "negotiation_rejected":
        reason = extra.get("reason")
        if locale == "ar":
            body = (
                f"تم رفض عرضك على {label}. السبب: {reason}."
                if reason
                else f"تم رفض عرضك على {label}."
            )
        else:
            body = (
                f"Your offer for {label} was rejected. Reason: {reason}."
                if reason
                else f"Your offer for {label} was rejected."
            )
    else:
        body = label

    return title, body


def _enqueue(event) -> None:
    from app.core.jobs import enqueue

    enqueue(create_negotiation_notification, event.event_type, event.aggregate_id, event.payload, event.trace_id)


@register_handler(EventType.NEGOTIATION_SUBMITTED)
def _on_negotiation_submitted(event) -> None:
    _enqueue(event)


@register_handler(EventType.NEGOTIATION_COUNTERED)
def _on_negotiation_countered(event) -> None:
    _enqueue(event)


@register_handler(EventType.NEGOTIATION_ACCEPTED)
def _on_negotiation_accepted(event) -> None:
    _enqueue(event)


@register_handler(EventType.NEGOTIATION_WITHDRAWN)
def _on_negotiation_withdrawn(event) -> None:
    _enqueue(event)


@register_handler(EventType.NEGOTIATION_REJECTED)
def _on_negotiation_rejected(event) -> None:
    _enqueue(event)


def _recipients_for_event(db: Session, event_type: str, negotiation: PropertyNegotiation, payload: dict) -> list[tuple[int, str]]:
    """Returns [(user_id, notification_key), ...]. The user who performed
    the action (payload["actor_user_id"]) is always excluded — never
    self-notify — same rule as viewing_notifications.py."""
    actor_user_id = payload.get("actor_user_id")
    recipients: list[tuple[int, str]] = []

    if event_type == EventType.NEGOTIATION_SUBMITTED:
        mediator_id = payload.get("mediator_id") or negotiation.mediator_id
        mediator = db.get(Mediator, mediator_id) if mediator_id else None
        if mediator:
            recipients.append((mediator.user_id, "negotiation_offer_submitted"))

    elif event_type == EventType.NEGOTIATION_COUNTERED:
        # submit_counter() backs BOTH sides (customer_counter/
        # mediator_counter) — notify whichever party did NOT place this
        # counter, resolved from the offer_type the payload carries.
        offer_type = payload.get("offer_type")
        if offer_type == "customer_counter":
            mediator_id = payload.get("mediator_id") or negotiation.mediator_id
            mediator = db.get(Mediator, mediator_id) if mediator_id else None
            if mediator:
                recipients.append((mediator.user_id, "negotiation_counter_received"))
        else:  # "mediator_counter" (Prompt 4)
            customer_user_id = payload.get("customer_user_id") or negotiation.customer_user_id
            if customer_user_id:
                recipients.append((customer_user_id, "negotiation_counter_received"))

    elif event_type == EventType.NEGOTIATION_ACCEPTED:
        # accept_offer() backs BOTH sides too — notify whichever party did
        # NOT accept, resolved from accepted_by.
        accepted_by = payload.get("accepted_by")
        if accepted_by == "customer":
            mediator_id = payload.get("mediator_id") or negotiation.mediator_id
            mediator = db.get(Mediator, mediator_id) if mediator_id else None
            if mediator:
                recipients.append((mediator.user_id, "negotiation_accepted"))
        else:  # "mediator" (Prompt 4)
            customer_user_id = payload.get("customer_user_id") or negotiation.customer_user_id
            if customer_user_id:
                recipients.append((customer_user_id, "negotiation_accepted"))

    elif event_type == EventType.NEGOTIATION_WITHDRAWN:
        # withdraw_negotiation() is customer-only — always notify the
        # mediator.
        mediator_id = payload.get("mediator_id") or negotiation.mediator_id
        mediator = db.get(Mediator, mediator_id) if mediator_id else None
        if mediator:
            recipients.append((mediator.user_id, "negotiation_withdrawn"))

    elif event_type == EventType.NEGOTIATION_REJECTED:
        # reject_negotiation() is mediator-only (Prompt 4) — always notify
        # the customer.
        customer_user_id = payload.get("customer_user_id") or negotiation.customer_user_id
        if customer_user_id:
            recipients.append((customer_user_id, "negotiation_rejected"))

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
    name="app.tasks.negotiation_notifications.create_negotiation_notification",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=5,
)
def create_negotiation_notification(self, event_type: str, aggregate_id: str, payload: dict, trace_id: str | None = None) -> dict:
    if not is_enabled("negotiations"):
        return {"skipped": "feature_disabled"}

    from app.tasks.notifications import _deliver  # local import: avoids a module-load cycle at import time

    db = SessionLocal()
    try:
        negotiation = db.get(PropertyNegotiation, int(aggregate_id))
        if not negotiation:
            return {"skipped": "negotiation_not_found"}

        recipients = _recipients_for_event(db, event_type, negotiation, payload)
        created = 0
        for user_id, notification_key in recipients:
            dedupe_key = f"{event_type}:{aggregate_id}:{user_id}"[:160]

            if db.scalar(select(Notification.id).where(Notification.dedupe_key == dedupe_key)) is not None:
                continue

            locale = _recipient_locale(db, user_id)
            title, body = _render(notification_key, negotiation, locale=locale, extra=payload)

            notification = Notification(
                user_id=user_id,
                type=notification_key,
                title=title,
                body=body,
                locale=locale,
                entity_type="property_negotiation",
                entity_id=negotiation.id,
                property_id=negotiation.property_id,
                deep_link=f"mymakan://partner/negotiations/{negotiation.id}",
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
