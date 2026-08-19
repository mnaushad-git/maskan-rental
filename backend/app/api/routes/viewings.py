from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.feature_flags import is_enabled
from app.core.idempotency import IdempotencyConflict, IdempotencyStore
from app.core.rate_limit import rate_limit_dependency
from app.models.property import Property
from app.models.property_viewing import PropertyViewing
from app.models.user import User
from app.schemas.property_viewing import (
    PropertyViewingCancelRequest,
    PropertyViewingChecklistPatch,
    PropertyViewingCreate,
    PropertyViewingDetailOut,
    PropertyViewingFeedbackRequest,
    PropertyViewingOut,
    PropertyViewingProposeTimeRequest,
    ViewingNextStepsOut,
)
from app.services import property_viewing as viewing_service
from app.services.property_viewing import ViewingDomainError
from app.services.viewing_next_steps_ai import generate_next_steps

router = APIRouter()


def _require_enabled() -> None:
    # Mirrors app/api/routes/home_finder.py's per-request flag check: main.py's
    # registration-time gate only takes effect on process restart, so this is
    # what lets the flag be toggled (and tested) at runtime too.
    if not is_enabled("visit_management"):
        raise HTTPException(status_code=503, detail="Visit & Viewing Management is not currently available")


@router.post("", response_model=PropertyViewingOut, status_code=201, dependencies=[Depends(_require_enabled)])
def create_viewing(
    body: PropertyViewingCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    """A client that times out and retries viewing creation (or double-taps
    submit) must not create two viewing requests. If `Idempotency-Key` is
    supplied, a repeat request with the same key + body replays the original
    response instead of creating a second viewing — same mechanism as
    POST /leads/ (see app/core/idempotency.py)."""
    idempotency = IdempotencyStore()
    fingerprint_payload = body.model_dump(mode="json")
    if idempotency_key:
        try:
            existing = idempotency.begin("viewing-create", idempotency_key, fingerprint_payload)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if existing is not None:
            response.status_code = existing.status_code
            return existing.body

    try:
        viewing = viewing_service.create_viewing(
            db,
            current_user,
            property_id=body.property_id,
            requested_start_at=body.requested_start_at,
            requested_end_at=body.requested_end_at,
            timezone_name=body.timezone,
            customer_note=body.customer_note,
        )
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # Notification dispatch happens via the outbox publisher picking up the
    # VIEWING_REQUESTED event create_viewing() already recorded in the same
    # transaction — see app/tasks/viewing_notifications.py's registered
    # handler, same pattern as leads.py's create_lead.
    result = PropertyViewingOut.model_validate(viewing_service.to_viewing_out(viewing))
    if idempotency_key:
        idempotency.complete(
            "viewing-create",
            idempotency_key,
            fingerprint_payload,
            status_code=201,
            body=result.model_dump(mode="json"),
        )
    return result


@router.get("", response_model=list[PropertyViewingOut], dependencies=[Depends(_require_enabled)])
def list_my_viewings(
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(PropertyViewing).filter(PropertyViewing.customer_user_id == current_user.id)
    if status:
        q = q.filter(PropertyViewing.status == status)
    rows = q.order_by(PropertyViewing.requested_start_at.desc()).all()
    return [PropertyViewingOut.model_validate(viewing_service.to_viewing_out(v)) for v in rows]


@router.get("/{viewing_id}", response_model=PropertyViewingDetailOut, dependencies=[Depends(_require_enabled)])
def get_viewing(
    viewing_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    viewing = db.get(PropertyViewing, viewing_id)
    if not viewing:
        raise HTTPException(status_code=404, detail="Viewing not found")
    if viewing.customer_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your viewing")
    # Lazily generates the AI checklist on first access if not yet stored —
    # see property_viewing.py::get_or_build_checklist's generate-once note.
    return PropertyViewingDetailOut.model_validate(viewing_service.to_viewing_detail_out(db, viewing))


def _get_owned_viewing(db: Session, viewing_id: int, current_user: User) -> PropertyViewing:
    viewing = db.get(PropertyViewing, viewing_id)
    if not viewing:
        raise HTTPException(status_code=404, detail="Viewing not found")
    if viewing.customer_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your viewing")
    return viewing


@router.post("/{viewing_id}/cancel", response_model=PropertyViewingOut, dependencies=[Depends(_require_enabled)])
def cancel_viewing(
    viewing_id: int,
    body: PropertyViewingCancelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    viewing = _get_owned_viewing(db, viewing_id, current_user)
    try:
        viewing = viewing_service.cancel_viewing(db, viewing, reason=body.reason, actor_role="customer", actor_user_id=current_user.id)
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PropertyViewingOut.model_validate(viewing_service.to_viewing_out(viewing))


@router.post("/{viewing_id}/propose-time", response_model=PropertyViewingOut, dependencies=[Depends(_require_enabled)])
def propose_time(
    viewing_id: int,
    body: PropertyViewingProposeTimeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    viewing = _get_owned_viewing(db, viewing_id, current_user)
    try:
        viewing = viewing_service.propose_new_time(
            db, viewing, start_at=body.start_at, end_at=body.end_at, note=body.note, proposed_by="customer", actor_user_id=current_user.id
        )
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PropertyViewingOut.model_validate(viewing_service.to_viewing_out(viewing))


@router.post("/{viewing_id}/accept-reschedule", response_model=PropertyViewingOut, dependencies=[Depends(_require_enabled)])
def accept_reschedule(
    viewing_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    viewing = _get_owned_viewing(db, viewing_id, current_user)
    try:
        viewing = viewing_service.accept_reschedule(db, viewing, actor_user_id=current_user.id)
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PropertyViewingOut.model_validate(viewing_service.to_viewing_out(viewing))


@router.patch("/{viewing_id}/checklist", response_model=PropertyViewingDetailOut, dependencies=[Depends(_require_enabled)])
def update_viewing_checklist(
    viewing_id: int,
    body: PropertyViewingChecklistPatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Persists checked-state toggles for existing checklist items and/or
    appends a new private note (brief §15 "During Viewing" mode). Generates
    the checklist first if this is the very first access (see
    get_or_build_checklist's generate-once note) — a PATCH doesn't require
    a prior GET."""
    viewing = _get_owned_viewing(db, viewing_id, current_user)
    viewing = viewing_service.apply_checklist_patch(db, viewing, checked=body.checked, note=body.note)
    return PropertyViewingDetailOut.model_validate(viewing_service.to_viewing_detail_out(db, viewing))


@router.post("/{viewing_id}/feedback", response_model=PropertyViewingOut, dependencies=[Depends(_require_enabled)])
def submit_feedback(
    viewing_id: int,
    body: PropertyViewingFeedbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Feedback on an already-completed viewing (brief §16) — no status
    transition, just persists interest_level/note/reason."""
    viewing = _get_owned_viewing(db, viewing_id, current_user)
    try:
        viewing = viewing_service.submit_feedback(db, viewing, interest_level=body.interest_level, note=body.note, reason=body.reason)
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PropertyViewingOut.model_validate(viewing_service.to_viewing_out(viewing))


@router.post(
    "/{viewing_id}/ai-next-steps",
    response_model=ViewingNextStepsOut,
    dependencies=[
        Depends(_require_enabled),
        Depends(rate_limit_dependency("viewing_ai_next_steps", limit=20, window_seconds=600, by_user=True)),
    ],
)
def ai_next_steps(
    viewing_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """"Ask myMakan What Next?" (brief §17) — only callable once the
    viewing is completed; feedback is not required first but the summary
    is richer if it's present."""
    viewing = _get_owned_viewing(db, viewing_id, current_user)
    if viewing.status != "completed":
        raise HTTPException(status_code=409, detail="Next steps are only available for a completed viewing")

    prop = db.get(Property, viewing.property_id)
    feedback = None
    if viewing.interest_level:
        feedback = {"interest_level": viewing.interest_level, "reason": viewing.feedback_reason, "note": viewing.feedback_note}

    result = generate_next_steps(
        viewing,
        prop,
        viewing.checklist_state,
        viewing.private_notes,
        feedback,
        user_id=current_user.id,
    )
    return ViewingNextStepsOut(visit_summary=result.visit_summary, next_steps=result.next_steps, generated_by=result.generated_by)
