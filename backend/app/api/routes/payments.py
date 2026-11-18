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
from app.core.metrics import payment_webhooks_total
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

    # A webhook can grant paid access, so it is only ever trusted when it is
    # signed. Previously an unset MOYASAR_WEBHOOK_SECRET skipped verification
    # entirely, letting anyone POST a forged "payment.paid" and activate any
    # subscription. Fail closed: no secret configured → refuse every webhook.
    if not settings.MOYASAR_WEBHOOK_SECRET:
        logger.error("Moyasar webhook received but MOYASAR_WEBHOOK_SECRET is not configured — rejected")
        raise HTTPException(status_code=503, detail="Payment webhooks are not configured.")
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

    payment_webhooks_total.labels(event_type=event_type or "unknown").inc()

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


def _amount_matches(data: dict, payment: Payment) -> bool:
    """Moyasar reports amounts in halalas. When the webhook carries an amount
    or currency, it must match the payment we created."""
    amount = data.get("amount")
    if amount is not None:
        try:
            if int(amount) != int(round(float(payment.amount) * 100)):
                return False
        except (TypeError, ValueError):
            return False
    currency = data.get("currency")
    if currency and payment.currency and str(currency).upper() != str(payment.currency).upper():
        return False
    return True


def _extend(expires_at: datetime | None) -> datetime:
    now = datetime.now(timezone.utc)
    base = expires_at if expires_at and expires_at > now else now
    return base + timedelta(days=30)


def _handle_payment_paid(data: dict, db: Session) -> None:
    """Grant access ONLY for a payment Maskan itself created (pending row with
    this gateway id). The subscriber is taken from that row — never from the
    webhook's metadata — and the paid amount must match."""
    gateway_id = data.get("id")
    payment = (
        db.query(Payment).filter(Payment.gateway_payment_id == gateway_id).first() if gateway_id else None
    )
    if payment is None:
        logger.warning("payment.paid for unknown gateway payment %s — ignored", gateway_id)
        return
    if payment.status != "pending":
        logger.info("payment.paid for payment %s in status %s — ignored", payment.id, payment.status)
        return
    if not _amount_matches(data, payment):
        logger.error("payment.paid amount/currency mismatch for payment %s — ignored", payment.id)
        return

    payment.status = "paid"
    payment.paid_at = datetime.now(timezone.utc)
    payment.gateway_raw = data
    card_token = (data.get("source") or {}).get("token")

    if payment.payment_type == "subscription" and payment.mediator_id:
        mediator = db.get(Mediator, payment.mediator_id)
        if mediator:
            if mediator.subscription_status != "active":
                mediator.subscription_started_at = datetime.now(timezone.utc)
            mediator.subscription_expires_at = _extend(
                mediator.subscription_expires_at if mediator.subscription_status == "active" else None
            )
            mediator.subscription_status = "active"
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
    elif payment.payment_type == "subscription" and payment.user_id:
        user = db.get(User, payment.user_id)
        if user:
            if user.subscription_status != "active":
                user.subscription_started_at = datetime.now(timezone.utc)
            user.subscription_expires_at = _extend(
                user.subscription_expires_at if user.subscription_status == "active" else None
            )
            user.subscription_status = "active"
            user.subscription_tier = "premium"
            if card_token:
                user.moyasar_card_token = card_token
            record_event(
                db,
                event_type=EventType.USER_SUBSCRIPTION_CHANGED,
                aggregate_type="user",
                aggregate_id=user.id,
                payload={"user_id": user.id, "subscription_status": user.subscription_status},
            )

    record_event(
        db,
        event_type=EventType.PAYMENT_COMPLETED,
        aggregate_type="payment",
        aggregate_id=payment.id,
        payload={"payment_id": payment.id, "gateway_payment_id": gateway_id, "payment_type": payment.payment_type},
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
    metadata = data.get("metadata", {})
    mediator_id = metadata.get("mediator_id")
    user_id = metadata.get("user_id")
    if mediator_id:
        mediator = db.get(Mediator, int(mediator_id))
        if mediator:
            base = mediator.subscription_expires_at or datetime.now(timezone.utc)
            mediator.subscription_expires_at = base + timedelta(days=30)
            mediator.subscription_status = "active"
            db.commit()
    elif user_id:
        user = db.get(User, int(user_id))
        if user:
            base = user.subscription_expires_at or datetime.now(timezone.utc)
            user.subscription_expires_at = base + timedelta(days=30)
            user.subscription_status = "active"
            db.commit()
    logger.info(f"Subscription renewed for mediator={mediator_id} user={user_id}")


def _handle_subscription_cancelled(data: dict, db: Session) -> None:
    metadata = data.get("metadata", {})
    mediator_id = metadata.get("mediator_id")
    user_id = metadata.get("user_id")
    if mediator_id:
        mediator = db.get(Mediator, int(mediator_id))
        if mediator:
            mediator.subscription_status = "cancelled"
            db.commit()
    elif user_id:
        user = db.get(User, int(user_id))
        if user:
            user.subscription_status = "cancelled"
            db.commit()
    logger.info(f"Subscription cancelled for mediator={mediator_id} user={user_id}")


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
