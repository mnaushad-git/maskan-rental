from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from sqlalchemy import func, select
from sqlalchemy.orm import Session

_pwd = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

from app.api.deps import get_admin_user, get_current_user, get_db, get_mediator_user
from app.api.routes.reviews import get_mediator_summary
from app.core.cache import CacheService
from app.core.config import settings
from app.core.moyasar import get_payment_gateway_provider
from app.core.outbox import EventType, record_event
from app.models.lead import LeadAssignment
from app.models.mediator import Mediator, MediatorArea
from app.models.payment import Payment
from app.models.property import Property
from app.models.review import Review
from app.models.user import User
from app.schemas.mediator import (
    MEDIATOR_VERIFIED_LABEL,
    AdminPartnerCreate,
    MediatorAdminUpdate,
    MediatorAreaCreate,
    MediatorAreaOut,
    MediatorCreate,
    MediatorOut,
    MediatorPublicOut,
    MediatorUpdate,
)
from app.schemas.review_summary import ReviewSummaryOut
from app.services import review_summary as review_summary_service

router = APIRouter()

_PUBLIC_PROFILE_NAMESPACE = "mediator-public"
_PUBLIC_PROFILE_TTL_SECONDS = 300


def _invalidate_public_profile_cache(mediator_id: int) -> None:
    CacheService().delete(_PUBLIC_PROFILE_NAMESPACE, str(mediator_id))


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
        approval_status="pending",  # blocked until an admin approves
    )
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    # Payment is a separate step: call POST /me/subscribe to get the
    # Moyasar payment_url (real or mocked, per USE_REAL_PAYMENTS).
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
    _invalidate_public_profile_cache(mediator.id)
    return mediator


# ── Subscription payment ─────────────────────────────────────────────────────
# Real vs mock is decided per-call by settings.USE_REAL_PAYMENTS (and requires
# MOYASAR_SECRET_KEY) — see app.core.moyasar. With it on, these endpoints only
# *start* a Moyasar charge and record a `pending` Payment; activation happens
# asynchronously via the /api/payments/webhook/moyasar handler once Moyasar
# confirms the charge. With it off, behavior is byte-for-byte the original
# instant-activation mock.

def _real_payments_enabled() -> bool:
    return bool(settings.USE_REAL_PAYMENTS and settings.MOYASAR_SECRET_KEY)


@router.post("/me/subscribe")
def subscribe_mediator(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Initiate the SAR 99/month subscription payment via Moyasar.
    Returns a payment_url for the frontend to redirect to (real flow), or
    activates immediately (mock flow — USE_REAL_PAYMENTS unset/false).
    """
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    if not mediator:
        raise HTTPException(status_code=404, detail="No mediator profile found. Register first.")
    if mediator.subscription_status == "active":
        raise HTTPException(status_code=400, detail="Subscription is already active.")

    if _real_payments_enabled():
        result = get_payment_gateway_provider().create_subscription_invoice(
            amount_sar=settings.SUBSCRIPTION_FEE_SAR,
            description=f"Maskan mediator subscription (SAR {settings.SUBSCRIPTION_FEE_SAR}/month)",
            metadata={"payment_type": "subscription", "mediator_id": str(mediator.id)},
            success_url=f"{settings.FRONTEND_ORIGIN}/mediator/subscription?status=success",
            back_url=f"{settings.FRONTEND_ORIGIN}/mediator/subscription?status=cancelled",
        )
        if not result.success:
            raise HTTPException(status_code=502, detail=f"Could not start payment with Moyasar: {result.error}")
        payment = Payment(
            mediator_id=mediator.id,
            payment_type="subscription",
            amount=settings.SUBSCRIPTION_FEE_SAR,
            currency="SAR",
            status="pending",
            gateway="moyasar",
            gateway_payment_id=result.gateway_payment_id,
            gateway_raw=result.raw,
            description="Mediator subscription — SAR 99/month",
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
    mediator.subscription_status = "active"
    mediator.subscription_started_at = datetime.now(timezone.utc)
    mediator.subscription_expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    mediator.moyasar_card_token = "mock_card_token_replace_with_real"
    db.commit()
    db.refresh(mediator)
    _invalidate_public_profile_cache(mediator.id)

    return {
        "status": "active",
        "message": "Subscription activated (mock). Set USE_REAL_PAYMENTS=true for the real Moyasar payment flow.",
        "subscription_expires_at": mediator.subscription_expires_at,
    }


@router.post("/me/renew")
def renew_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Renew subscription for another 30 days."""
    mediator = db.query(Mediator).filter(Mediator.user_id == current_user.id).first()
    if not mediator:
        raise HTTPException(status_code=404, detail="No mediator profile found.")

    if _real_payments_enabled():
        if not mediator.moyasar_card_token or mediator.moyasar_card_token == "mock_card_token_replace_with_real":
            raise HTTPException(
                status_code=400,
                detail="No saved card on file. Complete a subscription payment via POST /me/subscribe first.",
            )
        result = get_payment_gateway_provider().charge_saved_card(
            token=mediator.moyasar_card_token,
            amount_sar=settings.SUBSCRIPTION_FEE_SAR,
            description=f"Maskan mediator subscription renewal (SAR {settings.SUBSCRIPTION_FEE_SAR}/month)",
            metadata={"payment_type": "subscription", "mediator_id": str(mediator.id)},
        )
        if not result.success:
            raise HTTPException(status_code=502, detail=f"Renewal charge failed: {result.error}")
        payment = Payment(
            mediator_id=mediator.id,
            payment_type="subscription",
            amount=settings.SUBSCRIPTION_FEE_SAR,
            currency="SAR",
            status="pending",
            gateway="moyasar",
            gateway_payment_id=result.gateway_payment_id,
            gateway_raw=result.raw,
            description="Mediator subscription renewal — SAR 99/month",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)
        return {
            "status": "pending",
            "message": "Renewal charge submitted to Moyasar. Subscription extends once the charge clears.",
            "payment_id": payment.id,
        }

    # MOCK: simulate successful renewal payment. Set USE_REAL_PAYMENTS=true
    # (with a saved card on file) for the real Moyasar charge/webhook flow above.
    now = datetime.now(timezone.utc)
    base = mediator.subscription_expires_at if mediator.subscription_expires_at and mediator.subscription_expires_at > now else now
    mediator.subscription_expires_at = base + timedelta(days=30)
    mediator.subscription_status = "active"
    db.commit()
    db.refresh(mediator)
    _invalidate_public_profile_cache(mediator.id)
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
# Trust & Activity fields (Prompt 4 — Property Verification & Trust Center,
# spec section 11): verification status, rating, review count, listing
# counts by transaction type, areas covered (already `MediatorPublicOut.
# areas`), member-since, and response info if available. Every value below
# is deterministic — computed from mediator.py/review.py/property.py/lead.py
# data that already exists, no new tracking infrastructure, no LLM.


def _bulk_mediator_trust_activity_fields(db: Session, mediator_ids: list[int]) -> dict[int, dict]:
    """One grouped query per data source across ALL given mediator ids (never
    a per-mediator query) so the `/public` list endpoint stays N+1-free —
    same "load once, reuse everywhere" discipline Prompt 2's `/trust`
    endpoint and Prompt 3's `/quality` endpoint already follow. Safe to call
    with a single-element list from `get_public_mediator` too."""
    fields: dict[int, dict] = {
        mid: {
            "avg_rating": None,
            "review_count": 0,
            "active_listing_count": 0,
            "rental_listing_count": 0,
            "sale_listing_count": 0,
            "response_rate": None,
            "avg_response_time_hours": None,
        }
        for mid in mediator_ids
    }
    if not mediator_ids:
        return fields

    # Reviews — approved only, the same visibility rule
    # `reviews.py`'s public endpoints already enforce.
    review_rows = db.execute(
        select(Review.mediator_id, Review.rating).where(
            Review.mediator_id.in_(mediator_ids), Review.status == "approved"
        )
    ).all()
    ratings_by_mediator: dict[int, list[int]] = defaultdict(list)
    for mediator_id, rating in review_rows:
        ratings_by_mediator[mediator_id].append(rating)
    for mediator_id, ratings in ratings_by_mediator.items():
        fields[mediator_id]["review_count"] = len(ratings)
        fields[mediator_id]["avg_rating"] = round(sum(ratings) / len(ratings), 1) if ratings else None

    # Listings — Published ("active") only, split by rent/sale.
    listing_rows = db.execute(
        select(Property.mediator_id, Property.listing_type, func.count(Property.id))
        .where(Property.mediator_id.in_(mediator_ids), Property.status == "Published")
        .group_by(Property.mediator_id, Property.listing_type)
    ).all()
    for mediator_id, listing_type, count in listing_rows:
        if listing_type == "sale":
            fields[mediator_id]["sale_listing_count"] += count
        else:
            fields[mediator_id]["rental_listing_count"] += count
        fields[mediator_id]["active_listing_count"] += count

    # Response info "if available" — how reliably/quickly this mediator
    # responds to platform-assigned leads (`LeadAssignment.assigned_at` /
    # `accepted_at` already exist; nothing new tracked). Computed in Python,
    # not a DB-side date-diff expression, to stay simple and portable —
    # demo-scale assignment volume makes this fine.
    assignment_rows = db.execute(
        select(LeadAssignment.mediator_id, LeadAssignment.status, LeadAssignment.assigned_at, LeadAssignment.accepted_at)
        .where(LeadAssignment.mediator_id.in_(mediator_ids))
    ).all()
    totals: dict[int, int] = defaultdict(int)
    accepted: dict[int, int] = defaultdict(int)
    response_hours: dict[int, list[float]] = defaultdict(list)
    for mediator_id, a_status, assigned_at, accepted_at in assignment_rows:
        totals[mediator_id] += 1
        if a_status == "accepted":
            accepted[mediator_id] += 1
        if accepted_at is not None and assigned_at is not None:
            response_hours[mediator_id].append((accepted_at - assigned_at).total_seconds() / 3600)
    for mediator_id, total in totals.items():
        if total > 0:
            fields[mediator_id]["response_rate"] = round(accepted.get(mediator_id, 0) / total, 2)
        hours = response_hours.get(mediator_id)
        if hours:
            fields[mediator_id]["avg_response_time_hours"] = round(sum(hours) / len(hours), 1)

    return fields


def _mediator_public_out(mediator: Mediator, trust_fields: dict[int, dict]) -> MediatorPublicOut:
    base = MediatorPublicOut.model_validate(mediator, from_attributes=True)
    computed = trust_fields.get(mediator.id, {})
    return base.model_copy(
        update={
            # The one allowed verification phrase, or None — never a
            # different/stronger verification claim (no
            # "Government Verified" / "REGA Verified" / "Ejar Verified" /
            # "Nafath Verified").
            "verification_label": MEDIATOR_VERIFIED_LABEL if mediator.is_verified else None,
            "member_since": mediator.created_at,
            "avg_rating": computed.get("avg_rating"),
            "review_count": computed.get("review_count", 0),
            "active_listing_count": computed.get("active_listing_count", 0),
            "rental_listing_count": computed.get("rental_listing_count", 0),
            "sale_listing_count": computed.get("sale_listing_count", 0),
            "response_rate": computed.get("response_rate"),
            "avg_response_time_hours": computed.get("avg_response_time_hours"),
        }
    )


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
    mediators = q.order_by(Mediator.is_verified.desc(), Mediator.total_leads_accepted.desc()).all()
    trust_fields = _bulk_mediator_trust_activity_fields(db, [m.id for m in mediators])
    return [_mediator_public_out(m, trust_fields) for m in mediators]


@router.get("/{mediator_id}/public", response_model=MediatorPublicOut)
def get_public_mediator(mediator_id: int, db: Session = Depends(get_db)):
    """Return a single partner's public profile (including Trust & Activity
    fields — Prompt 4). No auth required. Cached for
    `_PUBLIC_PROFILE_TTL_SECONDS`, same as before this prompt — rating/
    listing-count/response-info staleness within that window is an accepted
    trade-off already implicit in this endpoint's existing caching policy."""
    cache = CacheService()

    def _load():
        mediator = db.get(Mediator, mediator_id)
        if not mediator or mediator.subscription_status != "active":
            return None
        trust_fields = _bulk_mediator_trust_activity_fields(db, [mediator.id])
        return _mediator_public_out(mediator, trust_fields).model_dump(mode="json")

    cached = cache.get_or_set(_PUBLIC_PROFILE_NAMESPACE, str(mediator_id), _PUBLIC_PROFILE_TTL_SECONDS, _load)
    if cached is None:
        raise HTTPException(status_code=404, detail="Partner not found.")
    return cached


@router.get("/{mediator_id}/review-summary", response_model=ReviewSummaryOut)
def get_mediator_review_summary(
    mediator_id: int,
    language: str = "en",
    db: Session = Depends(get_db),
):
    """AI-summarized positive themes/considerations from this mediator's
    APPROVED reviews (Prompt 4, spec section 12). No auth required — same
    public visibility as `/public` and the existing `reviews.py` public
    endpoints. Deliberately a SEPARATE endpoint from `/public` (not embedded
    in it): the AI call is slower than a deterministic lookup, so `/public`'s
    Trust & Activity fields stay instant while this loads async — mirrors
    the existing `/intelligence` vs `/ai-summary` split for Property
    Intelligence. Below the minimum review count (or with no written review
    text yet), returns the deterministic {avg_rating, review_count} fallback
    — never blocks on or requires the AI call to succeed."""
    mediator = db.get(Mediator, mediator_id)
    if not mediator or mediator.subscription_status != "active":
        raise HTTPException(status_code=404, detail="Partner not found.")

    summary = get_mediator_summary(mediator_id, db)
    approved_reviews = db.scalars(
        select(Review)
        .where(Review.mediator_id == mediator_id, Review.status == "approved")
        .order_by(Review.created_at.desc())
        .limit(review_summary_service.MAX_REVIEWS_FOR_AI_SUMMARY)
    ).all()

    result = review_summary_service.summarize_reviews(
        approved_reviews,
        avg_rating=summary.avg_rating,
        review_count=summary.review_count,
        language=language,
    )
    return ReviewSummaryOut(
        mediator_id=mediator_id,
        avg_rating=result.avg_rating,
        review_count=result.review_count,
        positive_themes=result.positive_themes,
        considerations=result.considerations,
        generated_by=result.generated_by,
        note=result.note,
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
    _invalidate_public_profile_cache(mediator.id)
    return mediator


@router.post("/{mediator_id}/approve", response_model=MediatorOut)
def admin_approve_mediator(
    mediator_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Approve a partner: grants portal access and marks them verified for leads."""
    mediator = db.get(Mediator, mediator_id)
    if not mediator:
        raise HTTPException(status_code=404, detail="Mediator not found.")
    was_verified = mediator.is_verified
    mediator.approval_status = "approved"
    mediator.is_verified = True
    if not was_verified:
        record_event(
            db,
            event_type=EventType.MEDIATOR_VERIFIED,
            aggregate_type="mediator",
            aggregate_id=mediator.id,
            payload={"mediator_id": mediator.id},
        )
    db.commit()
    _invalidate_public_profile_cache(mediator.id)
    db.refresh(mediator)
    return mediator


@router.post("/{mediator_id}/reject", response_model=MediatorOut)
def admin_reject_mediator(
    mediator_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(get_admin_user),
):
    """Reject a partner: blocks portal access and removes lead eligibility."""
    mediator = db.get(Mediator, mediator_id)
    if not mediator:
        raise HTTPException(status_code=404, detail="Mediator not found.")
    mediator.approval_status = "rejected"
    mediator.is_verified = False
    db.commit()
    db.refresh(mediator)
    _invalidate_public_profile_cache(mediator.id)
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
        profile_image_url=body.profile_image_url,
        is_verified=body.is_verified,
        approval_status=body.approval_status,
        subscription_status=body.subscription_status,
        subscription_started_at=now if body.subscription_status == "active" else None,
        subscription_expires_at=now + timedelta(days=365) if body.subscription_status == "active" else None,
    )
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    return mediator
