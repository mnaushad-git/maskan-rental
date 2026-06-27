from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

from app.api.deps import get_admin_user, get_current_user, get_db, get_mediator_user
from app.core.config import settings
from app.models.mediator import Mediator, MediatorArea
from app.models.user import User
from app.schemas.mediator import (
    AdminPartnerCreate,
    MediatorAdminUpdate,
    MediatorAreaCreate,
    MediatorAreaOut,
    MediatorCreate,
    MediatorOut,
    MediatorPublicOut,
    MediatorUpdate,
)

router = APIRouter()


# ── Registration ──────────────────────────────────────────────────────────────

@router.post("/register", response_model=MediatorOut, status_code=201)
def register_mediator(
    body: MediatorCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a mediator profile for the logged-in user."""
    existing = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    if existing:
        raise HTTPException(status_code=409, detail="You already have a mediator profile.")
    mediator = Mediator(
        user_id=current_user.id,
        license_number=body.license_number,
        agency_name=body.agency_name,
        phone=body.phone,
        bio=body.bio,
        profile_image_url=body.profile_image_url,
        subscription_status="pending_payment",
    )
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    # TODO: generate Moyasar payment URL for SAR 99 subscription and return it
    # payment_url = moyasar_client.create_payment(amount=settings.SUBSCRIPTION_FEE_SAR * 100, ...)
    return mediator


# ── Profile ───────────────────────────────────────────────────────────────────

@router.get("/me", response_model=MediatorOut)
def get_my_mediator_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    if not mediator:
        raise HTTPException(status_code=404, detail="No mediator profile found.")
    return mediator


@router.patch("/me", response_model=MediatorOut)
def update_my_mediator_profile(
    body: MediatorUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    if not mediator:
        raise HTTPException(status_code=404, detail="No mediator profile found.")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(mediator, field, value)
    db.commit()
    db.refresh(mediator)
    return mediator


# ── Subscription payment (mock) ───────────────────────────────────────────────

@router.post("/me/subscribe")
def subscribe_mediator(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initiate the SAR 99/month subscription payment via Moyasar.
    TODO: Replace mock with real Moyasar API call when key is available.
    Returns a payment_url for the frontend to redirect to.
    """
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    if not mediator:
        raise HTTPException(status_code=404, detail="No mediator profile found. Register first.")
    if mediator.subscription_status == "active":
        raise HTTPException(status_code=400, detail="Subscription is already active.")

    # MOCK: simulate successful payment — in production, create Moyasar payment and return URL
    mediator.subscription_status = "active"
    mediator.subscription_started_at = datetime.now(timezone.utc)
    mediator.subscription_expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    mediator.moyasar_card_token = "mock_card_token_replace_with_real"
    db.commit()
    db.refresh(mediator)

    return {
        "status": "active",
        "message": "Subscription activated (mock). Replace with Moyasar payment flow.",
        "subscription_expires_at": mediator.subscription_expires_at,
        # TODO: "payment_url": moyasar_payment_url
    }


@router.post("/me/renew")
def renew_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Renew subscription manually for another 30 days."""
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    if not mediator:
        raise HTTPException(status_code=404, detail="No mediator profile found.")

    # MOCK: simulate successful renewal payment
    # TODO: charge mediator.moyasar_card_token via Moyasar API
    now = datetime.now(timezone.utc)
    base = mediator.subscription_expires_at if mediator.subscription_expires_at and mediator.subscription_expires_at > now else now
    mediator.subscription_expires_at = base + timedelta(days=30)
    mediator.subscription_status = "active"
    db.commit()
    db.refresh(mediator)
    return {"status": "renewed", "subscription_expires_at": mediator.subscription_expires_at}


# ── Areas ─────────────────────────────────────────────────────────────────────

@router.get("/me/areas", response_model=list[MediatorAreaOut])
def get_my_areas(
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    _user, mediator = mediator_tuple
    return mediator.areas


@router.post("/me/areas", response_model=MediatorAreaOut, status_code=201)
def add_area(
    body: MediatorAreaCreate,
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    _user, mediator = mediator_tuple
    existing = db.query(MediatorArea).filter(
        MediatorArea.mediator_id == mediator.id,
        MediatorArea.area_name.ilike(body.area_name),
        MediatorArea.city.ilike(body.city),
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="You already cover this area.")
    area = MediatorArea(mediator_id=mediator.id, area_name=body.area_name, city=body.city)
    db.add(area)
    db.commit()
    db.refresh(area)
    return area


@router.delete("/me/areas/{area_id}", status_code=204)
def remove_area(
    area_id: int,
    db: Session = Depends(get_db),
    mediator_tuple: tuple = Depends(get_mediator_user),
):
    _user, mediator = mediator_tuple
    area = db.query(MediatorArea).filter(MediatorArea.id == area_id, MediatorArea.mediator_id == mediator.id).first()
    if not area:
        raise HTTPException(status_code=404, detail="Area not found.")
    db.delete(area)
    db.commit()


# ── Public directory ──────────────────────────────────────────────────────────

@router.get("/public", response_model=list[MediatorPublicOut])
def list_public_mediators(
    city: str | None = None,
    db: Session = Depends(get_db),
):
    """Return active partners for the public directory. No auth required."""
    q = db.query(Mediator).filter(Mediator.subscription_status == "active")
    if city:
        q = (
            q.join(MediatorArea, Mediator.id == MediatorArea.mediator_id)
            .filter(MediatorArea.city.ilike(city))
            .distinct()
        )
    return (
        q.order_by(Mediator.is_verified.desc(), Mediator.total_leads_accepted.desc())
        .all()
    )


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/", response_model=list[MediatorOut])
def admin_list_mediators(
    status: str | None = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    q = db.query(Mediator)
    if status:
        q = q.filter(Mediator.subscription_status == status)
    return q.offset(skip).limit(limit).all()


@router.patch("/{mediator_id}", response_model=MediatorOut)
def admin_update_mediator(
    mediator_id: int,
    body: MediatorAdminUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    mediator = db.get(Mediator, mediator_id)
    if not mediator:
        raise HTTPException(status_code=404, detail="Mediator not found.")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(mediator, field, value)
    db.commit()
    db.refresh(mediator)
    return mediator


@router.post("/admin/create", response_model=MediatorOut, status_code=201)
def admin_create_partner(
    body: AdminPartnerCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Admin creates a partner user + mediator profile in one step."""
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status_code=409, detail="Email already registered.")

    user = User(
        email=email,
        full_name=body.full_name,
        hashed_password=_pwd.hash(body.password),
    )
    db.add(user)
    db.flush()

    now = datetime.now(timezone.utc)
    mediator = Mediator(
        user_id=user.id,
        license_number=body.license_number,
        agency_name=body.agency_name,
        phone=body.phone,
        bio=body.bio,
        is_verified=body.is_verified,
        subscription_status=body.subscription_status,
        subscription_started_at=now if body.subscription_status == "active" else None,
        subscription_expires_at=now + timedelta(days=365) if body.subscription_status == "active" else None,
    )
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    return mediator
