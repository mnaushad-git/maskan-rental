"""Visit & Viewing Management — partner portal backend (Prompt 4). Mirrors
partner_quality.py exactly: standalone router, `/partner/viewings` prefix,
every endpoint gated on `Depends(get_mediator_user)` +
`viewing.mediator_id != mediator.id -> 403 "Not your listing"`, mounted in
main.py alongside `partner_quality.router`. Gated behind
`FEATURE_VISIT_MANAGEMENT` the same way `viewings.py` (customer side) is.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_mediator_user
from app.core.feature_flags import is_enabled
from app.models.mediator import Mediator
from app.models.property_viewing import PropertyViewing
from app.models.user import User
from app.schemas.property_viewing import (
    PartnerPropertyViewingOut,
    PropertyViewingConfirmRequest,
    PropertyViewingMediatorCancelRequest,
    PropertyViewingNoShowRequest,
    PropertyViewingProposeTimeRequest,
)
from app.services import property_viewing as viewing_service
from app.services.property_viewing import ViewingDomainError

router = APIRouter()


def _require_enabled() -> None:
    if not is_enabled("visit_management"):
        raise HTTPException(status_code=503, detail="Visit & Viewing Management is not currently available")


def _load_owned_viewing(db: Session, viewing_id: int, mediator: Mediator) -> PropertyViewing:
    viewing = db.get(PropertyViewing, viewing_id)
    if not viewing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Viewing not found")
    if viewing.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    return viewing


@router.get("", response_model=list[PartnerPropertyViewingOut], dependencies=[Depends(_require_enabled)])
def list_partner_viewings(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    _user, mediator = mediator_user
    q = db.query(PropertyViewing).filter(PropertyViewing.mediator_id == mediator.id)
    if status_filter:
        q = q.filter(PropertyViewing.status == status_filter)
    rows = q.order_by(PropertyViewing.requested_start_at.desc()).all()
    return [PartnerPropertyViewingOut.model_validate(viewing_service.to_partner_viewing_out(v)) for v in rows]


@router.get("/{viewing_id}", response_model=PartnerPropertyViewingOut, dependencies=[Depends(_require_enabled)])
def get_partner_viewing(
    viewing_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    _user, mediator = mediator_user
    viewing = _load_owned_viewing(db, viewing_id, mediator)
    return PartnerPropertyViewingOut.model_validate(viewing_service.to_partner_viewing_out(viewing))


@router.post("/{viewing_id}/confirm", response_model=PartnerPropertyViewingOut, dependencies=[Depends(_require_enabled)])
def confirm_viewing(
    viewing_id: int,
    body: PropertyViewingConfirmRequest,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    user, mediator = mediator_user
    viewing = _load_owned_viewing(db, viewing_id, mediator)
    try:
        viewing = viewing_service.confirm_viewing(db, viewing, mediator_note=body.mediator_note, actor_user_id=user.id)
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerPropertyViewingOut.model_validate(viewing_service.to_partner_viewing_out(viewing))


@router.post("/{viewing_id}/propose-time", response_model=PartnerPropertyViewingOut, dependencies=[Depends(_require_enabled)])
def propose_time(
    viewing_id: int,
    body: PropertyViewingProposeTimeRequest,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    user, mediator = mediator_user
    viewing = _load_owned_viewing(db, viewing_id, mediator)
    try:
        viewing = viewing_service.propose_new_time(
            db, viewing, start_at=body.start_at, end_at=body.end_at, note=body.note, proposed_by="mediator", actor_user_id=user.id
        )
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerPropertyViewingOut.model_validate(viewing_service.to_partner_viewing_out(viewing))


@router.post("/{viewing_id}/cancel", response_model=PartnerPropertyViewingOut, dependencies=[Depends(_require_enabled)])
def cancel_viewing(
    viewing_id: int,
    body: PropertyViewingMediatorCancelRequest,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    user, mediator = mediator_user
    viewing = _load_owned_viewing(db, viewing_id, mediator)
    try:
        viewing = viewing_service.cancel_viewing(db, viewing, reason=body.reason, actor_role="mediator", actor_user_id=user.id)
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerPropertyViewingOut.model_validate(viewing_service.to_partner_viewing_out(viewing))


@router.post("/{viewing_id}/complete", response_model=PartnerPropertyViewingOut, dependencies=[Depends(_require_enabled)])
def complete_viewing(
    viewing_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    user, mediator = mediator_user
    viewing = _load_owned_viewing(db, viewing_id, mediator)
    try:
        viewing = viewing_service.complete_viewing(db, viewing, actor_user_id=user.id)
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerPropertyViewingOut.model_validate(viewing_service.to_partner_viewing_out(viewing))


@router.post("/{viewing_id}/no-show", response_model=PartnerPropertyViewingOut, dependencies=[Depends(_require_enabled)])
def mark_no_show(
    viewing_id: int,
    body: PropertyViewingNoShowRequest,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    user, mediator = mediator_user
    viewing = _load_owned_viewing(db, viewing_id, mediator)
    try:
        viewing = viewing_service.mark_no_show(db, viewing, who=body.who, actor_user_id=user.id)
    except ViewingDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerPropertyViewingOut.model_validate(viewing_service.to_partner_viewing_out(viewing))
