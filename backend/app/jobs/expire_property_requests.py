from datetime import datetime, timedelta, timezone

# Arbitrary, must stay unique across jobs sharing app/core/locks.pg_advisory_lock.
_LOCK_KEY = 7270002


def process_property_request_expiry() -> None:
    """Runs periodically via APScheduler (see app/main.py):
    1. Sends an `expiring` notification once per request, `PROPERTY_REQUEST_EXPIRING_SOON_DAYS`
       before `expiry_date` (deduped via Notification.dedupe_key — never resent).
    2. Expires active requests whose `expiry_date` has passed: status -> "expired",
       matching disabled, an `expired` outbox event + notification.
    Both steps are dedupe-safe against a duplicate/overlapping run.
    """
    from app.core.config import settings
    from app.core.feature_flags import is_enabled
    from app.core.locks import pg_advisory_lock
    from app.core.outbox import EventType, record_event
    from app.db.session import SessionLocal
    from app.models.property_request import PropertyRequest, PropertyRequestActivity

    if not is_enabled("property_requests"):
        return

    db = SessionLocal()
    try:
        with pg_advisory_lock(db, _LOCK_KEY) as acquired:
            if not acquired:
                return

            now = datetime.now(timezone.utc)

            if is_enabled("property_request_notifications"):
                from app.services.property_request_notifications import create_and_deliver

                soon_cutoff = now + timedelta(days=settings.PROPERTY_REQUEST_EXPIRING_SOON_DAYS)
                expiring_soon = (
                    db.query(PropertyRequest)
                    .filter(PropertyRequest.status == "active", PropertyRequest.expiry_date.isnot(None), PropertyRequest.expiry_date <= soon_cutoff, PropertyRequest.expiry_date > now)
                    .all()
                )
                for pr in expiring_soon:
                    days_left = max(0, (pr.expiry_date - now).days)
                    create_and_deliver(db, request=pr, change_type="expiring", context={"days": days_left, "dedupe_suffix": f"d{days_left}"})
                db.commit()

            expired = db.query(PropertyRequest).filter(PropertyRequest.status == "active", PropertyRequest.expiry_date.isnot(None), PropertyRequest.expiry_date <= now).all()
            for pr in expired:
                pr.status = "expired"
                pr.matching_enabled = False
                db.add(PropertyRequestActivity(request_id=pr.id, actor_type="system", actor_id=None, activity_type="expired"))
                record_event(db, event_type=EventType.PROPERTY_REQUEST_EXPIRED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id})
            db.commit()

            if is_enabled("property_request_notifications"):
                from app.services.property_request_notifications import create_and_deliver

                for pr in expired:
                    create_and_deliver(db, request=pr, change_type="expired")
                db.commit()
    finally:
        db.close()
