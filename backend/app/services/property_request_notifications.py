"""Property Request notification creation. Reuses the exact same delivery
pipeline (`app.tasks.notifications._deliver` — channel/quiet-hours
resolution, NotificationDelivery audit rows, push/email dispatch) as
saved-search and lead notifications, so there is exactly one place in the
codebase that actually sends a push/email. This module only decides WHEN a
`property_request_*` Notification row should be created; `app.tasks.notifications`
owns HOW it's delivered — see Phase 11 of the platform plan.

`dedupe_key` follows the same `f"{type}:{aggregate}:{user_id}"`-shaped
convention as lead notifications (see Notification.dedupe_key docstring) so
a retried matching/lifecycle job can never create a duplicate alert.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.metrics import notifications_created_total
from app.core.notification_stream import publish_invalidate
from app.core.notification_templates import render_property_request
from app.models.notification import Notification
from app.models.property import Property
from app.models.property_request import PropertyRequest
from app.models.property_request_match import PropertyRequestMatch


def _dedupe_key(notification_type: str, request_id: int, suffix: str) -> str:
    return f"{notification_type}:{request_id}:{suffix}"[:160]


def create_and_deliver(
    db: Session,
    *,
    request: PropertyRequest,
    change_type: str,
    prop: Property | None = None,
    match: PropertyRequestMatch | None = None,
    context: dict | None = None,
    ai_generated: bool = False,
    channels: list[str] | None = None,
) -> Notification | None:
    from app.tasks.notifications import _deliver, _invalidate_unread_count_cache

    context = context or {}
    notification_type = f"property_request_{change_type}"
    suffix = str(match.id) if match else str(context.get("dedupe_suffix", change_type))
    dedupe_key = _dedupe_key(notification_type, request.id, suffix)

    existing = db.query(Notification.id).filter(Notification.dedupe_key == dedupe_key).first()
    if existing is not None:
        return None

    title, body, deep_link = render_property_request(
        change_type=change_type, request=request, prop=prop, match_id=match.id if match else None, context=context
    )
    notification = Notification(
        user_id=request.user_id,
        type=notification_type,
        title=title,
        body=body,
        locale=request.locale,
        entity_type="property_request",
        entity_id=request.id,
        property_id=prop.id if prop else None,
        match_reasons=match.match_reasons if match else None,
        deep_link=deep_link,
        delivery_status={},
        ai_generated=ai_generated,
        meta={"match_id": match.id if match else None, "request_id": request.id},
        dedupe_key=dedupe_key,
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.NOTIFICATION_RETENTION_DAYS),
    )
    db.add(notification)
    db.flush()
    notifications_created_total.labels(type=notification_type).inc()
    _deliver(db, notification, channels or ["in_app", "push"])
    _invalidate_unread_count_cache(request.user_id)
    publish_invalidate(request.user_id, reason=notification_type)
    return notification
