from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session, selectinload

from pydantic import BaseModel

from app.api.deps import get_admin_user, get_current_user, get_db, get_mediator_user, get_optional_admin_user, get_optional_current_user
from app.api.routes.reviews import get_mediator_summary
from app.core.audit import record_audit
from app.core.config import settings
from app.api.property_access import can_view_property, get_visible_property, is_owner_or_admin
from app.services import listing_media
from app.services.listing_media import resolve_image_url
from app.core.feature_flags import is_enabled
from app.core.geo import coords_for
from app.core.metrics import properties_published_total
from app.core.outbox import EventType, record_event
from app.core.rate_limit import rate_limit_dependency
from app.models.area_intelligence import AreaIntelligence
from app.models.booking import Booking
from app.models.listing_image import ListingImage
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_negotiation import PropertyNegotiation
from app.models.property_transaction import PropertyTransaction
from app.models.property_viewing import PROPERTY_VIEWING_INACTIVE_STATUSES, PropertyViewing
from app.models.property_report import PROPERTY_REPORT_ACTIVE_STATUSES, PropertyReport
from app.models.review import Review
from app.models.user import User
from app.schemas.duplicate import DuplicateAwarenessOut
from app.schemas.home_finder import HomeFinderCriteria
from app.schemas.property import ListingImageOut, PartnerPropertyCreate, PartnerPropertyUpdate, PropertyCreate, PropertyOut, PropertyUpdate
from app.schemas.property_intelligence import (
    AreaIntelligenceRefOut,
    ComparablePropertySummaryOut,
    ComparableSummaryOut,
    DataConfidenceOut,
    DimensionScoreOut,
    NegotiationInsightOut,
    PersonalizedFitOut,
    PersonalizedFitRowOut,
    PriceIntelligenceOut,
    PropertyIntelligenceOut,
)
from app.schemas.property_report import PropertyReportCreate, PropertyReportOut
from app.schemas.trust import TrustAssessmentOut
from app.schemas.trust_summary import TrustSummaryOut
from app.services import (
    comparable_properties,
    data_confidence as data_confidence_service,
    duplicate_detection as duplicate_detection_service,
    negotiation_intelligence as negotiation_intelligence_service,
    personalized_fit as personalized_fit_service,
    price_intelligence,
    property_decision_score,
    property_highlights as property_highlights_service,
    property_intelligence_ai,
    review_summary as review_summary_service,
    smart_questions as smart_questions_service,
    trust_ai_summary as trust_ai_summary_service,
    trust_assessment as trust_assessment_service,
)

router = APIRouter()

# Partner listing lifecycle (see PARTNER_EDITABLE_STATUSES / unpublish /
# resubmit / archive below). "Suspended" and "Hidden" are admin actions and
# stay locked for partners.
UNPUBLISHED_STATUS = "Unpublished"
ARCHIVED_STATUS = "Archived"
PARTNER_EDITABLE_STATUSES = ("Published", "Pending Approval", "Rejected", UNPUBLISHED_STATUS)


def _require_property_intelligence_enabled() -> None:
    # Same per-request flag check as home_finder.py's `_require_enabled` —
    # main.py's router registration only re-evaluates flags on process
    # restart, so this is what lets the flag be toggled (and tested) at
    # runtime without a redeploy.
    if not is_enabled("property_intelligence"):
        raise HTTPException(status_code=503, detail="Property Intelligence is not currently available")


@router.get("/", response_model=list[PropertyOut])
def list_properties(
    response: Response,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=1000),
    area: str | None = Query(default=None),
    city: str | None = Query(default=None),
    mediator_id: int | None = Query(default=None),
    listing_type: str | None = Query(default=None),
    property_type: str | None = Query(default=None),
    furnished: str | None = Query(default=None),
    min_bedrooms: int | None = Query(default=None, ge=0),
    min_bathrooms: int | None = Query(default=None, ge=0),
    min_monthly_rent: float | None = Query(default=None, ge=0),
    max_monthly_rent: float | None = Query(default=None, ge=0),
    min_sale_price: float | None = Query(default=None, ge=0),
    max_sale_price: float | None = Query(default=None, ge=0),
    min_lat: float | None = Query(default=None),
    max_lat: float | None = Query(default=None),
    min_lng: float | None = Query(default=None),
    max_lng: float | None = Query(default=None),
    is_bookable: bool | None = Query(default=None),
    check_in: date | None = Query(default=None),
    check_out: date | None = Query(default=None),
    include_all: bool = Query(default=False),
    admin: User | None = Depends(get_optional_admin_user),
    db: Session = Depends(get_db),
):
    # Build filters first, then paginate — WHERE must be resolved before LIMIT
    filters = []
    if not include_all or admin is None:
        filters.append(Property.status == "Published")
    if area:
        filters.append(Property.area.ilike(f"%{area}%"))
    if city:
        filters.append(Property.city.ilike(f"%{city}%"))
    if mediator_id is not None:
        filters.append(Property.mediator_id == mediator_id)
    if listing_type:
        filters.append(Property.listing_type == listing_type)
    if property_type:
        filters.append(Property.property_type == property_type)
    if furnished:
        filters.append(Property.furnished == furnished)
    if min_bedrooms is not None:
        filters.append(Property.bedrooms >= min_bedrooms)
    if min_bathrooms is not None:
        filters.append(Property.bathrooms >= min_bathrooms)
    if min_monthly_rent is not None:
        filters.append(Property.monthly_rent >= min_monthly_rent)
    if max_monthly_rent is not None:
        filters.append(Property.monthly_rent <= max_monthly_rent)
    if min_sale_price is not None:
        filters.append(Property.sale_price >= min_sale_price)
    if max_sale_price is not None:
        filters.append(Property.sale_price <= max_sale_price)
    if min_lat is not None and max_lat is not None and min_lng is not None and max_lng is not None:
        filters.append(Property.latitude.between(min_lat, max_lat))
        filters.append(Property.longitude.between(min_lng, max_lng))
    if is_bookable is not None:
        filters.append(Property.is_bookable == is_bookable)
    if check_in is not None and check_out is not None:
        # Half-open range overlap ([) — mirrors bookings.py's _overlap_filter
        # so a date-filtered browse list agrees with the actual availability
        # check a renter would run on the property's own detail page.
        conflicting_booking = (
            select(Booking.id)
            .where(
                and_(
                    Booking.property_id == Property.id,
                    Booking.status != "cancelled",
                    Booking.check_in < check_out,
                    Booking.check_out > check_in,
                )
            )
            .exists()
        )
        filters.append(~conflicting_booking)

    total = db.scalar(select(func.count()).select_from(Property).where(*filters)) or 0
    response.headers["X-Total-Count"] = str(total)

    stmt = select(Property).where(*filters).order_by(Property.id.desc()).offset(skip).limit(limit)
    return db.scalars(stmt).all()


@router.get("/stats")
def property_stats(db: Session = Depends(get_db)):
    count = db.execute(
        select(func.count()).select_from(Property).where(Property.status == "Published")
    ).scalar_one()
    return {"listing_count": int(count)}


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
def bulk_import_properties(
    payload: list[PropertyCreate],
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    inserted = 0
    skipped = 0
    for p in payload:
        if p.external_id:
            exists = db.scalars(
                select(Property).where(Property.external_id == p.external_id)
            ).first()
            if exists:
                skipped += 1
                continue
        prop = Property(**p.model_dump())
        db.add(prop)
        db.flush()
        if prop.latitude is None or prop.longitude is None:
            prop.latitude, prop.longitude = coords_for(prop.area, prop.city, prop.id)
        inserted += 1
    db.commit()
    return {"inserted": inserted, "skipped": skipped, "total": len(payload)}


@router.get("/partner/mine", response_model=list[PropertyOut])
def list_partner_properties(
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    return db.scalars(
        select(Property)
        .where(Property.mediator_id == mediator.id, Property.status != ARCHIVED_STATUS)
        .order_by(Property.id.desc())
    ).all()


@router.post("/partner/", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_partner_property(
    payload: PartnerPropertyCreate,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    data = payload.model_dump()
    if not data.get("license_number"):
        data["license_number"] = mediator.license_number
    prop = Property(
        **data,
        status="Pending Approval",
        mediator_id=mediator.id,
    )
    db.add(prop)
    db.flush()
    prop.latitude, prop.longitude = coords_for(prop.area, prop.city, prop.id)
    record_event(
        db,
        event_type=EventType.PROPERTY_CREATED,
        aggregate_type="property",
        aggregate_id=prop.id,
        payload={"property_id": prop.id, "mediator_id": mediator.id, "status": prop.status},
    )
    db.commit()
    db.refresh(prop)
    return prop


@router.patch("/partner/{property_id}", response_model=PropertyOut)
def update_partner_property(
    property_id: int,
    payload: PartnerPropertyUpdate,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    prop = _get_owned_listing(db, property_id, mediator)
    if prop.status not in PARTNER_EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A listing that is '{prop.status}' can't be edited. Contact Maskan support.",
        )

    was_published = prop.status == "Published"
    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(prop, field, value)
    # Moderation workflow: any edit to a Published, Pending or Rejected listing
    # (re)enters admin review. A partner-unpublished listing stays unpublished
    # until the partner explicitly resubmits it.
    if prop.status != UNPUBLISHED_STATUS:
        prop.status = "Pending Approval"

    record_event(
        db,
        event_type=EventType.PROPERTY_UPDATED,
        aggregate_type="property",
        aggregate_id=prop.id,
        payload={"property_id": prop.id, "status": prop.status, "changed_fields": list(changed_fields.keys())},
    )
    if was_published:
        record_event(
            db,
            event_type=EventType.PROPERTY_UNPUBLISHED,
            aggregate_type="property",
            aggregate_id=prop.id,
            payload={"property_id": prop.id},
        )

    db.commit()
    db.refresh(prop)
    return prop


def _get_owned_listing(db: Session, property_id: int, mediator: Mediator) -> Property:
    prop = db.get(Property, property_id)
    if not prop or prop.status == ARCHIVED_STATUS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if prop.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    return prop


def _active_deal_counts(db: Session, property_id: int) -> tuple[int, int, int]:
    negotiations = db.scalar(
        select(func.count(PropertyNegotiation.id)).where(
            PropertyNegotiation.property_id == property_id,
            PropertyNegotiation.status.in_(("submitted", "countered")),
        )
    ) or 0
    transactions = db.scalar(
        select(func.count(PropertyTransaction.id)).where(
            PropertyTransaction.property_id == property_id,
            PropertyTransaction.status.notin_(("completed", "cancelled")),
        )
    ) or 0
    viewings = db.scalar(
        select(func.count(PropertyViewing.id)).where(
            PropertyViewing.property_id == property_id,
            PropertyViewing.status.notin_(PROPERTY_VIEWING_INACTIVE_STATUSES),
        )
    ) or 0
    return int(negotiations), int(transactions), int(viewings)


@router.post("/partner/{property_id}/unpublish", response_model=PropertyOut)
def unpublish_partner_property(
    property_id: int,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    """Partner takes their own listing off the portal (Published or Pending →
    Unpublished). Existing viewings/offers/transactions are untouched and the
    customers involved keep access to the listing page."""
    user, mediator = mediator_user
    prop = _get_owned_listing(db, property_id, mediator)
    if prop.status not in ("Published", "Pending Approval"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"A listing that is '{prop.status}' can't be unpublished.")
    was_published = prop.status == "Published"
    previous = prop.status
    prop.status = UNPUBLISHED_STATUS
    if was_published:
        record_event(db, event_type=EventType.PROPERTY_UNPUBLISHED, aggregate_type="property", aggregate_id=prop.id, payload={"property_id": prop.id})
    record_audit(db, user_id=user.id, action="partner.listing.unpublished", entity_type="property", entity_id=prop.id, metadata={"from": previous})
    db.commit()
    db.refresh(prop)
    return prop


@router.post("/partner/{property_id}/resubmit", response_model=PropertyOut)
def resubmit_partner_property(
    property_id: int,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    """Send an Unpublished or Rejected listing back for admin approval."""
    user, mediator = mediator_user
    prop = _get_owned_listing(db, property_id, mediator)
    if prop.status not in (UNPUBLISHED_STATUS, "Rejected"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"A listing that is '{prop.status}' can't be resubmitted.")
    previous = prop.status
    prop.status = "Pending Approval"
    record_event(db, event_type=EventType.PROPERTY_UPDATED, aggregate_type="property", aggregate_id=prop.id, payload={"property_id": prop.id, "status": prop.status, "changed_fields": ["status"]})
    record_audit(db, user_id=user.id, action="partner.listing.resubmitted", entity_type="property", entity_id=prop.id, metadata={"from": previous})
    db.commit()
    db.refresh(prop)
    return prop


@router.delete("/partner/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_partner_property(
    property_id: int,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    """Partner "delete" = archive (soft delete). The row, its images, and all
    viewing/offer/transaction/audit history are preserved; it disappears from
    the partner's portfolio and the portal. Refused while a deal is in
    progress so no customer is left mid-process."""
    user, mediator = mediator_user
    prop = _get_owned_listing(db, property_id, mediator)
    negotiations, transactions, viewings = _active_deal_counts(db, prop.id)
    if negotiations or transactions or viewings:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This listing has activity in progress "
                f"({viewings} viewing(s), {negotiations} offer(s), {transactions} transaction(s)). "
                "Unpublish it instead, or finish or cancel that activity first."
            ),
        )
    previous = prop.status
    was_published = previous == "Published"
    prop.status = ARCHIVED_STATUS
    if was_published:
        record_event(db, event_type=EventType.PROPERTY_UNPUBLISHED, aggregate_type="property", aggregate_id=prop.id, payload={"property_id": prop.id})
    record_audit(db, user_id=user.id, action="partner.listing.archived", entity_type="property", entity_id=prop.id, metadata={"from": previous})
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{property_id}", response_model=PropertyOut)
def get_property(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    # Non-public listings (Pending Approval / Rejected / Draft / Suspended /
    # Hidden) are only readable by the owner, admins and engaged customers —
    # see app/api/property_access.py. Previously only "Hidden" was blocked, so
    # an unreviewed listing's contact phone, licence and photos were readable
    # by anyone who guessed its id.
    property_obj = get_visible_property(db, property_id, current_user)

    # Count customer views only — the owning partner editing/previewing and
    # admins moderating must not inflate the listing's view count.
    if not is_owner_or_admin(db, property_obj, current_user):
        property_obj.views_count = (property_obj.views_count or 0) + 1
        db.commit()
        db.refresh(property_obj)

    result = PropertyOut.model_validate(property_obj)
    if property_obj.mediator_id:
        summary = get_mediator_summary(property_obj.mediator_id, db)
        result.mediator_rating = summary.avg_rating
        result.mediator_review_count = summary.review_count
    return result


@router.get("/{property_id}/similar", response_model=list[PropertyOut])
def get_similar_properties(
    property_id: int,
    limit: int = Query(default=6, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    base = get_visible_property(db, property_id, current_user)

    base_price = base.monthly_rent if base.listing_type != "sale" else base.sale_price
    price_col = Property.sale_price if base.listing_type == "sale" else Property.monthly_rent

    stmt = (
        select(Property)
        .where(
            Property.id != base.id,
            Property.status == "Published",
            Property.city == base.city,
            Property.listing_type == base.listing_type,
        )
        .order_by(
            case((Property.area == base.area, 0), else_=1),
            func.abs(func.coalesce(price_col, 0) - (base_price or 0)),
        )
        .limit(limit)
    )
    return db.scalars(stmt).all()


def _price_for_intel(prop: Property) -> float | None:
    return prop.sale_price if prop.listing_type == "sale" else prop.monthly_rent


def _price_intelligence_out(prop: Property, intel) -> PriceIntelligenceOut:
    is_sale = prop.listing_type == "sale"
    return PriceIntelligenceOut(
        type="buy" if is_sale else "rent",
        sufficient_data=intel.sufficient_data,
        asking_price=getattr(intel, "asking_price", None) if is_sale else getattr(intel, "asking_rent", None),
        fair_range_low=getattr(intel, "fair_range_low", None),
        fair_range_high=getattr(intel, "fair_range_high", None),
        market_midpoint=getattr(intel, "market_midpoint", None),
        price_per_sqm=getattr(intel, "price_per_sqm", None),
        comparable_median_price_per_sqm=getattr(intel, "comparable_median_price_per_sqm", None),
        estimated_value_low=getattr(intel, "estimated_value_low", None),
        estimated_value_high=getattr(intel, "estimated_value_high", None),
        percent_difference=intel.percent_difference,
        classification=intel.classification,
        factors_used=intel.factors_used,
        comparable_count=intel.comparable_count,
        explanation=intel.explanation,
    )


def _load_property_for_intelligence(db: Session, property_id: int) -> Property | None:
    return db.scalars(
        select(Property).where(Property.id == property_id).options(selectinload(Property.listing_images))
    ).first()


def _assemble_property_intelligence(db: Session, prop: Property, criteria: HomeFinderCriteria | None = None) -> PropertyIntelligenceOut:
    area_intel = db.scalars(
        select(AreaIntelligence).where(
            AreaIntelligence.area_name.ilike(f"%{prop.area}%"), AreaIntelligence.city.ilike(f"%{prop.city}%")
        )
    ).first()

    price_intel = (
        price_intelligence.buy_price_intelligence(db, prop)
        if prop.listing_type == "sale"
        else price_intelligence.rent_price_intelligence(db, prop)
    )
    comparables = comparable_properties.find_comparable_properties(db, prop)
    conf = data_confidence_service.compute_data_confidence(prop, area_intel, len(comparables))
    decision = property_decision_score.score_property_decision(
        prop,
        area_intel=area_intel,
        comparable_count=len(comparables),
        price_classification=price_intel.classification if price_intel.sufficient_data else None,
    )
    highlights = property_highlights_service.property_highlights(
        prop, price_intelligence=price_intel, comparables=comparables, area_intel=area_intel
    )
    questions = smart_questions_service.generate_smart_questions(prop)
    negotiation = negotiation_intelligence_service.negotiation_insight(prop, price_intel)
    fit = personalized_fit_service.personalized_fit(prop, criteria)

    comparable_items = [
        ComparablePropertySummaryOut(
            property_id=c.property.id,
            title=c.property.title,
            image_url=(
                resolve_image_url(c.property.listing_images[0].url, c.property.status)
                if c.property.listing_images
                else c.property.image_url
            ),
            price=_price_for_intel(c.property),
            price_difference=c.price_difference,
            price_per_sqm=c.price_per_sqm,
            match_similarity_percent=c.match_similarity_percent,
            value_label=c.value_label,
        )
        for c in comparables
    ]

    return PropertyIntelligenceOut(
        decision_score=decision.overall,
        component_scores={
            k: DimensionScoreOut(score=v.score, reason=v.reason) for k, v in decision.dimensions.items()
        },
        omitted_score_dimensions=decision.omitted_dimensions,
        data_confidence=DataConfidenceOut(level=conf.level, reason=conf.reason),
        price_intelligence=_price_intelligence_out(prop, price_intel),
        comparable_summary=ComparableSummaryOut(count=len(comparables), items=comparable_items),
        strengths=highlights.strengths,
        considerations=highlights.considerations,
        things_to_verify=highlights.things_to_verify,
        personalized_fit=(
            PersonalizedFitOut(
                rows=[PersonalizedFitRowOut(label=r.label, status=r.status, detail=r.detail) for r in fit.rows],
                priorities_matched=fit.priorities_matched,
                priorities_total=fit.priorities_total,
                summary=fit.summary,
            )
            if fit is not None
            else None
        ),
        smart_questions=questions,
        negotiation_intelligence=(
            NegotiationInsightOut(
                asking_price=negotiation.asking_price,
                market_midpoint=negotiation.market_midpoint,
                discussion_range_low=negotiation.discussion_range_low,
                discussion_range_high=negotiation.discussion_range_high,
                approach=negotiation.approach,
            )
            if negotiation is not None
            else None
        ),
        area_intelligence=(
            AreaIntelligenceRefOut(
                area_name=area_intel.area_name,
                city=area_intel.city,
                area_score=area_intel.area_score,
                summary=(area_intel.overview[:280] if area_intel.overview else None),
            )
            if area_intel is not None
            else None
        ),
    )


@router.get(
    "/{property_id}/intelligence",
    response_model=PropertyIntelligenceOut,
    dependencies=[Depends(_require_property_intelligence_enabled)],
)
def get_property_intelligence(
    property_id: int,
    max_price: float | None = Query(default=None, ge=0),
    min_price: float | None = Query(default=None, ge=0),
    bedrooms: int | None = Query(default=None, ge=0),
    districts: list[str] = Query(default=[]),
    required_amenities: list[str] = Query(default=[]),
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    # Personalization criteria decision — see tracking doc's "APIs" section:
    # only the handful of fields the brief needs (budget/bedrooms/districts/
    # amenities) are accepted as query params rather than the full
    # HomeFinderCriteria shape.
    prop = _load_property_for_intelligence(db, property_id)
    if not prop or not can_view_property(db, prop, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    criteria = None
    if any([max_price, min_price, bedrooms, districts, required_amenities]):
        criteria = HomeFinderCriteria(
            transaction_type=prop.listing_type,
            max_price=max_price,
            min_price=min_price,
            bedrooms=bedrooms,
            districts=districts,
            required_amenities=required_amenities,
        )
    return _assemble_property_intelligence(db, prop, criteria)


class PropertyAiSummaryRequest(BaseModel):
    language: Literal["en", "ar"] = "en"
    # Prompt 9's negotiation "Draft Message" action reuses this same endpoint
    # rather than a second AI endpoint — see property_intelligence_ai.py.
    variant: Literal["summary", "negotiation_message"] = "summary"
    # Prompt 6 (AI Negotiation & Offer Management): when present (and owned
    # by the requesting customer, checked below), grounds a
    # variant="negotiation_message" draft in this IN-PROGRESS negotiation's
    # actual numbers (current offer / the mediator's latest counter, if any)
    # instead of the generic pre-negotiation discussion range. Ignored for
    # variant="summary". See property_intelligence_ai.py's
    # `_grounded_negotiation_facts_block`.
    negotiation_id: int | None = None


class PropertyAiSummaryResponse(BaseModel):
    summary: str
    generated_by: Literal["ai", "fallback"]


@router.post(
    "/{property_id}/ai-summary",
    response_model=PropertyAiSummaryResponse,
    dependencies=[
        Depends(_require_property_intelligence_enabled),
        Depends(rate_limit_dependency("property_ai_summary", limit=30, window_seconds=600)),
    ],
)
def get_property_ai_summary(
    property_id: int,
    req: PropertyAiSummaryRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    prop = _load_property_for_intelligence(db, property_id)
    if not prop or not can_view_property(db, prop, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    # Prompt 6: an optional negotiation_id grounds the draft in a real,
    # in-progress negotiation. Never trusted at face value — the negotiation
    # must actually belong to the requesting (authenticated) customer AND
    # reference this same property, mirroring
    # property_negotiation.create_negotiation()'s viewing_id verification
    # style ("an id a client supplied on purpose that fails validation is
    # more likely a bug worth surfacing than a case to paper over").
    negotiation: PropertyNegotiation | None = None
    offer_history: list = []
    if req.variant == "negotiation_message" and req.negotiation_id is not None:
        if current_user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sign in to draft a message grounded in your negotiation",
            )
        negotiation = db.get(PropertyNegotiation, req.negotiation_id)
        if (
            not negotiation
            or negotiation.property_id != property_id
            or negotiation.customer_user_id != current_user.id
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Negotiation not found")
        offer_history = list(negotiation.offers)

    intelligence = _assemble_property_intelligence(db, prop)
    # The pre-negotiation 422 guard only applies when there's no negotiation
    # to ground the draft in instead — once a real negotiation is supplied,
    # its own snapshot amounts are enough even if Property Intelligence
    # itself lacks sufficient comparable data.
    if req.variant == "negotiation_message" and intelligence.negotiation_intelligence is None and negotiation is None:
        raise HTTPException(status_code=422, detail="No negotiation insight available for this listing")

    summary, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intelligence,
        language=req.language,
        variant=req.variant,
        user_id=current_user.id if current_user else None,
        negotiation=negotiation,
        offer_history=offer_history,
    )
    return PropertyAiSummaryResponse(summary=summary, generated_by=generated_by)


# ── Trust Center (Prompt 2) ──────────────────────────────────────────────────
# GET /trust is deliberately NOT gated behind the property_intelligence flag
# (unlike /intelligence and /ai-summary above): Trust Center's deterministic
# assessment must render on Property Detail regardless of whether the
# separate Property Intelligence feature is toggled on, per this feature's
# "Property Detail must render trust instantly" global constraint.


def _build_trust_assessment(db: Session, prop: Property) -> trust_assessment_service.TrustAssessment:
    """Shared by GET /trust and GET /trust-summary (Prompt 5) so both always
    compute the identical deterministic assessment through one code path —
    never two independently-drifting implementations of the same trust
    score. Same "load once, reuse everywhere" shape as
    _assemble_property_intelligence: one review-summary aggregate query, one
    mediator-listing-count aggregate query, one area-intelligence lookup,
    one comparable-properties query — no N+1 (never a per-candidate or
    per-field query). Marketplace Confidence and Mediator Trust reuse those
    results as-is rather than recomputing them."""
    review_summary = get_mediator_summary(prop.mediator_id, db) if prop.mediator_id else None
    mediator_listing_count = 0
    if prop.mediator_id:
        mediator_listing_count = db.scalar(
            select(func.count())
            .select_from(Property)
            .where(Property.mediator_id == prop.mediator_id, Property.status == "Published")
        ) or 0

    area_intel = db.scalars(
        select(AreaIntelligence).where(
            AreaIntelligence.area_name.ilike(f"%{prop.area}%"), AreaIntelligence.city.ilike(f"%{prop.city}%")
        )
    ).first()
    comparables = comparable_properties.find_comparable_properties(db, prop)
    conf = data_confidence_service.compute_data_confidence(prop, area_intel, len(comparables))

    return trust_assessment_service.assess_property_trust(
        prop,
        review_count=review_summary.review_count if review_summary else 0,
        avg_rating=review_summary.avg_rating if review_summary else None,
        mediator_listing_count=mediator_listing_count,
        data_confidence=conf,
    )


@router.get("/{property_id}/trust", response_model=TrustAssessmentOut)
def get_property_trust(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    prop = _load_property_for_intelligence(db, property_id)
    if not prop or not can_view_property(db, prop, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    assessment = _build_trust_assessment(db, prop)
    return TrustAssessmentOut.from_assessment(property_id, assessment)


# ── AI Trust Summary (Prompt 5) ───────────────────────────────────────────────
# Deliberately a SEPARATE endpoint from GET /trust above (not embedded in its
# response): the AI call is slower than the deterministic assessment, so
# Property Detail's trust badge/section renders instantly from /trust while
# this loads async underneath it — mirrors this feature's existing
# /public-vs-/review-summary split (Prompt 4) and the pre-existing
# /intelligence-vs-/ai-summary split. Never gated behind the
# property_intelligence flag either, for the same "Trust Center must work
# even if Property Intelligence is toggled off" reasoning /trust already
# documents above.


@router.get("/{property_id}/trust-summary", response_model=TrustSummaryOut)
def get_property_trust_summary(
    property_id: int,
    language: Literal["en", "ar"] = "en",
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Short AI-written explanation of the deterministic trust assessment
    above — grounded in exactly four inputs (see
    `trust_ai_summary.summarize_trust_assessment`'s docstring): the
    `TrustAssessment` itself, basic property identity facts, the mediator's
    deterministic trust facts, and Prompt 4's review summary. Falls back to
    a deterministic paragraph (never an error state) if the AI call fails
    for any reason."""
    prop = _load_property_for_intelligence(db, property_id)
    if not prop or not can_view_property(db, prop, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    assessment = _build_trust_assessment(db, prop)
    mediator_trust = assessment.component_scores.get("mediator_trust")

    review_summary_result = None
    if prop.mediator_id:
        summary = get_mediator_summary(prop.mediator_id, db)
        approved_reviews = db.scalars(
            select(Review)
            .where(Review.mediator_id == prop.mediator_id, Review.status == "approved")
            .order_by(Review.created_at.desc())
            .limit(review_summary_service.MAX_REVIEWS_FOR_AI_SUMMARY)
        ).all()
        review_summary_result = review_summary_service.summarize_reviews(
            approved_reviews,
            avg_rating=summary.avg_rating,
            review_count=summary.review_count,
            language=language,
            user_id=current_user.id if current_user else None,
        )

    result = trust_ai_summary_service.summarize_trust_assessment(
        assessment,
        prop,
        mediator_trust,
        review_summary_result,
        language=language,
        user_id=current_user.id if current_user else None,
    )
    return TrustSummaryOut(property_id=property_id, summary=result.summary, generated_by=result.generated_by)


@router.get("/{property_id}/duplicate-check", response_model=DuplicateAwarenessOut)
def get_property_duplicate_check(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    """Lightweight duplicate-awareness check (spec section 17) — possible-
    duplicate + confidence + reasons only. Never auto-merges/hides/deletes;
    Prompt 8's partner UI surfaces this as a "may already exist" warning
    with a compare/continue-anyway choice, never a hard block."""
    prop = _load_property_for_intelligence(db, property_id)
    if not prop or not can_view_property(db, prop, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    result = duplicate_detection_service.find_possible_duplicates(db, prop)
    return DuplicateAwarenessOut.from_result(result)


@router.post("/{property_id}/reports", response_model=PropertyReportOut, status_code=status.HTTP_201_CREATED)
def report_property(
    property_id: int,
    payload: PropertyReportCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """"Report a Concern" (spec section 24). One active (Open/Under Review)
    report per (user, property, reason) — resubmitting the same reason while
    an earlier report on it is still open is rejected as a 409 rather than
    creating a duplicate row; a *different* reason, or resubmitting after
    the earlier one was Resolved/Dismissed, is allowed."""
    prop = db.get(Property, property_id)
    if not prop or not can_view_property(db, prop, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    existing_active = db.scalars(
        select(PropertyReport).where(
            PropertyReport.property_id == property_id,
            PropertyReport.reporter_user_id == current_user.id,
            PropertyReport.reason == payload.reason,
            PropertyReport.status.in_(PROPERTY_REPORT_ACTIVE_STATUSES),
        )
    ).first()
    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have an open report for this reason on this listing.",
        )

    report = PropertyReport(
        property_id=property_id,
        reporter_user_id=current_user.id,
        reason=payload.reason,
        comment=payload.comment,
        status="Open",
    )
    db.add(report)
    db.flush()
    record_audit(
        db,
        user_id=current_user.id,
        action="property.reported",
        entity_type="property_report",
        entity_id=report.id,
        metadata={"property_id": property_id, "reason": payload.reason},
    )
    db.commit()
    db.refresh(report)
    return report


@router.post("/", response_model=PropertyOut, status_code=status.HTTP_201_CREATED)
def create_property(
    payload: PropertyCreate,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    property_obj = Property(**payload.model_dump())
    db.add(property_obj)
    db.flush()
    if property_obj.latitude is None or property_obj.longitude is None:
        property_obj.latitude, property_obj.longitude = coords_for(property_obj.area, property_obj.city, property_obj.id)
    record_event(
        db,
        event_type=EventType.PROPERTY_CREATED,
        aggregate_type="property",
        aggregate_id=property_obj.id,
        payload={"property_id": property_obj.id, "status": property_obj.status},
    )
    if property_obj.status == "Published":
        record_event(
            db,
            event_type=EventType.PROPERTY_PUBLISHED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id},
        )
        properties_published_total.inc()
    db.commit()
    db.refresh(property_obj)
    return property_obj


_MEANINGFUL_DETAIL_FIELDS = ("bedrooms", "bathrooms", "property_type", "furnished", "size_sq_m")


@router.patch("/{property_id}", response_model=PropertyOut)
def update_property(
    property_id: int,
    payload: PropertyUpdate,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    property_obj = db.get(Property, property_id)
    if not property_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    previous_status = property_obj.status
    previous_monthly_rent = property_obj.monthly_rent
    previous_sale_price = property_obj.sale_price
    previous_details = {f: getattr(property_obj, f) for f in _MEANINGFUL_DETAIL_FIELDS}
    was_ever_published = previous_status == "Published"

    changed_fields = payload.model_dump(exclude_unset=True)
    for field, value in changed_fields.items():
        setattr(property_obj, field, value)

    detail_changed = any(previous_details[f] != getattr(property_obj, f) for f in _MEANINGFUL_DETAIL_FIELDS)
    record_event(
        db,
        event_type=EventType.PROPERTY_UPDATED,
        aggregate_type="property",
        aggregate_id=property_obj.id,
        payload={
            "property_id": property_obj.id,
            "status": property_obj.status,
            "changed_fields": list(changed_fields.keys()),
            "previous_details": previous_details,
            "detail_changed": detail_changed,
        },
    )
    if previous_status != "Published" and property_obj.status == "Published":
        record_event(
            db,
            event_type=EventType.PROPERTY_PUBLISHED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id, "republished": was_ever_published},
        )
        properties_published_total.inc()
    elif previous_status == "Published" and property_obj.status != "Published":
        record_event(
            db,
            event_type=EventType.PROPERTY_UNPUBLISHED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id},
        )
        record_event(
            db,
            event_type=EventType.PROPERTY_AVAILABILITY_CHANGED,
            aggregate_type="property",
            aggregate_id=property_obj.id,
            payload={"property_id": property_obj.id, "available": False},
        )

    # Price-change detection: only meaningful (and only alert-worthy) once
    # the property is actually visible to searchers.
    if property_obj.status == "Published":
        old_price = previous_sale_price if property_obj.listing_type == "sale" else previous_monthly_rent
        new_price = property_obj.sale_price if property_obj.listing_type == "sale" else property_obj.monthly_rent
        if old_price is not None and new_price is not None and old_price != new_price:
            pct_change = abs(new_price - old_price) / old_price * 100 if old_price else 100
            abs_change = abs(new_price - old_price)
            if pct_change >= settings.PRICE_CHANGE_THRESHOLD_PERCENT and abs_change >= settings.PRICE_CHANGE_THRESHOLD_ABS_SAR:
                record_event(
                    db,
                    event_type=EventType.PROPERTY_PRICE_CHANGED,
                    aggregate_type="property",
                    aggregate_id=property_obj.id,
                    payload={
                        "property_id": property_obj.id,
                        "old_price": old_price,
                        "new_price": new_price,
                        "direction": "down" if new_price < old_price else "up",
                    },
                )

    db.commit()
    db.refresh(property_obj)
    return property_obj


class ImagePayload(BaseModel):
    url: str


@router.get("/{property_id}/images", response_model=list[ListingImageOut])
def list_property_images(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
):
    prop = db.get(Property, property_id)
    if not prop or not can_view_property(db, prop, current_user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    return prop.listing_images


@router.post("/{property_id}/images", response_model=ListingImageOut, status_code=status.HTTP_201_CREATED)
def add_property_image(
    property_id: int,
    payload: ImagePayload,
    db: Session = Depends(get_db),
    admin: User | None = Depends(get_optional_admin_user),
):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")
    if admin is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorised")
    next_order = len(prop.listing_images)
    img = ListingImage(property_id=property_id, url=payload.url.strip(), display_order=next_order)
    db.add(img)
    db.commit()
    db.refresh(img)
    return img


def _owned_editable_listing(db: Session, property_id: int, mediator: Mediator) -> Property:
    prop = _get_owned_listing(db, property_id, mediator)
    if prop.status not in PARTNER_EDITABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Photos can't be changed while a listing is '{prop.status}'.",
        )
    return prop


def _photo_change_needs_review(prop: Property) -> None:
    # A photo change is a listing edit: a Published listing re-enters review
    # exactly like a text edit (previously photos bypassed moderation).
    if prop.status == "Published":
        prop.status = "Pending Approval"


def _require_external_url(url: str) -> str:
    url = url.strip()
    if listing_media.MEDIA_PREFIX in url:
        # Copying a (signed) Maskan media URL from another listing is not an
        # external image — uploaded photos are attached only via /upload.
        raise HTTPException(status_code=422, detail="Upload this photo from your device instead of pasting its Maskan link.")
    if not (url.startswith("https://") or url.startswith("http://")):
        # Local media can only come from an upload — otherwise a partner could
        # attach another listing's private photo path to their own listing.
        raise HTTPException(status_code=422, detail="Image URL must start with http:// or https://")
    return url


@router.post("/partner/{property_id}/images", response_model=ListingImageOut, status_code=status.HTTP_201_CREATED)
def add_partner_property_image(
    property_id: int,
    payload: ImagePayload,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    prop = _owned_editable_listing(db, property_id, mediator)
    url = _require_external_url(payload.url)
    if len(prop.listing_images) >= listing_media.MAX_IMAGES_PER_LISTING:
        raise HTTPException(status_code=409, detail=f"A listing can have at most {listing_media.MAX_IMAGES_PER_LISTING} photos.")
    img = ListingImage(property_id=property_id, url=url, display_order=len(prop.listing_images))
    db.add(img)
    _photo_change_needs_review(prop)
    db.commit()
    db.refresh(img)
    return img


@router.post("/partner/{property_id}/images/upload", response_model=ListingImageOut, status_code=status.HTTP_201_CREATED)
async def upload_partner_property_image(
    property_id: int,
    file: UploadFile = File(...),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    """Upload a photo from the partner's device (JPEG/PNG/WebP, ≤ 8 MB)."""
    _, mediator = mediator_user
    prop = _owned_editable_listing(db, property_id, mediator)
    try:
        url = await listing_media.save_listing_image(prop.id, len(prop.listing_images), file)
    except listing_media.ListingMediaError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    img = ListingImage(property_id=property_id, url=url, display_order=len(prop.listing_images))
    db.add(img)
    _photo_change_needs_review(prop)
    db.commit()
    db.refresh(img)
    return img


@router.delete("/{property_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property_image(
    property_id: int,
    image_id: int,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    img = db.get(ListingImage, image_id)
    if not img or img.property_id != property_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    url = img.url
    db.delete(img)
    db.commit()
    listing_media.delete_listing_image_file(property_id, url)


@router.delete("/partner/{property_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_partner_property_image(
    property_id: int,
    image_id: int,
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _, mediator = mediator_user
    prop = _owned_editable_listing(db, property_id, mediator)
    img = db.get(ListingImage, image_id)
    if not img or img.property_id != property_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    url = img.url
    db.delete(img)
    _photo_change_needs_review(prop)
    db.commit()
    listing_media.delete_listing_image_file(property_id, url)


@router.delete("/{property_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_property(
    property_id: int,
    _admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    property_obj = db.get(Property, property_id)
    if not property_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property not found")

    db.delete(property_obj)
    db.commit()
