"""Rental/Buy Transaction Workspace notifications (Prompt 6). See
docs/implementation/mymakan-transaction-workspace.md. Mirrors
app/tasks/negotiation_notifications.py exactly: an outbox event (emitted in
the SAME transaction as the transaction state change — see
app/services/property_transaction.py) is picked up by the publisher, a
lightweight handler here hands off to Celery via app.core.jobs.enqueue(),
and create_transaction_notification does the real work — recipient
resolution, dedupe, template rendering, delivery through the same
_deliver() pipeline every other notification type uses.

**Trigger-point design (Prompt 6's own call — no brief document/event
mapping was found committed anywhere, mirroring how Prompt 2's document
templates were also a deliberate, documented choice):**

- `transaction.created` — `create_transaction_for_negotiation()`. Notifies
  BOTH customer and mediator, no self-notify exclusion — this is a
  new-entity-for-both event (a fresh workspace neither party had before),
  not "someone did something to you". `PropertyNegotiation.accept_offer()`
  separately fires its own self-notify-excluded `NEGOTIATION_ACCEPTED`
  event for the "you accepted / your offer was accepted" half of the story.
- `document.uploaded` — `upload_document()`. Mediator only (their review
  queue grew by one document); the customer already gets a synchronous API
  response confirming their own upload, so notifying them too would be a
  pointless self-notification.
- `document.accepted` / `document.update_requested` — `accept_document()` /
  `request_document_update()`. Customer only (same "actor never notifies
  themselves" rule — the mediator performed the review action).
- `transaction.action_required` — fired ALONGSIDE `document.update_requested`
  from `request_document_update()` (same one mutation, two distinct
  notifications — a specific "this document needs a fix" detail plus a
  general "you have an action required" nudge carrying the live
  deterministic Next Best Action message, so the general nudge never goes
  stale relative to Prompt 3's engine).
- `transaction.ready` — `sync_progress_and_status()`, fired only the FIRST
  time a transaction reaches `ready_for_next_step` (`ready_at` transitions
  from `None`). Notifies BOTH parties, no self-notify exclusion (shared
  milestone, not an actor-performed action) — body embeds the exact
  deterministic readiness label ("Ready for Rental Contract Process" /
  "Ready for Sale Process"), never re-worded, per the feature's
  non-negotiable wording rule.
- `transaction.cancelled` — `cancel_transaction()`. Notifies whichever party
  did NOT cancel (resolved from `cancelled_by`).

Every notification's `deep_link` stays a single
`mymakan://partner/transactions/{id}` string regardless of recipient —
same "one string for every recipient" convention
negotiation_notifications.py/viewing_notifications.py already use (see
mobile/src/lib/deepLink.ts's `(?:partner/)?` regex, which already tolerates
this for viewings/negotiations).
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
from app.models.property_transaction import PropertyTransaction
from app.tasks.outbox import register_handler

logger = logging.getLogger("app.tasks.transaction_notifications")

_TITLES = {
    "en": {
        "transaction_created": "Transaction workspace created",
        "document_uploaded": "New document submitted",
        "document_accepted": "Document accepted",
        "document_update_requested": "Document update requested",
        "transaction_action_required": "Action required",
        "transaction_ready": "Your transaction is ready",
        "transaction_cancelled": "Transaction cancelled",
    },
    "ar": {
        "transaction_created": "تم إنشاء مساحة عمل المعاملة",
        "document_uploaded": "تم تقديم مستند جديد",
        "document_accepted": "تم قبول المستند",
        "document_update_requested": "طلب تحديث مستند",
        "transaction_action_required": "إجراء مطلوب",
        "transaction_ready": "معاملتك جاهزة",
        "transaction_cancelled": "تم إلغاء المعاملة",
    },
}


def _property_label(transaction: PropertyTransaction, locale: str) -> str:
    prop = transaction.property
    if not prop:
        return f"#{transaction.property_id}"
    return prop.title


def _render(notification_key: str, transaction: PropertyTransaction, *, locale: str, extra: dict | None = None) -> tuple[str, str]:
    extra = extra or {}
    titles = _TITLES.get(locale, _TITLES["en"])
    title = titles.get(notification_key, titles["transaction_created"])
    label = _property_label(transaction, locale)
    reference = transaction.reference

    if notification_key == "transaction_created":
        if locale == "ar":
            body = f"تم إنشاء مساحة عمل المعاملة {reference} لـ {label}. راجع الخطوات التالية للمتابعة."
        else:
            body = f"Your transaction workspace {reference} for {label} is ready. Review the next steps to continue."
    elif notification_key == "document_uploaded":
        doc_label = extra.get("document_label") or ("مستند" if locale == "ar" else "a document")
        if locale == "ar":
            body = f"قدّم العميل {doc_label} لمعاملة {label} ({reference}). راجعه لقبوله أو طلب تحديث."
        else:
            body = f"The customer submitted {doc_label} for {label} ({reference}). Review it to accept or request an update."
    elif notification_key == "document_accepted":
        doc_label = extra.get("document_label") or ("مستندك" if locale == "ar" else "Your document")
        if locale == "ar":
            body = f"تم قبول {doc_label} في معاملة {label} ({reference})."
        else:
            body = f"{doc_label} for {label} ({reference}) was accepted."
    elif notification_key == "document_update_requested":
        doc_label = extra.get("document_label") or ("أحد مستنداتك" if locale == "ar" else "one of your documents")
        reason = extra.get("reason")
        if locale == "ar":
            body = f"طلب الوسيط تحديث {doc_label} في معاملة {label} ({reference})." + (f" السبب: {reason}." if reason else "")
        else:
            body = f"The mediator requested an update to {doc_label} for {label} ({reference})." + (f" Reason: {reason}." if reason else "")
    elif notification_key == "transaction_action_required":
        next_best_action = extra.get("next_best_action")
        if locale == "ar":
            body = f"لديك إجراء مطلوب على معاملة {label} ({reference})." + (f" {next_best_action}" if next_best_action else "")
        else:
            body = f"You have an action required on your transaction for {label} ({reference})." + (f" {next_best_action}" if next_best_action else "")
    elif notification_key == "transaction_ready":
        readiness_label = extra.get("readiness_label") or ""
        if locale == "ar":
            body = f"معاملتك لـ {label} ({reference}) أصبحت الآن: {readiness_label}."
        else:
            body = f"Your transaction for {label} ({reference}) is now: {readiness_label}."
    elif notification_key == "transaction_cancelled":
        reason = extra.get("reason")
        if locale == "ar":
            body = f"تم إلغاء معاملتك لـ {label} ({reference})." + (f" السبب: {reason}." if reason else "")
        else:
            body = f"Your transaction for {label} ({reference}) was cancelled." + (f" Reason: {reason}." if reason else "")
    else:
        body = label

    return title, body


def _enqueue(event) -> None:
    from app.core.jobs import enqueue

    enqueue(create_transaction_notification, event.event_type, event.aggregate_id, event.payload, event.trace_id)


@register_handler(EventType.TRANSACTION_CREATED)
def _on_transaction_created(event) -> None:
    _enqueue(event)


@register_handler(EventType.TRANSACTION_DOCUMENT_UPLOADED)
def _on_document_uploaded(event) -> None:
    _enqueue(event)


@register_handler(EventType.TRANSACTION_DOCUMENT_ACCEPTED)
def _on_document_accepted(event) -> None:
    _enqueue(event)


@register_handler(EventType.TRANSACTION_DOCUMENT_UPDATE_REQUESTED)
def _on_document_update_requested(event) -> None:
    _enqueue(event)


@register_handler(EventType.TRANSACTION_ACTION_REQUIRED)
def _on_transaction_action_required(event) -> None:
    _enqueue(event)


@register_handler(EventType.TRANSACTION_READY)
def _on_transaction_ready(event) -> None:
    _enqueue(event)


@register_handler(EventType.TRANSACTION_CANCELLED)
def _on_transaction_cancelled(event) -> None:
    _enqueue(event)


def _recipients_for_event(db: Session, event_type: str, transaction: PropertyTransaction, payload: dict) -> list[tuple[int, str]]:
    """Returns [(user_id, notification_key), ...]. The user who performed the
    action (payload["actor_user_id"]) is always excluded — never self-notify
    — same rule as negotiation_notifications.py/viewing_notifications.py.
    `transaction.created`/`transaction.ready` deliberately omit
    `actor_user_id` from their payload (see module docstring) so both
    parties are always notified."""
    actor_user_id = payload.get("actor_user_id")
    customer_user_id = payload.get("customer_user_id") or transaction.customer_user_id
    mediator_id = payload.get("mediator_id") or transaction.mediator_id
    mediator = db.get(Mediator, mediator_id) if mediator_id else None
    mediator_user_id = mediator.user_id if mediator else None
    recipients: list[tuple[int, str]] = []

    if event_type == EventType.TRANSACTION_CREATED:
        if customer_user_id:
            recipients.append((customer_user_id, "transaction_created"))
        if mediator_user_id:
            recipients.append((mediator_user_id, "transaction_created"))
    elif event_type == EventType.TRANSACTION_DOCUMENT_UPLOADED:
        if mediator_user_id:
            recipients.append((mediator_user_id, "document_uploaded"))
    elif event_type == EventType.TRANSACTION_DOCUMENT_ACCEPTED:
        if customer_user_id:
            recipients.append((customer_user_id, "document_accepted"))
    elif event_type == EventType.TRANSACTION_DOCUMENT_UPDATE_REQUESTED:
        if customer_user_id:
            recipients.append((customer_user_id, "document_update_requested"))
    elif event_type == EventType.TRANSACTION_ACTION_REQUIRED:
        if customer_user_id:
            recipients.append((customer_user_id, "transaction_action_required"))
    elif event_type == EventType.TRANSACTION_READY:
        if customer_user_id:
            recipients.append((customer_user_id, "transaction_ready"))
        if mediator_user_id:
            recipients.append((mediator_user_id, "transaction_ready"))
    elif event_type == EventType.TRANSACTION_CANCELLED:
        if customer_user_id:
            recipients.append((customer_user_id, "transaction_cancelled"))
        if mediator_user_id:
            recipients.append((mediator_user_id, "transaction_cancelled"))

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
    name="app.tasks.transaction_notifications.create_transaction_notification",
    bind=True,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=60,
    max_retries=5,
)
def create_transaction_notification(self, event_type: str, aggregate_id: str, payload: dict, trace_id: str | None = None) -> dict:
    if not is_enabled("negotiations"):
        return {"skipped": "feature_disabled"}

    from app.tasks.notifications import _deliver  # local import: avoids a module-load cycle at import time

    db = SessionLocal()
    try:
        transaction = db.get(PropertyTransaction, int(aggregate_id))
        if not transaction:
            return {"skipped": "transaction_not_found"}

        recipients = _recipients_for_event(db, event_type, transaction, payload)
        created = 0
        for user_id, notification_key in recipients:
            dedupe_key = f"{event_type}:{aggregate_id}:{user_id}"[:160]

            if db.scalar(select(Notification.id).where(Notification.dedupe_key == dedupe_key)) is not None:
                continue

            locale = _recipient_locale(db, user_id)
            title, body = _render(notification_key, transaction, locale=locale, extra=payload)

            notification = Notification(
                user_id=user_id,
                type=notification_key,
                title=title,
                body=body,
                locale=locale,
                entity_type="property_transaction",
                entity_id=transaction.id,
                property_id=transaction.property_id,
                deep_link=f"mymakan://partner/transactions/{transaction.id}",
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
