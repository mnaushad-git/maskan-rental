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
    IMPORT_COMPLETED = "import.completed"
    AI_RECOMMENDATION_GENERATED = "ai.recommendation_generated"


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
