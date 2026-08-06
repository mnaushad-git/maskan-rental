"""Transactional outbox: write the event in the SAME database transaction as
the domain state change it describes. `record_event()` only calls `db.add()`
— it deliberately never commits — so callers must add it before their own
`db.commit()`. That's the entire guarantee: either both the state change and
the event row land together, or neither does (a rollback discards both).

See app/tasks/outbox.py for the publisher that picks pending rows up later.
"""
from typing import Any

from sqlalchemy.orm import Session

from app.core.request_context import get_request_id
from app.models.outbox_event import OutboxEvent


class EventType:
    PROPERTY_CREATED = "property.created"
    PROPERTY_UPDATED = "property.updated"
    PROPERTY_PUBLISHED = "property.published"
    PROPERTY_UNPUBLISHED = "property.unpublished"
    LEAD_CREATED = "lead.created"
    LEAD_STATUS_CHANGED = "lead.status_changed"
    LEAD_MESSAGE_ADDED = "lead.message_added"
    REVIEW_SUBMITTED = "review.submitted"
    REVIEW_APPROVED = "review.approved"
    MEDIATOR_SUBSCRIPTION_CHANGED = "mediator.subscription_changed"
    PAYMENT_COMPLETED = "payment.completed"
    SAVED_SEARCH_CREATED = "saved_search.created"
    SAVED_SEARCH_UPDATED = "saved_search.updated"
    IMPORT_COMPLETED = "import.completed"
    AI_RECOMMENDATION_GENERATED = "ai.recommendation_generated"
    PROPERTY_PRICE_CHANGED = "property.price_changed"
    PROPERTY_AVAILABILITY_CHANGED = "property.availability_changed"
    PROPERTY_VERIFIED = "property.verified"
    MEDIATOR_VERIFIED = "mediator.verified"
    USER_VERIFICATION_SUBMITTED = "user.verification_submitted"
    USER_VERIFIED = "user.verified"
    USER_SUBSCRIPTION_CHANGED = "user.subscription_changed"
    # ── Generic lead notifications (Phase 3) ────────────────────────────────
    # LEAD_CREATED, LEAD_STATUS_CHANGED, LEAD_MESSAGE_ADDED already existed
    # above (used previously for audit logging only — see app/tasks/outbox.py);
    # they are now ALSO consumed by app.tasks.lead_notifications to create
    # generic Notification rows. lead.viewing_scheduled and lead.reopened
    # from the platform spec have no backing domain feature in this app (no
    # viewing-scheduling flow, no "reopen a closed lead" action exists) and
    # are deliberately not modeled here — see DEPLOY.md notification-platform
    # notes for that scope call.
    LEAD_APPROVED = "lead.approved"
    LEAD_REJECTED = "lead.rejected"
    LEAD_ASSIGNED = "lead.assigned"
    LEAD_CLOSED = "lead.closed"
    # ── Property Request platform ───────────────────────────────────────────
    PROPERTY_REQUEST_CREATED = "property_request.created"
    PROPERTY_REQUEST_ACTIVATED = "property_request.activated"
    PROPERTY_REQUEST_UPDATED = "property_request.updated"
    PROPERTY_REQUEST_PAUSED = "property_request.paused"
    PROPERTY_REQUEST_RESUMED = "property_request.resumed"
    PROPERTY_REQUEST_CLOSED = "property_request.closed"
    PROPERTY_REQUEST_FULFILLED = "property_request.fulfilled"
    PROPERTY_REQUEST_EXPIRED = "property_request.expired"
    PROPERTY_REQUEST_MEDIATOR_RESPONSE_SUBMITTED = "property_request.mediator_response_submitted"


def record_event(
    db: Session,
    *,
    event_type: str,
    aggregate_type: str,
    aggregate_id: Any,
    payload: dict,
) -> OutboxEvent:
    event = OutboxEvent(
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=str(aggregate_id),
        payload=payload,
        trace_id=get_request_id(),
    )
    db.add(event)
    return event
