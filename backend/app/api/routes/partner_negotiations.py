"""AI Negotiation & Offer Management — partner-facing routes (Prompt 4). See
docs/implementation/mymakan-negotiations.md. Mirrors
partner_viewings.py exactly: standalone router, `/partner/negotiations`
prefix, every endpoint gated on `Depends(get_mediator_user)` +
`negotiation.mediator_id != mediator.id -> 403 "Not your listing"` via
`_load_owned_negotiation()`, mounted in main.py alongside
partner_viewings.router. Gated behind FEATURE_NEGOTIATIONS the same way
negotiations.py (customer side) is.

`submit_counter()`/`accept_offer()` are the exact same Prompt 3 service
functions the customer-side routes (negotiations.py) call — only the
actor/offer_type/actor_role differ. `reject_negotiation()` is new in this
prompt (mediator-only, no customer-side equivalent).
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_mediator_user
from app.core.feature_flags import is_enabled
from app.models.mediator import Mediator
from app.models.property_negotiation import PropertyNegotiation
from app.models.user import User
from app.schemas.property_negotiation import (
    NegotiationOfferCreate,
    NegotiationRejectRequest,
    PartnerNegotiationDetailOut,
    PartnerNegotiationOut,
)
from app.services import property_negotiation as negotiation_service
from app.services.property_negotiation import NegotiationDomainError

router = APIRouter()


def _require_enabled() -> None:
    # Mirrors negotiations.py's _require_enabled: main.py's registration-time
    # gate only takes effect on process restart, so this is what lets the
    # flag be toggled (and tested) at runtime too.
    if not is_enabled("negotiations"):
        raise HTTPException(status_code=503, detail="Negotiation & Offer Management is not currently available")


def _load_owned_negotiation(db: Session, negotiation_id: int, mediator: Mediator) -> PropertyNegotiation:
    negotiation = db.get(PropertyNegotiation, negotiation_id)
    if not negotiation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Negotiation not found")
    if negotiation.mediator_id != mediator.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your listing")
    return negotiation


@router.get("", response_model=list[PartnerNegotiationOut], dependencies=[Depends(_require_enabled)])
def list_partner_negotiations(
    status_filter: str | None = None,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Mediator's own negotiations across all their properties."""
    _user, mediator = mediator_user
    q = db.query(PropertyNegotiation).filter(PropertyNegotiation.mediator_id == mediator.id)
    if status_filter:
        q = q.filter(PropertyNegotiation.status == status_filter)
    rows = q.order_by(PropertyNegotiation.updated_at.desc()).all()
    # Prompt 12: to_partner_negotiation_list_out() (not the plain
    # to_partner_negotiation_out()) so the partner inbox list cards can render
    # the same negotiation_signal badge the detail screen already does.
    return [
        PartnerNegotiationOut.model_validate(negotiation_service.to_partner_negotiation_list_out(db, n)) for n in rows
    ]


@router.get(
    "/{negotiation_id}",
    response_model=PartnerNegotiationDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def get_partner_negotiation(
    negotiation_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """See PartnerNegotiationDetailOut's docstring for the privacy-bar
    rationale (matches, not exceeds, the existing lead-detail bar)."""
    _user, mediator = mediator_user
    negotiation = _load_owned_negotiation(db, negotiation_id, mediator)
    return PartnerNegotiationDetailOut.model_validate(
        negotiation_service.to_partner_negotiation_detail_out(db, negotiation)
    )


@router.post(
    "/{negotiation_id}/counter",
    response_model=PartnerNegotiationOut,
    dependencies=[Depends(_require_enabled)],
)
def counter_negotiation(
    negotiation_id: int,
    body: NegotiationOfferCreate,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Mediator's "Counter Offer" action — reuses the same submit_counter()
    the customer's "Counter Again" action uses (negotiations.py), with
    offer_type="mediator_counter" identifying which side placed it. 409 if
    the negotiation isn't currently submitted/countered, 422 for a
    non-positive amount."""
    user, mediator = mediator_user
    negotiation = _load_owned_negotiation(db, negotiation_id, mediator)
    try:
        negotiation = negotiation_service.submit_counter(
            db, user, negotiation, amount=body.amount, message=body.message, offer_type="mediator_counter"
        )
    except NegotiationDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerNegotiationOut.model_validate(negotiation_service.to_partner_negotiation_out(negotiation))


@router.post(
    "/{negotiation_id}/accept",
    response_model=PartnerNegotiationOut,
    dependencies=[Depends(_require_enabled)],
)
def accept_negotiation(
    negotiation_id: int,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """Mediator accepting the customer's latest offer/counter. Blocked (409)
    when the latest pending offer was placed by this same mediator's user
    account (self-accept) — see property_negotiation.accept_offer()'s
    docstring."""
    user, mediator = mediator_user
    negotiation = _load_owned_negotiation(db, negotiation_id, mediator)
    try:
        negotiation = negotiation_service.accept_offer(db, user, negotiation, actor_role="mediator")
    except NegotiationDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerNegotiationOut.model_validate(negotiation_service.to_partner_negotiation_out(negotiation))


@router.post(
    "/{negotiation_id}/reject",
    response_model=PartnerNegotiationOut,
    dependencies=[Depends(_require_enabled)],
)
def reject_negotiation(
    negotiation_id: int,
    body: NegotiationRejectRequest,
    db: Session = Depends(get_db),
    mediator_user: tuple[User, Mediator] = Depends(get_mediator_user),
):
    """New in this prompt — no customer-side equivalent. Valid from
    submitted/countered (409 otherwise)."""
    user, mediator = mediator_user
    negotiation = _load_owned_negotiation(db, negotiation_id, mediator)
    try:
        negotiation = negotiation_service.reject_negotiation(db, user, negotiation, reason=body.reason)
    except NegotiationDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PartnerNegotiationOut.model_validate(negotiation_service.to_partner_negotiation_out(negotiation))
