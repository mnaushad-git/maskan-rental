"""Notification Center APIs (Phase 6/8). Two routers in this module:
`router` (mounted at /notifications) and `preferences_router` (mounted at
/notification-preferences, a sibling top-level resource per the API spec —
see app/main.py)."""
import base64
import binascii
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_current_user, get_db
from app.core.audit import record_audit
from app.core.cache import CacheService
from app.core.config import settings
from app.core.feature_flags import is_enabled
from app.core.metrics import active_devices_total, notification_stream_connections, notifications_opened_total
from app.core.notification_stream import subscribe_events
from app.core.rate_limit import rate_limit_dependency
from app.db.session import SessionLocal
from app.models.notification import Notification
from app.models.notification_preference import NotificationPreference
from app.models.user import User as UserModel
from app.schemas.notification import (
    NotificationDeliveryOut,
    NotificationListResponse,
    NotificationOut,
    NotificationPreferenceOut,
    NotificationPreferenceUpdate,
    UnreadCountResponse,
)
from app.services.digest_scheduler import reschedule

router = APIRouter()
preferences_router = APIRouter()

UNREAD_CACHE_NAMESPACE = "notifications:unread"
UNREAD_CACHE_TTL_SECONDS = 60


def _unread_count(db: Session, user_id: int) -> int:
    cache = CacheService()

    def _load() -> int:
        return db.scalar(
            select(func.count()).select_from(Notification).where(Notification.user_id == user_id, Notification.read_at.is_(None))
        ) or 0

    # Namespaced under the user id directly (see key doc: maskan:notifications:unread:{user_id})
    return cache.get_or_set(UNREAD_CACHE_NAMESPACE, str(user_id), UNREAD_CACHE_TTL_SECONDS, _load)


def _invalidate_unread_cache(user_id: int) -> None:
    CacheService().delete(UNREAD_CACHE_NAMESPACE, str(user_id))


def _encode_cursor(created_at: datetime, notification_id: int) -> str:
    raw = f"{created_at.isoformat()}|{notification_id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        ts, nid = raw.rsplit("|", 1)
        return datetime.fromisoformat(ts), int(nid)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid cursor") from exc


@router.get("/", response_model=NotificationListResponse)
def list_notifications(
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    type_filter: str | None = Query(default=None, alias="type"),
    unread_only: bool = Query(default=False),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Notification).where(Notification.user_id == current_user.id)
    if type_filter:
        stmt = stmt.where(Notification.type == type_filter)
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    if cursor:
        created_at, notification_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Notification.created_at < created_at)
            | ((Notification.created_at == created_at) & (Notification.id < notification_id))
        )
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit + 1)
    rows = db.scalars(stmt).all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None

    now = datetime.now(timezone.utc)
    unseen = [n for n in rows if n.seen_at is None]
    for n in unseen:
        n.seen_at = now
    if unseen:
        db.commit()

    return NotificationListResponse(items=rows, next_cursor=next_cursor, unread_count=_unread_count(db, current_user.id))


@router.get("/unread-count", response_model=UnreadCountResponse)
def unread_count(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    return UnreadCountResponse(unread_count=_unread_count(db, current_user.id))


def _user_from_stream_token(token: str, db: Session) -> UserModel:
    """SSE auth (Phase 6/14): browsers' native EventSource can't set custom
    headers, so the stream endpoint accepts the same JWT as a `token` query
    param instead of an Authorization header. This is a short-lived,
    read-only, single-purpose connection (invalidation signals only, no
    notification content flows over it) — scoped to exactly one user's
    channel, same as every other authenticated endpoint."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid stream token")
        user = db.get(UserModel, int(user_id))
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid stream token") from exc
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid stream token")
    return user


@router.get("/stream")
def stream_notifications(request: Request, token: str = Query(...), db: Session = Depends(get_db)):
    """Server-Sent Events endpoint (Phase 6). Emits `event: invalidate`
    frames whenever a new/updated notification is published for this user —
    the client's job on receiving one is only to re-fetch
    `/notifications/unread-count` and the first page of `/notifications/`,
    never to trust stream payload content as canonical (see
    app.core.notification_stream module docstring). Falls back cleanly: if
    Redis is unavailable the generator yields nothing and the connection
    just idles until the client's own reconnect/polling fallback kicks in."""
    if not is_enabled("live_notification_stream"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Live notification stream is not enabled")
    user = _user_from_stream_token(token, db)

    def _gen():
        notification_stream_connections.inc()
        try:
            # Use a dedicated session for the lifetime of the connection —
            # this generator can run for minutes, far longer than a normal
            # request-scoped `db` session should be held open across.
            stream_db = SessionLocal()
            try:
                for frame in subscribe_events(user.id):
                    if request.client is None:
                        pass  # test client / no client info — keep streaming
                    yield frame
            finally:
                stream_db.close()
        finally:
            notification_stream_connections.dec()

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


def _get_owned(db: Session, notification_id: int, user: UserModel) -> Notification:
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    return notification


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    notification = _get_owned(db, notification_id, current_user)
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        notifications_opened_total.labels(type=notification.type).inc()
        db.commit()
        _invalidate_unread_cache(current_user.id)
    db.refresh(notification)
    return notification


@router.post("/read-all")
def mark_all_read(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.read_at.is_(None))
        .update({"read_at": now}, synchronize_session=False)
    )
    db.commit()
    if updated:
        _invalidate_unread_cache(current_user.id)
    return {"updated": updated}


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(notification_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    notification = _get_owned(db, notification_id, current_user)
    was_unread = notification.read_at is None
    db.delete(notification)
    db.commit()
    if was_unread:
        _invalidate_unread_cache(current_user.id)


# ── Preferences ──────────────────────────────────────────────────────────────

def _get_or_create_preferences(db: Session, user_id: int) -> NotificationPreference:
    prefs = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    if prefs is None:
        prefs = NotificationPreference(user_id=user_id)
        db.add(prefs)
        db.flush()  # materializes column defaults (digest_hour, timezone, ...) before reschedule() reads them
        reschedule(prefs)
        db.commit()
        db.refresh(prefs)
    elif prefs.next_daily_digest_at is None or prefs.next_weekly_digest_at is None:
        # Backfill for rows created before per-user digest scheduling shipped.
        reschedule(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


@preferences_router.get("/", response_model=NotificationPreferenceOut)
def get_preferences(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_or_create_preferences(db, current_user.id)


@preferences_router.patch("/", response_model=NotificationPreferenceOut)
def update_preferences(
    payload: NotificationPreferenceUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("notification_preferences_update", limit=30, window_seconds=3600, by_user=True)),
):
    prefs = _get_or_create_preferences(db, current_user.id)
    changes = payload.model_dump(exclude_unset=True)

    if "category_preferences" in changes:
        # Merge, don't replace: a PATCH that only sends {"lead_messages": ...}
        # must not silently reset every other category to its default.
        merged = dict(prefs.category_preferences or {})
        merged.update(changes.pop("category_preferences"))
        prefs.category_preferences = merged

    for field, value in changes.items():
        setattr(prefs, field, value)

    if {"digest_hour", "weekly_digest_day", "timezone"} & set(changes.keys()):
        reschedule(prefs)

    record_audit(db, user_id=current_user.id, action="notification_preferences.updated", entity_type="notification_preference", entity_id=prefs.id, metadata={"fields": list(payload.model_dump(exclude_unset=True).keys())})
    db.commit()
    db.refresh(prefs)
    return prefs


@preferences_router.post("/reset-defaults", response_model=NotificationPreferenceOut)
def reset_defaults(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models.notification_preference import default_category_preferences

    prefs = _get_or_create_preferences(db, current_user.id)
    prefs.in_app_enabled = True
    prefs.push_enabled = True
    prefs.email_enabled = False
    prefs.category_preferences = default_category_preferences()
    prefs.digest_hour = 8
    prefs.weekly_digest_day = 0
    prefs.quiet_hours_enabled = False
    prefs.quiet_hours_start = "22:00"
    prefs.quiet_hours_end = "07:00"
    prefs.quiet_hours_allow_urgent = True
    prefs.hide_message_preview = False
    reschedule(prefs)
    record_audit(db, user_id=current_user.id, action="notification_preferences.reset_defaults", entity_type="notification_preference", entity_id=prefs.id, metadata={})
    db.commit()
    db.refresh(prefs)
    return prefs


@preferences_router.post("/test-push")
def test_push(
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("notification_test_push", limit=5, window_seconds=3600, by_user=True)),
):
    """Sends a clear test payload to the caller's own registered devices
    only (Phase 4). Feature-flagged off in production unless explicitly
    enabled — see FEATURE_PUSH_TEST_ENDPOINT — since it's a real send
    against a real provider, not a dry run."""
    if not is_enabled("push_test_endpoint"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test push is not enabled")
    if settings.ENV == "production" and not settings.FEATURE_PUSH_TEST_ENDPOINT:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test push is not enabled")

    from app.models.device import Device

    devices = db.scalars(select(Device).where(Device.user_id == current_user.id, Device.enabled == True)).all()  # noqa: E712
    if not devices:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No registered devices found for this account")

    from app.core.notification_providers import get_push_provider

    provider = get_push_provider()
    results = []
    for device in devices:
        fake_notification = Notification(id=0, user_id=current_user.id, type="system_announcement", title="myHome test notification", body="This is a test push from your notification settings.", delivery_status={}, meta={})
        result = provider.send(device, fake_notification, title="myHome test notification", body="If you can see this, push notifications are working.")
        results.append({"device_id": device.id, "status": result.status, "detail": result.detail})
    record_audit(db, user_id=current_user.id, action="notification.test_push_sent", entity_type="user", entity_id=current_user.id, metadata={"device_count": len(devices)})
    return {"sent": len(devices), "results": results}


# ── Admin notification operations (Phase 9) ─────────────────────────────────

@router.get("/admin/overview")
def admin_overview(
    db: Session = Depends(get_db),
    _admin: UserModel = Depends(get_admin_user),
):
    """KPIs for the admin Notification Operations dashboard. Kept as plain
    aggregate SQL (no new reporting infra) — same convention as
    `app/api/routes/analytics.py`'s /summary endpoint."""
    from app.models.device import Device
    from app.models.digest_run import DigestRun
    from app.models.notification_delivery import NotificationDelivery
    from app.models.outbox_event import OutboxEvent

    now = datetime.now(timezone.utc)
    since_24h = now - timedelta(hours=24)

    notifications_created = db.scalar(select(func.count()).select_from(Notification).where(Notification.created_at >= since_24h)) or 0
    notifications_opened = db.scalar(select(func.count()).select_from(Notification).where(Notification.read_at.isnot(None), Notification.created_at >= since_24h)) or 0
    push_attempted = db.scalar(
        select(func.count()).select_from(NotificationDelivery).where(NotificationDelivery.channel == "push", NotificationDelivery.created_at >= since_24h)
    ) or 0
    push_accepted = db.scalar(
        select(func.count()).select_from(NotificationDelivery).where(
            NotificationDelivery.channel == "push", NotificationDelivery.status.in_(["accepted", "sent", "delivered"]), NotificationDelivery.created_at >= since_24h
        )
    ) or 0
    push_failed = db.scalar(
        select(func.count()).select_from(NotificationDelivery).where(
            NotificationDelivery.channel == "push", NotificationDelivery.status.in_(["failed", "provider_unavailable", "rate_limited"]), NotificationDelivery.created_at >= since_24h
        )
    ) or 0
    invalid_tokens = db.scalar(
        select(func.count()).select_from(NotificationDelivery).where(
            NotificationDelivery.channel == "push", NotificationDelivery.status.in_(["invalid_token", "unregistered_token", "permanent_rejection"]), NotificationDelivery.created_at >= since_24h
        )
    ) or 0
    digests_24h = db.scalar(select(func.count()).select_from(DigestRun).where(DigestRun.created_at >= since_24h)) or 0
    digest_failures_24h = db.scalar(select(func.count()).select_from(DigestRun).where(DigestRun.created_at >= since_24h, DigestRun.status == "failed")) or 0
    queue_backlog = db.scalar(select(func.count()).select_from(OutboxEvent).where(OutboxEvent.status == "pending")) or 0
    active_devices = db.scalar(select(func.count()).select_from(Device).where(Device.enabled == True)) or 0  # noqa: E712
    for plat in ("ios", "android", "web"):
        count = db.scalar(select(func.count()).select_from(Device).where(Device.enabled == True, Device.platform == plat)) or 0  # noqa: E712
        active_devices_total.labels(platform=plat).set(count)
    lead_notifications_24h = db.scalar(
        select(func.count()).select_from(Notification).where(Notification.type.like("lead_%"), Notification.created_at >= since_24h)
    ) or 0

    return {
        "window": "24h",
        "notifications_created": notifications_created,
        "notifications_opened": notifications_opened,
        "notification_open_rate": round(notifications_opened / notifications_created, 3) if notifications_created else 0,
        "push_attempted": push_attempted,
        "push_accepted": push_accepted,
        "push_failed": push_failed,
        "push_invalid_tokens": invalid_tokens,
        "digest_volume": digests_24h,
        "digest_failures": digest_failures_24h,
        "queue_backlog": queue_backlog,
        "active_devices": active_devices,
        "lead_notification_volume": lead_notifications_24h,
    }


@router.get("/admin/deliveries", response_model=list[NotificationDeliveryOut])
def admin_search_deliveries(
    notification_id: int | None = None,
    device_id: int | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    channel: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _admin: UserModel = Depends(get_admin_user),
):
    from app.models.notification_delivery import NotificationDelivery

    stmt = select(NotificationDelivery)
    if notification_id:
        stmt = stmt.where(NotificationDelivery.notification_id == notification_id)
    if device_id:
        stmt = stmt.where(NotificationDelivery.device_id == device_id)
    if status_filter:
        stmt = stmt.where(NotificationDelivery.status == status_filter)
    if channel:
        stmt = stmt.where(NotificationDelivery.channel == channel)
    stmt = stmt.order_by(NotificationDelivery.created_at.desc()).offset(skip).limit(min(limit, 200))
    return db.scalars(stmt).all()


@router.post("/admin/deliveries/{delivery_id}/retry")
def admin_retry_delivery(
    delivery_id: int,
    db: Session = Depends(get_db),
    admin: UserModel = Depends(get_admin_user),
):
    """Retry one failed push delivery attempt (Phase 9E). Audited; uses the
    same idempotent `deliver_push_notification` task as any other push
    redelivery, so double-clicking retry is safe."""
    from app.core.jobs import enqueue
    from app.models.notification_delivery import NotificationDelivery
    from app.tasks.notifications import deliver_push_notification

    delivery = db.get(NotificationDelivery, delivery_id)
    if not delivery or delivery.channel != "push" or not delivery.device_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Retryable push delivery not found")
    record_audit(db, user_id=admin.id, action="notification.admin_retry_delivery", entity_type="notification_delivery", entity_id=delivery.id, metadata={})
    db.commit()
    result = enqueue(deliver_push_notification, delivery.notification_id, delivery.device_id)
    return {"status": "enqueued", "task_id": getattr(result, "id", None)}


@router.post("/admin/digest/{user_id}/rerun")
def admin_rerun_digest(
    user_id: int,
    period: str = Query(default="daily"),
    db: Session = Depends(get_db),
    admin: UserModel = Depends(get_admin_user),
):
    """Force-generate a digest for one user right now (Phase 9E) — bypasses
    the (user, period, run_date) idempotency guard by using "today" in the
    user's own timezone, same as a normal scheduled run would; if that
    user's digest already ran today this is a safe no-op (0 sent), not a
    duplicate."""
    if period not in ("daily", "weekly"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period must be 'daily' or 'weekly'")
    from app.tasks.notifications import _run_digest_for_user

    prefs = _get_or_create_preferences(db, user_id)
    try:
        zone = ZoneInfo(prefs.timezone)
    except ZoneInfoNotFoundError:
        zone = timezone.utc
    run_date = datetime.now(timezone.utc).astimezone(zone).date()
    sent = _run_digest_for_user(db, user_id, period=period, run_date=run_date)
    record_audit(db, user_id=admin.id, action="notification.admin_rerun_digest", entity_type="user", entity_id=user_id, metadata={"period": period, "matches_sent": sent})
    db.commit()
    return {"user_id": user_id, "period": period, "run_date": run_date.isoformat(), "matches_included": sent}


@router.post("/admin/test-send")
def admin_test_send(
    user_id: int,
    db: Session = Depends(get_db),
    admin: UserModel = Depends(get_admin_user),
):
    """Send a test notification to one internal test account only (Phase
    9E) — deliberately requires an explicit `user_id`, never broadcasts."""
    from app.core.notification_providers import get_push_provider
    from app.models.device import Device

    target = db.get(UserModel, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    devices = db.scalars(select(Device).where(Device.user_id == user_id, Device.enabled == True)).all()  # noqa: E712
    provider = get_push_provider()
    sent = 0
    for device in devices:
        fake_notification = Notification(id=0, user_id=user_id, type="system_announcement", title="Admin test notification", body="Sent from the notification operations console.", delivery_status={}, meta={})
        provider.send(device, fake_notification, title="Admin test notification", body="Sent from the notification operations console.")
        sent += 1
    record_audit(db, user_id=admin.id, action="notification.admin_test_send", entity_type="user", entity_id=user_id, metadata={"device_count": sent})
    return {"sent": sent}
