from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import _sync_subscription_expiry, get_current_user, get_db, get_premium_user
from app.core.config import settings
from app.core.moyasar import get_payment_gateway_provider
from app.core.outbox import EventType, record_event
from app.models.payment import Payment
from app.models.user import User
from app.schemas.subscription import SubscriptionOut

router = APIRouter()

# Real vs mock is decided per-call by settings.USE_REAL_PAYMENTS (and requires
# MOYASAR_SECRET_KEY) — see app.core.moyasar. Same flow as the mediator
# subscription in mediators.py, reused here for renter premium ("AI Alert Plus").


def _real_payments_enabled() -> bool:
    return bool(settings.USE_REAL_PAYMENTS and settings.MOYASAR_SECRET_KEY)


@router.get("/me", response_model=SubscriptionOut)
def get_my_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _sync_subscription_expiry(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/subscribe")
def subscribe(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Initiate the renter premium subscription payment via Moyasar. Returns
    a payment_url for the frontend to redirect to (real flow), or activates
    immediately (mock flow — USE_REAL_PAYMENTS unset/false)."""
    _sync_subscription_expiry(current_user)
    if current_user.subscription_status == "active":
        raise HTTPException(status_code=400, detail="Premium subscription is already active.")

    if _real_payments_enabled():
        result = get_payment_gateway_provider().create_subscription_invoice(
            amount_sar=settings.RENTER_PREMIUM_FEE_SAR,
            description=f"Maskan renter premium subscription (SAR {settings.RENTER_PREMIUM_FEE_SAR}/month)",
            metadata={"payment_type": "subscription", "user_id": str(current_user.id)},
            success_url=f"{settings.FRONTEND_ORIGIN}/premium?status=success",
            back_url=f"{settings.FRONTEND_ORIGIN}/premium?status=cancelled",
        )
        if not result.success:
            raise HTTPException(status_code=502, detail=f"Could not start payment with Moyasar: {result.error}")
        payment = Payment(
            user_id=current_user.id,
            payment_type="subscription",
            amount=settings.RENTER_PREMIUM_FEE_SAR,
            currency="SAR",
            status="pending",
            gateway="moyasar",
            gateway_payment_id=result.gateway_payment_id,
            gateway_raw=result.raw,
            description=f"Renter premium subscription — SAR {settings.RENTER_PREMIUM_FEE_SAR}/month",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)
        return {
            "status": "pending",
            "message": "Redirect to payment_url to complete payment via Moyasar. Subscription activates once the charge clears.",
            "payment_url": result.payment_url,
            "payment_id": payment.id,
        }

    # MOCK: simulate successful payment. Set USE_REAL_PAYMENTS=true (with
    # MOYASAR_SECRET_KEY configured) to use the real charge/webhook flow above.
    current_user.subscription_status = "active"
    current_user.subscription_tier = "premium"
    current_user.subscription_started_at = datetime.now(timezone.utc)
    current_user.subscription_expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    current_user.moyasar_card_token = "mock_card_token_replace_with_real"
    record_event(
        db,
        event_type=EventType.USER_SUBSCRIPTION_CHANGED,
        aggregate_type="user",
        aggregate_id=current_user.id,
        payload={"user_id": current_user.id, "subscription_status": current_user.subscription_status},
    )
    db.commit()
    db.refresh(current_user)
    return {
        "status": "active",
        "message": "Premium subscription activated (mock). Set USE_REAL_PAYMENTS=true for the real Moyasar payment flow.",
        "subscription_expires_at": current_user.subscription_expires_at,
    }


@router.post("/me/renew")
def renew_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Renew the renter premium subscription for another 30 days."""
    if _real_payments_enabled():
        if not current_user.moyasar_card_token or current_user.moyasar_card_token == "mock_card_token_replace_with_real":
            raise HTTPException(
                status_code=400,
                detail="No saved card on file. Complete a subscription payment via POST /me/subscribe first.",
            )
        result = get_payment_gateway_provider().charge_saved_card(
            token=current_user.moyasar_card_token,
            amount_sar=settings.RENTER_PREMIUM_FEE_SAR,
            description=f"Maskan renter premium subscription renewal (SAR {settings.RENTER_PREMIUM_FEE_SAR}/month)",
            metadata={"payment_type": "subscription", "user_id": str(current_user.id)},
        )
        if not result.success:
            raise HTTPException(status_code=502, detail=f"Renewal charge failed: {result.error}")
        payment = Payment(
            user_id=current_user.id,
            payment_type="subscription",
            amount=settings.RENTER_PREMIUM_FEE_SAR,
            currency="SAR",
            status="pending",
            gateway="moyasar",
            gateway_payment_id=result.gateway_payment_id,
            gateway_raw=result.raw,
            description=f"Renter premium subscription renewal — SAR {settings.RENTER_PREMIUM_FEE_SAR}/month",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)
        return {
            "status": "pending",
            "message": "Renewal charge submitted to Moyasar. Subscription extends once the charge clears.",
            "payment_id": payment.id,
        }

    # MOCK: simulate successful renewal payment.
    now = datetime.now(timezone.utc)
    base = current_user.subscription_expires_at if current_user.subscription_expires_at and current_user.subscription_expires_at > now else now
    current_user.subscription_expires_at = base + timedelta(days=30)
    current_user.subscription_status = "active"
    db.commit()
    db.refresh(current_user)
    return {"status": "renewed", "subscription_expires_at": current_user.subscription_expires_at}


@router.post("/me/unsubscribe")
def unsubscribe(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel the renter's premium subscription immediately — access to
    premium-only features stops right away (no cancel-at-period-end)."""
    _sync_subscription_expiry(current_user)
    if current_user.subscription_status != "active":
        raise HTTPException(status_code=400, detail=f"No active subscription to cancel (status: '{current_user.subscription_status}').")
    current_user.subscription_status = "cancelled"
    record_event(
        db,
        event_type=EventType.USER_SUBSCRIPTION_CHANGED,
        aggregate_type="user",
        aggregate_id=current_user.id,
        payload={"user_id": current_user.id, "subscription_status": current_user.subscription_status},
    )
    db.commit()
    db.refresh(current_user)
    return {"status": "cancelled"}


# ── Example premium-gated endpoint ──────────────────────────────────────────
# Demonstrates the get_premium_user gate; future premium features (AI Alert
# Plus, unlimited AI Advisor chat) hang their own routes off this dependency.

@router.get("/premium-status")
def premium_status(current_user: User = Depends(get_premium_user)):
    return {"premium": True, "subscription_expires_at": current_user.subscription_expires_at}
