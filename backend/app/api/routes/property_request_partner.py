"""Mediator response marketplace (Phase 9). Every payload returned here is
privacy-safe by construction — `PartnerRequestSummaryOut` never carries the
customer's name/phone/email/free-text notes, and the customer's identity is
never resolvable from anything a mediator can fetch through this router
(Phase 16: "Customer identity hidden from mediators before engagement")."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.api.deps import get_db, get_mediator_user
from app.core.audit import record_audit
from app.core.config import settings
from app.core.feature_flags import is_enabled
from app.core.idempotency import IdempotencyConflict, IdempotencyStore
from app.core.outbox import EventType, record_event
from app.core.rate_limit import rate_limit_dependency
from app.models.analytics_event import AnalyticsEvent
from app.models.mediator import Mediator, MediatorArea
from app.models.property import Property
from app.models.property_request import PropertyRequest, PropertyRequestActivity
from app.models.property_request_mediator_response import (
    PropertyRequestMediatorResponse,
    PropertyRequestMediatorResponseProperty,
)
from app.models.user import User
from app.schemas.property_request import (
    MediatorResponseCreate,
    MediatorResponseOut,
    PartnerRequestSummaryOut,
    PropertyRequestMatchOut,
)
from app.services.property_request_matcher import evaluate
from app.core.property_request.scoring import get_active_weights

router = APIRouter()


def _feature_gate() -> None:
    if not is_enabled("mediator_request_marketplace"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The Property Request marketplace is not currently available")


def _track(db: Session, *, event_name: str, user_id: int | None, properties: dict | None = None) -> None:
    from app.core.request_context import get_request_id

    db.add(AnalyticsEvent(event_name=event_name, user_id=user_id, properties=properties or {}, trace_id=get_request_id()))


def _mediator_covered_cities(db: Session, mediator_id: int) -> set[str]:
    rows = db.scalars(select(MediatorArea.city).where(MediatorArea.mediator_id == mediator_id).distinct()).all()
    return {c.lower() for c in rows if c}


def _mediator_covered_areas(db: Session, mediator_id: int) -> set[str]:
    rows = db.scalars(select(MediatorArea.area_name).where(MediatorArea.mediator_id == mediator_id)).all()
    return {a.lower() for a in rows if a}


def _is_eligible(pr: PropertyRequest, covered_cities: set[str]) -> bool:
    return (
        pr.status == "active"
        and pr.mediator_responses_enabled
        and pr.mediator_preference in ("mediator_only", "either")
        and bool(pr.city)
        and pr.city.lower() in covered_cities
    )


def _get_eligible_or_404(db: Session, request_id: int, mediator: Mediator) -> PropertyRequest:
    pr = db.get(PropertyRequest, request_id)
    covered = _mediator_covered_cities(db, mediator.id)
    # 404 (not 403) for anything the mediator isn't eligible to see — never
    # confirm the existence of a request outside their coverage/eligibility.
    if not pr or not _is_eligible(pr, covered):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property request not found")
    return pr


def _to_summary(db: Session, pr: PropertyRequest, mediator: Mediator) -> PartnerRequestSummaryOut:
    inventory_count = db.scalar(
        select(func.count()).select_from(Property).where(Property.mediator_id == mediator.id, Property.status == "Published", Property.city.ilike(pr.city or ""))
    ) or 0
    already = db.scalar(
        select(func.count()).select_from(PropertyRequestMediatorResponse).where(PropertyRequestMediatorResponse.request_id == pr.id, PropertyRequestMediatorResponse.mediator_id == mediator.id)
    ) or 0
    out = PartnerRequestSummaryOut.model_validate(pr, from_attributes=True)
    out.inventory_match_count = inventory_count
    out.already_responded = already > 0
    return out


@router.get("/", response_model=list[PartnerRequestSummaryOut])
def list_eligible_requests(
    city: str | None = Query(default=None),
    district: str | None = Query(default=None),
    transaction_type: str | None = Query(default=None),
    max_budget: float | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    auth: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
):
    _feature_gate()
    _user, mediator = auth
    covered_cities = _mediator_covered_cities(db, mediator.id)
    if not covered_cities:
        return []

    stmt = select(PropertyRequest).where(
        PropertyRequest.status == "active",
        PropertyRequest.mediator_responses_enabled.is_(True),
        PropertyRequest.mediator_preference.in_(["mediator_only", "either"]),
        func.lower(PropertyRequest.city).in_(covered_cities),
    )
    if city:
        stmt = stmt.where(PropertyRequest.city.ilike(city))
    if transaction_type:
        stmt = stmt.where(PropertyRequest.transaction_type == transaction_type)
    if max_budget is not None:
        stmt = stmt.where(func.coalesce(PropertyRequest.min_price, 0) <= max_budget)
    rows = db.scalars(stmt.order_by(PropertyRequest.created_at.desc()).offset(skip).limit(limit)).all()
    if district:
        covered_areas = {district.lower()}
        rows = [r for r in rows if not r.preferred_districts or covered_areas & {d.lower() for d in r.preferred_districts}]
    return [_to_summary(db, r, mediator) for r in rows]


@router.get("/{request_id}", response_model=PartnerRequestSummaryOut)
def get_eligible_request(request_id: int, auth: tuple[User, Mediator] = Depends(get_mediator_user), db: Session = Depends(get_db)):
    _feature_gate()
    user, mediator = auth
    pr = _get_eligible_or_404(db, request_id, mediator)
    _track(db, event_name="mediator_request_viewed", user_id=user.id, properties={"request_id": pr.id, "mediator_id": mediator.id})
    db.commit()
    return _to_summary(db, pr, mediator)


@router.get("/{request_id}/eligible-properties", response_model=list[PropertyRequestMatchOut])
def eligible_properties(request_id: int, auth: tuple[User, Mediator] = Depends(get_mediator_user), db: Session = Depends(get_db)):
    _feature_gate()
    _user, mediator = auth
    pr = _get_eligible_or_404(db, request_id, mediator)
    props = db.scalars(select(Property).where(Property.mediator_id == mediator.id, Property.status == "Published")).all()
    match_version, weights = get_active_weights(db)
    results = sorted(
        (evaluate(db, pr, p, weights=weights, match_version=match_version) for p in props),
        key=lambda r: r.match_score,
        reverse=True,
    )
    results = [r for r in results if r.hard_pass]
    now = datetime.now(timezone.utc)
    return [
        PropertyRequestMatchOut(
            id=None, property_id=r.property.id, match_score=r.match_score, flexible_coverage=r.flexible_coverage,
            preference_score=r.preference_score, price_fit_score=r.price_fit_score, area_fit_score=r.area_fit_score,
            commute_fit_score=r.commute_fit_score, listing_quality_score=r.listing_quality_score, confidence=r.confidence,
            match_reasons=r.match_reasons, trade_offs=r.trade_offs, match_version=r.match_version, status="new",
            created_at=now, updated_at=now,
        )
        for r in results
    ]


@router.post("/{request_id}/respond", response_model=MediatorResponseOut, status_code=status.HTTP_201_CREATED)
def respond_to_request(
    request_id: int,
    payload: MediatorResponseCreate,
    auth: tuple[User, Mediator] = Depends(get_mediator_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _rl=Depends(rate_limit_dependency("property_request_mediator_respond", limit=30, window_seconds=3600, by_user=True)),
):
    _feature_gate()
    user, mediator = auth
    pr = _get_eligible_or_404(db, request_id, mediator)

    idempotency = IdempotencyStore()
    fingerprint = {"request_id": request_id, **payload.model_dump()}
    if idempotency_key:
        try:
            existing = idempotency.begin("property-request-mediator-respond", idempotency_key, fingerprint)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        if existing is not None:
            return existing.body

    existing_count = db.scalar(
        select(func.count()).select_from(PropertyRequestMediatorResponse).where(PropertyRequestMediatorResponse.request_id == pr.id, PropertyRequestMediatorResponse.mediator_id == mediator.id)
    ) or 0
    if existing_count >= settings.PROPERTY_REQUEST_MEDIATOR_MAX_SUBMISSIONS_PER_REQUEST:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You've reached the submission limit for this request")

    response = PropertyRequestMediatorResponse(request_id=pr.id, mediator_id=mediator.id, response_type=payload.response_type, message=payload.message, status="pending")
    db.add(response)
    db.flush()

    submitted_ids: list[int] = []
    if payload.response_type in ("submit_property", "submit_multiple"):
        if not payload.property_ids:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="property_ids is required for this response type")
        for property_id in payload.property_ids:
            prop = db.get(Property, property_id)
            if not prop or prop.mediator_id != mediator.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"You are not authorized to represent property {property_id}")
            if prop.status != "Published":
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Property {property_id} is not currently active")
            try:
                with db.begin_nested():
                    db.add(PropertyRequestMediatorResponseProperty(response_id=response.id, request_id=pr.id, property_id=property_id))
                    db.flush()
            except IntegrityError as exc:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Property {property_id} was already submitted for this request") from exc
            submitted_ids.append(property_id)

    record_event(
        db, event_type=EventType.PROPERTY_REQUEST_MEDIATOR_RESPONSE_SUBMITTED, aggregate_type="property_request", aggregate_id=pr.id,
        payload={"request_id": pr.id, "mediator_id": mediator.id, "response_type": payload.response_type},
    )
    record_audit(db, user_id=user.id, action="property_request.mediator_response_submitted", entity_type="property_request", entity_id=pr.id, metadata={"mediator_id": mediator.id, "response_type": payload.response_type})
    db.add(PropertyRequestActivity(request_id=pr.id, actor_type="mediator", actor_id=mediator.id, activity_type="mediator_responded", payload={"response_type": payload.response_type}))
    _track(db, event_name="mediator_request_response_submitted", user_id=user.id, properties={"request_id": pr.id, "mediator_id": mediator.id, "response_type": payload.response_type})

    if is_enabled("property_request_notifications"):
        from app.services.property_request_notifications import create_and_deliver

        create_and_deliver(db, request=pr, change_type="mediator_response", context={"dedupe_suffix": response.id})

    db.commit()
    db.refresh(response)
    out = MediatorResponseOut.model_validate(response, from_attributes=True)
    out.property_ids = submitted_ids
    if idempotency_key:
        idempotency.complete("property-request-mediator-respond", idempotency_key, fingerprint, status_code=201, body=out.model_dump(mode="json"))
    return out


@router.post("/{request_id}/ignore", status_code=status.HTTP_204_NO_CONTENT)
def ignore_request(request_id: int, auth: tuple[User, Mediator] = Depends(get_mediator_user), db: Session = Depends(get_db)):
    _feature_gate()
    user, mediator = auth
    pr = _get_eligible_or_404(db, request_id, mediator)
    _track(db, event_name="mediator_request_response_rejected", user_id=user.id, properties={"request_id": pr.id, "mediator_id": mediator.id})
    db.commit()


@router.post("/{request_id}/save", status_code=status.HTTP_204_NO_CONTENT)
def save_request(request_id: int, auth: tuple[User, Mediator] = Depends(get_mediator_user), db: Session = Depends(get_db)):
    _feature_gate()
    user, mediator = auth
    pr = _get_eligible_or_404(db, request_id, mediator)
    _track(db, event_name="mediator_request_response_started", user_id=user.id, properties={"request_id": pr.id, "mediator_id": mediator.id, "action": "save"})
    db.commit()
