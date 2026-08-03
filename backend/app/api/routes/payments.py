"""
Moyasar payment webhook handler.
TODO: Replace mock logic with real Moyasar webhook processing when keys are available.
Moyasar sends webhooks with X-Moyasar-Signature header (HMAC-SHA256).
"""
import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.cache import CacheService
from app.core.config import settings
from app.core.outbox import EventType, record_event
from app.models.mediator import Mediator
from app.models.payment import Payment
from app.models.user import User
from app.schemas.payment import PaymentOut

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/webhook/moyasar", status_code=200)
async def moyasar_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_moyasar_signature: str | None = Header(default=None),
):
    """
    Receives Moyasar payment events.
    Always returns 200 — Moyasar retries on non-200.
    """
    body = await request.body()

    # Verify signature when secret is configured
    if settings.MOYASAR_WEBHOOK_SECRET:
        if not x_moyasar_signature:
            raise HTTPException(status_code=400, detail="Missing webhook signature.")
        expected = hmac.new(
            settings.MOYASAR_WEBHOOK_SECRET.encode(),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected, x_moyasar_signature):
            raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    try:
        import json
        payload = json.loads(body)
    except Exception:
        return {"status": "ignored", "reason": "invalid JSON"}

    event_type = payload.get("type", "")
    data = payload.get("data", {})
    gateway_payment_id = data.get("id")

    # Idempotency: skip if already processed
    if gateway_payment_id:
        existing = db.query(Payment).filter(Payment.gateway_payment_id == gateway_payment_id).first()
        if existing and existing.status == "paid":
            return {"status": "already_processed"}

    if event_type == "payment.paid":
        _handle_payment_paid(data, db)
    elif event_type == "payment.failed":
        _handle_payment_failed(data, db)
    elif event_type in ("subscription.invoice.paid",):
        _handle_subscription_renewed(data, db)
    elif event_type == "subscription.cancelled":
        _handle_subscription_cancelled(data, db)
    else:
        logger.info(f"Unhandled Moyasar event: {event_type}")

    return {"status": "ok"}


def _handle_payment_paid(data: dict, db: Session) -> None:
    gateway_id = data.get("id")
    metadata = data.get("metadata", {})
    payment_type = metadata.get("payment_type")
    mediator_id = metadata.get("mediator_id")

    payment = db.query(Payment).filter(Payment.gateway_payment_id == gateway_id).first()
    if payment:
        payment.status = "paid"
        payment.paid_at = datetime.now(timezone.utc)
        payment.gateway_raw = data

    if payment_type == "subscription" and mediator_id:
        mediator = db.get(Mediator, int(mediator_id))
        if mediator:
            card_token = data.get("source", {}).get("token")
            mediator.subscription_status = "active"
            mediator.subscription_started_at = datetime.now(timezone.utc)
            mediator.subscription_expires_at = datetime.now(timezone.utc) + timedelta(days=30)
            if card_token:
                mediator.moyasar_card_token = card_token
            record_event(
                db,
                event_type=EventType.MEDIATOR_SUBSCRIPTION_CHANGED,
                aggregate_type="mediator",
                aggregate_id=mediator.id,
                payload={"mediator_id": mediator.id, "subscription_status": mediator.subscription_status},
            )
            CacheService().delete("mediator-public", str(mediator.id))

    if payment:
        record_event(
            db,
            event_type=EventType.PAYMENT_COMPLETED,
            aggregate_type="payment",
            aggregate_id=payment.id,
            payload={"payment_id": payment.id, "gateway_payment_id": gateway_id, "payment_type": payment_type},
        )

    db.commit()
    logger.info(f"Payment paid: {gateway_id}")


def _handle_payment_failed(data: dict, db: Session) -> None:
    gateway_id = data.get("id")
    payment = db.query(Payment).filter(Payment.gateway_payment_id == gateway_id).first()
    if payment:
        payment.status = "failed"
        payment.gateway_raw = data
        db.commit()
    # TODO: notify mediator by email that payment failed
    logger.info(f"Payment failed: {gateway_id}")


def _handle_subscription_renewed(data: dict, db: Session) -> None:
    mediator_id = data.get("metadata", {}).get("mediator_id")
    if mediator_id:
        mediator = db.get(Mediator, int(mediator_id))
        if mediator:
            base = mediator.subscription_expires_at or datetime.now(timezone.utc)
            mediator.subscription_expires_at = base + timedelta(days=30)
            mediator.subscription_status = "active"
            db.commit()
    logger.info(f"Subscription renewed for mediator {mediator_id}")


def _handle_subscription_cancelled(data: dict, db: Session) -> None:
    mediator_id = data.get("metadata", {}).get("mediator_id")
    if mediator_id:
        mediator = db.get(Mediator, int(mediator_id))
        if mediator:
            mediator.subscription_status = "cancelled"
            db.commit()
    logger.info(f"Subscription cancelled for mediator {mediator_id}")


# ── Admin: view payments ──────────────────────────────────────────────────────

@router.get("/", response_model=list[PaymentOut])
def admin_list_payments(
    mediator_id: int | None = None,
    status: str | None = None,
    payment_type: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    q = db.query(Payment)
    if mediator_id:
        q = q.filter(Payment.mediator_id == mediator_id)
    if status:
        q = q.filter(Payment.status == status)
    if payment_type:
        q = q.filter(Payment.payment_type == payment_type)
    return q.order_by(Payment.created_at.desc()).offset(skip).limit(limit).all()
