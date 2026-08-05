from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.core.audit import record_audit
from app.core.feature_flags import is_enabled
from app.core.outbox import EventType, record_event
from app.models.property_request import PROPERTY_REQUEST_STATUSES, PropertyRequest, PropertyRequestActivity
from app.models.property_request_match import PropertyRequestMatch
from app.models.property_request_mediator_response import PropertyRequestMediatorResponse
from app.models.user import User
from app.schemas.property_request import AdminAnalyticsOut, AdminPropertyRequestOut

router = APIRouter()


def _feature_gate() -> None:
    if not is_enabled("property_request_admin_dashboard"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Property Request admin operations are not currently available")


@router.get("/", response_model=list[AdminPropertyRequestOut])
def list_requests(
    response: Response,
    status_filter: str | None = Query(default=None, alias="status"),
    city: str | None = Query(default=None),
    user_id: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    _feature_gate()
    stmt = select(PropertyRequest)
    if status_filter:
        stmt = stmt.where(PropertyRequest.status == status_filter)
    if city:
        stmt = stmt.where(PropertyRequest.city.ilike(city))
    if user_id:
        stmt = stmt.where(PropertyRequest.user_id == user_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    response.headers["X-Total-Count"] = str(total)
    rows = db.scalars(stmt.order_by(PropertyRequest.created_at.desc()).offset(skip).limit(limit)).all()

    ids = [r.id for r in rows]
    match_counts = dict(db.execute(select(PropertyRequestMatch.request_id, func.count(PropertyRequestMatch.id)).where(PropertyRequestMatch.request_id.in_(ids)).group_by(PropertyRequestMatch.request_id)).all()) if ids else {}
    resp_counts = dict(db.execute(select(PropertyRequestMediatorResponse.request_id, func.count(PropertyRequestMediatorResponse.id)).where(PropertyRequestMediatorResponse.request_id.in_(ids)).group_by(PropertyRequestMediatorResponse.request_id)).all()) if ids else {}

    out = []
    for r in rows:
        item = AdminPropertyRequestOut.model_validate(r, from_attributes=True)
        item.match_count = match_counts.get(r.id, 0)
        item.mediator_response_count = resp_counts.get(r.id, 0)
        out.append(item)
    return out


@router.get("/property-request-analytics", response_model=AdminAnalyticsOut)
def analytics(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    _feature_gate()
    total = db.scalar(select(func.count()).select_from(PropertyRequest)) or 0
    active = db.scalar(select(func.count()).select_from(PropertyRequest).where(PropertyRequest.status == "active")) or 0
    by_status = dict(db.execute(select(PropertyRequest.status, func.count(PropertyRequest.id)).group_by(PropertyRequest.status)).all())
    by_city = dict(
        db.execute(select(PropertyRequest.city, func.count(PropertyRequest.id)).where(PropertyRequest.city.isnot(None)).group_by(PropertyRequest.city).order_by(func.count(PropertyRequest.id).desc()).limit(15)).all()
    )

    activated_count = db.scalar(select(func.count()).select_from(PropertyRequest).where(PropertyRequest.status.notin_(["draft", "awaiting_clarification"]))) or 0
    never_matched = db.scalar(
        select(func.count()).select_from(PropertyRequest).where(PropertyRequest.status.notin_(["draft", "awaiting_clarification"]), PropertyRequest.last_matched_at.is_(None))
    ) or 0
    no_match_rate = round(never_matched / activated_count, 4) if activated_count else 0.0

    avg_hours_row = db.execute(
        select(func.avg(func.extract("epoch", PropertyRequest.last_matched_at - PropertyRequest.created_at) / 3600.0)).where(PropertyRequest.last_matched_at.isnot(None))
    ).scalar()
    avg_time_to_first_match_hours = round(avg_hours_row, 2) if avg_hours_row is not None else None

    total_matches = db.scalar(select(func.count()).select_from(PropertyRequestMatch)) or 0
    saved_matches = db.scalar(select(func.count()).select_from(PropertyRequestMatch).where(PropertyRequestMatch.status == "saved")) or 0
    contacted_matches = db.scalar(select(func.count()).select_from(PropertyRequestMatch).where(PropertyRequestMatch.status == "contacted")) or 0
    match_to_save_rate = round(saved_matches / total_matches, 4) if total_matches else 0.0
    match_to_contact_rate = round(contacted_matches / total_matches, 4) if total_matches else 0.0

    requests_with_response = db.scalar(select(func.count(func.distinct(PropertyRequestMediatorResponse.request_id)))) or 0
    mediator_response_rate = round(requests_with_response / activated_count, 4) if activated_count else 0.0

    fulfilled = by_status.get("fulfilled", 0)
    expired = by_status.get("expired", 0)
    fulfillment_rate = round(fulfilled / activated_count, 4) if activated_count else 0.0
    expiry_rate = round(expired / activated_count, 4) if activated_count else 0.0

    return AdminAnalyticsOut(
        total_requests=total, active_requests=active, by_status=by_status, by_city=by_city,
        no_match_rate=no_match_rate, avg_time_to_first_match_hours=avg_time_to_first_match_hours,
        match_to_save_rate=match_to_save_rate, match_to_contact_rate=match_to_contact_rate,
        mediator_response_rate=mediator_response_rate, fulfillment_rate=fulfillment_rate, expiry_rate=expiry_rate,
    )


@router.get("/{request_id}", response_model=AdminPropertyRequestOut)
def get_request(request_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    _feature_gate()
    pr = db.get(PropertyRequest, request_id)
    if not pr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property request not found")
    item = AdminPropertyRequestOut.model_validate(pr, from_attributes=True)
    item.match_count = db.scalar(select(func.count()).select_from(PropertyRequestMatch).where(PropertyRequestMatch.request_id == pr.id)) or 0
    item.mediator_response_count = db.scalar(select(func.count()).select_from(PropertyRequestMediatorResponse).where(PropertyRequestMediatorResponse.request_id == pr.id)) or 0
    return item


@router.post("/{request_id}/pause", response_model=AdminPropertyRequestOut)
def admin_pause(request_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    _feature_gate()
    pr = db.get(PropertyRequest, request_id)
    if not pr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property request not found")
    pr.status = "paused"
    db.add(PropertyRequestActivity(request_id=pr.id, actor_type="admin", actor_id=admin.id, activity_type="paused"))
    record_audit(db, user_id=admin.id, action="property_request.admin_paused", entity_type="property_request", entity_id=pr.id, metadata={})
    db.commit()
    db.refresh(pr)
    item = AdminPropertyRequestOut.model_validate(pr, from_attributes=True)
    return item


@router.post("/{request_id}/close", response_model=AdminPropertyRequestOut)
def admin_close(request_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    _feature_gate()
    pr = db.get(PropertyRequest, request_id)
    if not pr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property request not found")
    pr.status = "closed"
    pr.matching_enabled = False
    db.add(PropertyRequestActivity(request_id=pr.id, actor_type="admin", actor_id=admin.id, activity_type="closed"))
    record_audit(db, user_id=admin.id, action="property_request.admin_closed", entity_type="property_request", entity_id=pr.id, metadata={})
    db.commit()
    db.refresh(pr)
    return AdminPropertyRequestOut.model_validate(pr, from_attributes=True)


@router.post("/{request_id}/retry-matching")
def retry_matching(request_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    _feature_gate()
    pr = db.get(PropertyRequest, request_id)
    if not pr:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property request not found")
    from app.core.jobs import enqueue
    from app.tasks.property_requests import backfill_request_matches

    enqueue(backfill_request_matches, pr.id, None)
    db.add(PropertyRequestActivity(request_id=pr.id, actor_type="admin", actor_id=admin.id, activity_type="matching_retried"))
    record_audit(db, user_id=admin.id, action="property_request.admin_retry_matching", entity_type="property_request", entity_id=pr.id, metadata={})
    db.commit()
    return {"status": "queued"}


@router.post("/{request_id}/moderate-response")
def moderate_response(
    request_id: int,
    response_id: int = Query(...),
    action: str = Query(..., pattern="^(approve|reject|flag)$"),
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    _feature_gate()
    resp = db.get(PropertyRequestMediatorResponse, response_id)
    if not resp or resp.request_id != request_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mediator response not found")
    resp.status = {"approve": "accepted", "reject": "declined", "flag": "pending"}[action]
    resp.decided_at = datetime.now(timezone.utc)
    db.add(PropertyRequestActivity(request_id=request_id, actor_type="admin", actor_id=admin.id, activity_type="mediator_response_moderated", payload={"response_id": response_id, "action": action}))
    record_audit(db, user_id=admin.id, action=f"property_request.mediator_response_{action}", entity_type="property_request_mediator_response", entity_id=response_id, metadata={})
    db.commit()
    return {"status": resp.status}
