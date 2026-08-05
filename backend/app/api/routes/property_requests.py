from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.audit import record_audit
from app.core.config import settings
from app.core.feature_flags import is_enabled
from app.core.idempotency import IdempotencyConflict, IdempotencyStore
from app.core.outbox import EventType, record_event
from app.core.property_request.criteria import refresh_canonical_filters
from app.core.rate_limit import rate_limit_dependency
from app.models.analytics_event import AnalyticsEvent
from app.models.property_request import (
    PROPERTY_REQUEST_STATUSES,
    PROPERTY_REQUEST_TERMINAL_STATUSES,
    PropertyRequest,
    PropertyRequestActivity,
    PropertyRequestClarification,
    PropertyRequestRevision,
)
from app.models.property_request_match import PROPERTY_REQUEST_MATCH_STATUSES, PropertyRequestMatch
from app.models.property_request_mediator_response import PropertyRequestMediatorResponse
from app.models.user import User as UserModel
from app.schemas.property_request import (
    AIAgentRequest,
    AIAgentResponse,
    ActivityOut,
    AreaSuggestionOut,
    ClarificationAnswer,
    ClarificationOut,
    NoMatchDiagnosticOut,
    PropertyRequestCreate,
    PropertyRequestExtractionOut,
    PropertyRequestFromText,
    PropertyRequestMatchOut,
    PropertyRequestOut,
    PropertyRequestSummaryOut,
    PropertyRequestUpdate,
)
from app.services import property_request_ai
from app.services.property_request_area_suggestions import suggest_areas
from app.services.property_request_matcher import match_properties_for_request, restrictive_criteria_report

router = APIRouter()

STRUCTURED_FIELDS = list(PropertyRequestCreate.model_fields.keys())


def _feature_gate() -> None:
    if not is_enabled("property_requests"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Property requests are not currently available")


def _get_owned(db: Session, request_id: int, user: UserModel) -> PropertyRequest:
    pr = db.get(PropertyRequest, request_id)
    if not pr or pr.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Property request not found")
    return pr


def _track(db: Session, *, event_name: str, user_id: int | None, properties: dict | None = None) -> None:
    """Analytics event — never include free-text notes/description here
    (Phase 15: "Do not log private free-text requirements into normal
    analytics")."""
    from app.core.request_context import get_request_id

    db.add(AnalyticsEvent(event_name=event_name, user_id=user_id, properties=properties or {}, trace_id=get_request_id()))


def _record_activity(db: Session, pr: PropertyRequest, *, actor_type: str, actor_id: int | None, activity_type: str, payload: dict | None = None) -> None:
    db.add(PropertyRequestActivity(request_id=pr.id, actor_type=actor_type, actor_id=actor_id, activity_type=activity_type, payload=payload or {}))


def _record_revision(db: Session, pr: PropertyRequest, *, changed_fields: list[str], change_reason: str, user_id: int | None, bump: bool = True) -> None:
    refresh_canonical_filters(pr)
    if bump:
        pr.revision_number += 1
    snapshot = {
        "title": pr.title, "transaction_type": pr.transaction_type, "property_category": pr.property_category, "city": pr.city,
        "preferred_districts": pr.preferred_districts, "excluded_districts": pr.excluded_districts,
        "min_price": pr.min_price, "max_price": pr.max_price,
        "bedrooms_min": pr.bedrooms_min, "bedrooms_max": pr.bedrooms_max, "bathrooms_min": pr.bathrooms_min, "bathrooms_max": pr.bathrooms_max,
        "must_have_fields": pr.must_have_fields, "nice_to_have_fields": pr.nice_to_have_fields, "flexible_fields": pr.flexible_fields,
        "canonical_filters": pr.canonical_filters,
    }
    db.add(PropertyRequestRevision(request_id=pr.id, revision_number=pr.revision_number, snapshot=snapshot, changed_fields=changed_fields, change_reason=change_reason, created_by_user_id=user_id))


def _apply_fields(pr: PropertyRequest, data: dict) -> list[str]:
    changed = []
    for key, value in data.items():
        if hasattr(pr, key) and getattr(pr, key) != value:
            setattr(pr, key, value)
            changed.append(key)
    return changed


def _attach_counts(db: Session, rows: list[PropertyRequest]) -> dict[int, dict]:
    if not rows:
        return {}
    ids = [r.id for r in rows]
    match_counts = dict(db.execute(select(PropertyRequestMatch.request_id, func.count(PropertyRequestMatch.id)).where(PropertyRequestMatch.request_id.in_(ids)).group_by(PropertyRequestMatch.request_id)).all())
    new_match_counts = dict(
        db.execute(
            select(PropertyRequestMatch.request_id, func.count(PropertyRequestMatch.id))
            .where(PropertyRequestMatch.request_id.in_(ids), PropertyRequestMatch.status == "new")
            .group_by(PropertyRequestMatch.request_id)
        ).all()
    )
    response_counts = dict(
        db.execute(select(PropertyRequestMediatorResponse.request_id, func.count(PropertyRequestMediatorResponse.id)).where(PropertyRequestMediatorResponse.request_id.in_(ids)).group_by(PropertyRequestMediatorResponse.request_id)).all()
    )
    return {r.id: {"match_count": match_counts.get(r.id, 0), "new_match_count": new_match_counts.get(r.id, 0), "mediator_response_count": response_counts.get(r.id, 0)} for r in rows}


def _to_summary(pr: PropertyRequest, counts: dict) -> PropertyRequestSummaryOut:
    out = PropertyRequestSummaryOut.model_validate(pr, from_attributes=True)
    c = counts.get(pr.id, {})
    out.match_count = c.get("match_count", 0)
    out.new_match_count = c.get("new_match_count", 0)
    out.mediator_response_count = c.get("mediator_response_count", 0)
    return out


def _to_out(pr: PropertyRequest, counts: dict) -> PropertyRequestOut:
    out = PropertyRequestOut.model_validate(pr, from_attributes=True)
    c = counts.get(pr.id, {})
    out.match_count = c.get("match_count", 0)
    out.new_match_count = c.get("new_match_count", 0)
    out.mediator_response_count = c.get("mediator_response_count", 0)
    return out


# ── Creation ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=PropertyRequestOut, status_code=status.HTTP_201_CREATED)
def create_property_request(
    payload: PropertyRequestCreate,
    response: Response,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    _rl=Depends(rate_limit_dependency("property_request_create", limit=30, window_seconds=3600, by_user=True)),
):
    _feature_gate()
    idempotency = IdempotencyStore()
    fingerprint_payload = payload.model_dump(mode="json")
    if idempotency_key:
        try:
            existing = idempotency.begin("property-request-create", idempotency_key, fingerprint_payload)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        if existing is not None:
            response.status_code = existing.status_code
            return existing.body

    pr = PropertyRequest(user_id=current_user.id, **payload.model_dump(), status="draft")
    refresh_canonical_filters(pr)
    db.add(pr)
    db.flush()
    _record_revision(db, pr, changed_fields=STRUCTURED_FIELDS, change_reason="user_created", user_id=current_user.id, bump=False)
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="created")
    record_event(db, event_type=EventType.PROPERTY_REQUEST_CREATED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id, "user_id": current_user.id})
    record_audit(db, user_id=current_user.id, action="property_request.created", entity_type="property_request", entity_id=pr.id, metadata={})
    _track(db, event_name="property_request_started", user_id=current_user.id, properties={"request_id": pr.id})
    _track(db, event_name="property_request_created_from_form", user_id=current_user.id, properties={"request_id": pr.id})
    db.commit()
    db.refresh(pr)

    out = _to_out(pr, _attach_counts(db, [pr]))
    if idempotency_key:
        idempotency.complete("property-request-create", idempotency_key, fingerprint_payload, status_code=201, body=out.model_dump(mode="json"))
    return out


@router.post("/from-text", response_model=PropertyRequestExtractionOut, status_code=status.HTTP_201_CREATED)
def create_from_text(
    payload: PropertyRequestFromText,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("property_request_from_text", limit=20, window_seconds=600, by_user=True)),
):
    """AI-assisted creation (Phase 3). Always creates a `draft` (or
    `awaiting_clarification`) Property Request pre-filled from the extracted
    criteria — never `active`. The customer must still review and call
    `/activate` before matching/mediator responses begin (Phase 2: "User
    confirmation is required before activating an AI-created request")."""
    _feature_gate()
    if not is_enabled("ai_property_request_creation"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI request creation is not currently available")
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI service not configured")

    result = property_request_ai.extract_from_text(text=payload.text, locale=payload.locale, user_id=current_user.id)
    draft = {k: v for k, v in result.draft.items() if k in STRUCTURED_FIELDS}
    draft.setdefault("locale", payload.locale)
    draft.setdefault("title", payload.text[:80])
    validated = PropertyRequestCreate.model_validate(draft)
    fields = validated.model_dump()
    fields["description"] = fields.get("description") or result.draft.get("description") or payload.text[:2000]

    pr = PropertyRequest(
        user_id=current_user.id,
        **fields,
        status="awaiting_clarification" if result.clarifying_questions else "draft",
        ai_extracted_criteria=result.draft,
        ai_confidence=result.ai_confidence,
        ai_trace_id=result.ai_trace_id,
        clarification_status="pending" if result.clarifying_questions else "none",
    )
    refresh_canonical_filters(pr)
    db.add(pr)
    db.flush()

    for i, question in enumerate(result.clarifying_questions[: settings.PROPERTY_REQUEST_MAX_CLARIFICATION_ROUNDS], start=1):
        db.add(PropertyRequestClarification(request_id=pr.id, round_number=1, question=question, question_locale=payload.locale, status="pending"))
    if result.clarifying_questions:
        pr.clarification_rounds = 1

    _record_revision(db, pr, changed_fields=STRUCTURED_FIELDS, change_reason="ai_extraction", user_id=current_user.id, bump=False)
    _record_activity(db, pr, actor_type="ai", actor_id=None, activity_type="ai_extracted", payload={"ai_confidence": result.ai_confidence, "missing_fields": result.missing_fields})
    record_event(db, event_type=EventType.PROPERTY_REQUEST_CREATED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id, "user_id": current_user.id, "source": "ai"})
    record_audit(db, user_id=current_user.id, action="property_request.created_from_ai", entity_type="property_request", entity_id=pr.id, metadata={"ai_confidence": result.ai_confidence})
    _track(db, event_name="property_request_started", user_id=current_user.id, properties={"request_id": pr.id})
    _track(db, event_name="property_request_created_from_ai", user_id=current_user.id, properties={"request_id": pr.id, "ai_confidence": result.ai_confidence})
    if result.clarifying_questions:
        _track(db, event_name="property_request_clarification_asked", user_id=current_user.id, properties={"request_id": pr.id, "count": len(result.clarifying_questions)})
    db.commit()
    db.refresh(pr)

    return PropertyRequestExtractionOut(
        draft=_to_out(pr, _attach_counts(db, [pr])),
        ai_confidence=result.ai_confidence,
        missing_fields=result.missing_fields,
        clarifying_questions=result.clarifying_questions,
        ai_trace_id=result.ai_trace_id,
    )


# ── Listing / detail ─────────────────────────────────────────────────────────

@router.get("/", response_model=list[PropertyRequestSummaryOut])
def list_property_requests(
    response: Response,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(PropertyRequest).where(PropertyRequest.user_id == current_user.id)
    if status_filter:
        if status_filter not in PROPERTY_REQUEST_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid status")
        stmt = stmt.where(PropertyRequest.status == status_filter)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    response.headers["X-Total-Count"] = str(total)
    rows = db.scalars(stmt.order_by(PropertyRequest.created_at.desc()).offset(skip).limit(limit)).all()
    counts = _attach_counts(db, rows)
    return [_to_summary(r, counts) for r in rows]


@router.get("/{request_id}", response_model=PropertyRequestOut)
def get_property_request(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    return _to_out(pr, _attach_counts(db, [pr]))


@router.patch("/{request_id}", response_model=PropertyRequestOut)
def update_property_request(
    request_id: int,
    payload: PropertyRequestUpdate,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("property_request_update", limit=60, window_seconds=3600, by_user=True)),
):
    pr = _get_owned(db, request_id, current_user)
    if pr.status in PROPERTY_REQUEST_TERMINAL_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot edit a {pr.status} request")

    changes = payload.model_dump(exclude_unset=True)
    changed_fields = _apply_fields(pr, changes)
    if changed_fields:
        pr.updated_at = datetime.now(timezone.utc)
        pr.last_customer_activity_at = datetime.now(timezone.utc)
        _record_revision(db, pr, changed_fields=changed_fields, change_reason="user_edit", user_id=current_user.id)
        _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="edited", payload={"fields": changed_fields})
        record_audit(db, user_id=current_user.id, action="property_request.updated", entity_type="property_request", entity_id=pr.id, metadata={"fields": changed_fields})
        if pr.status == "active":
            record_event(db, event_type=EventType.PROPERTY_REQUEST_UPDATED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id})
        _track(db, event_name="property_request_edited", user_id=current_user.id, properties={"request_id": pr.id, "fields": changed_fields})
    db.commit()
    db.refresh(pr)
    return _to_out(pr, _attach_counts(db, [pr]))


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_property_request(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Soft-cancel — like the rest of this codebase, nothing about a Property
    Request is hard-deleted (Phase 2: "closed or expired requests remain
    visible in history")."""
    pr = _get_owned(db, request_id, current_user)
    pr.status = "cancelled"
    pr.matching_enabled = False
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="cancelled")
    record_audit(db, user_id=current_user.id, action="property_request.cancelled", entity_type="property_request", entity_id=pr.id, metadata={})
    db.commit()


# ── Lifecycle ────────────────────────────────────────────────────────────────

@router.post("/{request_id}/activate", response_model=PropertyRequestOut)
def activate_property_request(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    if pr.status not in ("draft", "awaiting_clarification", "paused"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Cannot activate a request in status '{pr.status}'")
    if not pr.transaction_type or not pr.city:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="transaction_type and city are required to activate a request")

    active_count = db.scalar(select(func.count()).select_from(PropertyRequest).where(PropertyRequest.user_id == current_user.id, PropertyRequest.status == "active")) or 0
    if active_count >= settings.PROPERTY_REQUEST_ACTIVE_LIMIT_PER_USER:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"You've reached the limit of {settings.PROPERTY_REQUEST_ACTIVE_LIMIT_PER_USER} active property requests.")

    was_paused = pr.status == "paused"
    pr.status = "active"
    if not pr.expiry_date:
        pr.expiry_date = datetime.now(timezone.utc) + timedelta(days=settings.PROPERTY_REQUEST_DEFAULT_EXPIRY_DAYS)
    pr.last_customer_activity_at = datetime.now(timezone.utc)
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="activated")
    record_event(db, event_type=EventType.PROPERTY_REQUEST_ACTIVATED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id, "user_id": current_user.id})
    record_audit(db, user_id=current_user.id, action="property_request.activated", entity_type="property_request", entity_id=pr.id, metadata={})
    _track(db, event_name="property_request_resumed" if was_paused else "property_request_activated", user_id=current_user.id, properties={"request_id": pr.id})
    db.commit()
    db.refresh(pr)
    return _to_out(pr, _attach_counts(db, [pr]))


@router.post("/{request_id}/pause", response_model=PropertyRequestOut)
def pause_property_request(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    if pr.status != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an active request can be paused")
    pr.status = "paused"
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="paused")
    record_event(db, event_type=EventType.PROPERTY_REQUEST_PAUSED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id})
    record_audit(db, user_id=current_user.id, action="property_request.paused", entity_type="property_request", entity_id=pr.id, metadata={})
    _track(db, event_name="property_request_paused", user_id=current_user.id, properties={"request_id": pr.id})
    db.commit()
    db.refresh(pr)
    return _to_out(pr, _attach_counts(db, [pr]))


@router.post("/{request_id}/resume", response_model=PropertyRequestOut)
def resume_property_request(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    if pr.status != "paused":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a paused request can be resumed")
    pr.status = "active"
    pr.last_customer_activity_at = datetime.now(timezone.utc)
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="resumed")
    record_event(db, event_type=EventType.PROPERTY_REQUEST_RESUMED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id})
    record_audit(db, user_id=current_user.id, action="property_request.resumed", entity_type="property_request", entity_id=pr.id, metadata={})
    _track(db, event_name="property_request_resumed", user_id=current_user.id, properties={"request_id": pr.id})
    db.commit()
    db.refresh(pr)
    return _to_out(pr, _attach_counts(db, [pr]))


@router.post("/{request_id}/close", response_model=PropertyRequestOut)
def close_property_request(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    if pr.status in PROPERTY_REQUEST_TERMINAL_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Request is already {pr.status}")
    pr.status = "closed"
    pr.matching_enabled = False
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="closed")
    record_event(db, event_type=EventType.PROPERTY_REQUEST_CLOSED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id})
    record_audit(db, user_id=current_user.id, action="property_request.closed", entity_type="property_request", entity_id=pr.id, metadata={})
    _track(db, event_name="property_request_closed", user_id=current_user.id, properties={"request_id": pr.id})
    db.commit()
    db.refresh(pr)
    return _to_out(pr, _attach_counts(db, [pr]))


@router.post("/{request_id}/fulfill", response_model=PropertyRequestOut)
def fulfill_property_request(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    if pr.status in PROPERTY_REQUEST_TERMINAL_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Request is already {pr.status}")
    pr.status = "fulfilled"
    pr.matching_enabled = False
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="fulfilled")
    record_event(db, event_type=EventType.PROPERTY_REQUEST_FULFILLED, aggregate_type="property_request", aggregate_id=pr.id, payload={"request_id": pr.id})
    record_audit(db, user_id=current_user.id, action="property_request.fulfilled", entity_type="property_request", entity_id=pr.id, metadata={})
    _track(db, event_name="property_request_fulfilled", user_id=current_user.id, properties={"request_id": pr.id})

    if is_enabled("property_request_notifications"):
        from app.services.property_request_notifications import create_and_deliver

        create_and_deliver(db, request=pr, change_type="fulfilled")
    db.commit()
    db.refresh(pr)
    return _to_out(pr, _attach_counts(db, [pr]))


# ── Clarifications ───────────────────────────────────────────────────────────

@router.post("/{request_id}/clarifications", response_model=list[ClarificationOut])
def request_clarifications(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Generates the next round of clarifying questions from the AI, capped
    at `PROPERTY_REQUEST_MAX_CLARIFICATION_ROUNDS` (Phase 3)."""
    pr = _get_owned(db, request_id, current_user)
    if pr.clarification_rounds >= settings.PROPERTY_REQUEST_MAX_CLARIFICATION_ROUNDS:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Maximum clarification rounds reached")
    if not settings.ANTHROPIC_API_KEY or not is_enabled("ai_property_request_creation"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI service not configured")

    text = pr.description or pr.notes or pr.title
    result = property_request_ai.extract_from_text(text=text, locale=pr.locale, user_id=current_user.id)
    if not result.clarifying_questions:
        return []

    pr.clarification_rounds += 1
    pr.clarification_status = "pending"
    rows = []
    for question in result.clarifying_questions:
        row = PropertyRequestClarification(request_id=pr.id, round_number=pr.clarification_rounds, question=question, question_locale=pr.locale, status="pending")
        db.add(row)
        rows.append(row)
    _record_activity(db, pr, actor_type="ai", actor_id=None, activity_type="clarification_requested", payload={"round": pr.clarification_rounds})
    _track(db, event_name="property_request_clarification_asked", user_id=current_user.id, properties={"request_id": pr.id, "round": pr.clarification_rounds})
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


@router.post("/{request_id}/clarifications/{clarification_id}/answer", response_model=ClarificationOut)
def answer_clarification(
    request_id: int, clarification_id: int, payload: ClarificationAnswer,
    current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db),
):
    pr = _get_owned(db, request_id, current_user)
    clarification = db.get(PropertyRequestClarification, clarification_id)
    if not clarification or clarification.request_id != pr.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clarification not found")

    # Count BEFORE mutating this row (SQLAlchemy autoflush would otherwise
    # flush the UPDATE below ahead of this SELECT, excluding the very row
    # we're answering from its own "still pending" count).
    pending_before = db.scalar(
        select(func.count()).select_from(PropertyRequestClarification).where(PropertyRequestClarification.request_id == pr.id, PropertyRequestClarification.status == "pending")
    ) or 0

    clarification.answer = payload.answer
    clarification.status = "answered"
    clarification.answered_at = datetime.now(timezone.utc)

    if pending_before <= 1:  # this was the only (or last) pending clarification
        pr.clarification_status = "resolved"

    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="clarification_answered", payload={"clarification_id": clarification.id})
    _track(db, event_name="property_request_clarification_answered", user_id=current_user.id, properties={"request_id": pr.id})
    db.commit()
    db.refresh(clarification)
    return clarification


# ── Matches ──────────────────────────────────────────────────────────────────

@router.get("/{request_id}/matches", response_model=list[PropertyRequestMatchOut])
def list_matches(
    request_id: int,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    pr = _get_owned(db, request_id, current_user)
    stmt = select(PropertyRequestMatch).where(PropertyRequestMatch.request_id == pr.id)
    if status_filter:
        if status_filter not in PROPERTY_REQUEST_MATCH_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid status")
        stmt = stmt.where(PropertyRequestMatch.status == status_filter)
    rows = db.scalars(stmt.order_by(PropertyRequestMatch.match_score.desc()).offset(skip).limit(limit)).all()
    return rows


def _get_owned_match(db: Session, pr: PropertyRequest, match_id: int) -> PropertyRequestMatch:
    match = db.get(PropertyRequestMatch, match_id)
    if not match or match.request_id != pr.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")
    return match


@router.post("/{request_id}/matches/{match_id}/dismiss", response_model=PropertyRequestMatchOut)
def dismiss_match(request_id: int, match_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    match = _get_owned_match(db, pr, match_id)
    match.status = "dismissed"
    _track(db, event_name="property_request_match_dismissed", user_id=current_user.id, properties={"request_id": pr.id, "match_id": match.id})
    db.commit()
    db.refresh(match)
    return match


@router.post("/{request_id}/matches/{match_id}/save", response_model=PropertyRequestMatchOut)
def save_match(request_id: int, match_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    match = _get_owned_match(db, pr, match_id)
    match.status = "saved"
    _track(db, event_name="property_request_match_saved", user_id=current_user.id, properties={"request_id": pr.id, "match_id": match.id})
    db.commit()
    db.refresh(match)
    return match


@router.post("/{request_id}/matches/{match_id}/contact", response_model=PropertyRequestMatchOut)
def contact_match(request_id: int, match_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    match = _get_owned_match(db, pr, match_id)
    match.status = "contacted"
    _record_activity(db, pr, actor_type="customer", actor_id=current_user.id, activity_type="match_contacted", payload={"match_id": match.id, "property_id": match.property_id})
    _track(db, event_name="property_request_match_contacted", user_id=current_user.id, properties={"request_id": pr.id, "match_id": match.id})
    db.commit()
    db.refresh(match)
    return match


# ── Activity, diagnostics, areas, AI agent ──────────────────────────────────

@router.get("/{request_id}/activity", response_model=list[ActivityOut])
def list_activity(
    request_id: int, skip: int = Query(default=0, ge=0), limit: int = Query(default=50, ge=1, le=200),
    current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db),
):
    pr = _get_owned(db, request_id, current_user)
    rows = db.scalars(select(PropertyRequestActivity).where(PropertyRequestActivity.request_id == pr.id).order_by(PropertyRequestActivity.created_at.desc()).offset(skip).limit(limit)).all()
    return rows


@router.get("/{request_id}/no-match-diagnostics", response_model=list[NoMatchDiagnosticOut])
def no_match_diagnostics(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    pr = _get_owned(db, request_id, current_user)
    report = restrictive_criteria_report(db, pr)
    if not report:
        _track(db, event_name="property_request_no_match", user_id=current_user.id, properties={"request_id": pr.id})
        db.commit()
    return report


@router.get("/{request_id}/area-suggestions", response_model=list[AreaSuggestionOut])
def area_suggestions(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    if not is_enabled("property_request_area_suggestions"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Area suggestions are not currently available")
    pr = _get_owned(db, request_id, current_user)
    return suggest_areas(db, pr)


@router.post("/{request_id}/preview-matches", response_model=list[PropertyRequestMatchOut])
def preview_matches(request_id: int, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    """Bounded, read-only preview of what would match right now — used by
    the review-before-activate step. Does not persist anything."""
    pr = _get_owned(db, request_id, current_user)
    results = match_properties_for_request(db, pr)[:10]
    return [
        PropertyRequestMatchOut(
            id=None, property_id=r.property.id, match_score=r.match_score, flexible_coverage=r.flexible_coverage,
            preference_score=r.preference_score, price_fit_score=r.price_fit_score, area_fit_score=r.area_fit_score,
            commute_fit_score=r.commute_fit_score, listing_quality_score=r.listing_quality_score, confidence=r.confidence,
            match_reasons=r.match_reasons, trade_offs=r.trade_offs, match_version=r.match_version, status="new",
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc),
        )
        for r in results
    ]


@router.post("/{request_id}/ai-agent", response_model=AIAgentResponse)
def ai_agent(
    request_id: int, payload: AIAgentRequest,
    current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db),
    _rl=Depends(rate_limit_dependency("property_agent_chat", limit=20, window_seconds=600, by_user=True)),
):
    if not is_enabled("ai_property_agent"):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="The AI Property Agent is not currently available")
    if not settings.ANTHROPIC_API_KEY:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="AI service not configured")
    pr = _get_owned(db, request_id, current_user)
    try:
        reply, trace_id = property_request_ai.run_agent_turn(db, request=pr, message=payload.message, history=payload.history, user_id=current_user.id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI error: {exc}") from exc
    return AIAgentResponse(reply=reply, ai_trace_id=trace_id)
