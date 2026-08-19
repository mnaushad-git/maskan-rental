"""AI Negotiation & Offer Management — customer-facing routes (Prompt 2).
See docs/implementation/mymakan-negotiations.md.

Mounted with an EMPTY path segment in main.py (unlike most routers), because
this feature's endpoints deliberately span two different URL roots —
/properties/{property_id}/negotiations[/active] (create + the "does this
customer already have one open" lookup) and /negotiations[/id] (list/detail)
— so app.include_router's own prefix stays exactly "/api"/"/api/v1" and each
route below spells out its own full path from there. See main.py's
_ROUTERS list for how this is wired.
"""
from fastapi import APIRouter, Depends, Header, HTTPException, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.feature_flags import is_enabled
from app.core.idempotency import IdempotencyConflict, IdempotencyStore
from app.core.rate_limit import rate_limit_dependency
from app.models.property_negotiation import PropertyNegotiation
from app.models.user import User
from app.schemas.property_negotiation import (
    NegotiationAIGuidanceRequest,
    NegotiationAIGuidanceResponse,
    NegotiationOfferCreate,
    NegotiationWithdrawRequest,
    PropertyNegotiationCreate,
    PropertyNegotiationDetailOut,
    PropertyNegotiationOut,
)
from app.services import negotiation_ai
from app.services import property_negotiation as negotiation_service
from app.services.property_negotiation import NegotiationDomainError

router = APIRouter()


def _require_enabled() -> None:
    # Mirrors app/api/routes/viewings.py's _require_enabled: main.py's
    # registration-time gate only takes effect on process restart, so this is
    # what lets the flag be toggled (and tested) at runtime too.
    if not is_enabled("negotiations"):
        raise HTTPException(status_code=503, detail="Negotiation & Offer Management is not currently available")


@router.post(
    "/properties/{property_id}/negotiations",
    response_model=PropertyNegotiationOut,
    status_code=201,
    dependencies=[Depends(_require_enabled)],
)
def create_negotiation(
    property_id: int,
    body: PropertyNegotiationCreate,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    """A client that times out and retries offer submission (or double-taps
    submit) must not create two negotiations. If `Idempotency-Key` is
    supplied, a repeat request with the same key + body replays the original
    response instead of creating a second negotiation — same mechanism as
    POST /leads/ and POST /viewings (see app/core/idempotency.py)."""
    idempotency = IdempotencyStore()
    fingerprint_payload = {"property_id": property_id, **body.model_dump(mode="json")}
    if idempotency_key:
        try:
            existing = idempotency.begin("negotiation-create", idempotency_key, fingerprint_payload)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        if existing is not None:
            response.status_code = existing.status_code
            return existing.body

    try:
        negotiation = negotiation_service.create_negotiation(
            db,
            current_user,
            property_id=property_id,
            amount=body.amount,
            message=body.message,
            viewing_id=body.viewing_id,
        )
    except NegotiationDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    # Notification dispatch happens via the outbox publisher picking up the
    # NEGOTIATION_SUBMITTED event create_negotiation() already recorded in
    # the same transaction — see app/tasks/negotiation_notifications.py's
    # registered handler, same pattern as leads.py's create_lead /
    # viewings.py's create_viewing.
    result = PropertyNegotiationOut.model_validate(negotiation_service.to_negotiation_out(negotiation))
    if idempotency_key:
        idempotency.complete(
            "negotiation-create",
            idempotency_key,
            fingerprint_payload,
            status_code=201,
            body=result.model_dump(mode="json"),
        )
    return result


@router.get("/negotiations", response_model=list[PropertyNegotiationOut], dependencies=[Depends(_require_enabled)])
def list_my_negotiations(
    status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(PropertyNegotiation).filter(PropertyNegotiation.customer_user_id == current_user.id)
    if status:
        q = q.filter(PropertyNegotiation.status == status)
    rows = q.order_by(PropertyNegotiation.updated_at.desc()).all()
    # Prompt 12: to_negotiation_list_out() (not the plain to_negotiation_out())
    # so the My Negotiations list cards can render the same negotiation_signal
    # badge the detail screen already does.
    return [PropertyNegotiationOut.model_validate(negotiation_service.to_negotiation_list_out(db, n)) for n in rows]


@router.get(
    "/properties/{property_id}/negotiations/active",
    response_model=PropertyNegotiationOut,
    dependencies=[Depends(_require_enabled)],
)
def get_active_negotiation(
    property_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """What the frontend's "Make an Offer" vs "View Negotiation" entry-point
    decision (brief §3) calls before deciding which CTA to show. Implemented
    as a dedicated route rather than folding into an `?active=true` query
    param on GET /negotiations (the prompt's documented alternative) — the
    caller here only ever has a property_id in hand (it's rendered from the
    Property Detail screen, before any negotiation exists to look up by id),
    and 404 is the natural "no, nothing to show yet" response for a direct
    lookup route in a way it wouldn't be for a list endpoint."""
    negotiation = negotiation_service.find_active_negotiation(db, current_user, property_id)
    if not negotiation:
        raise HTTPException(status_code=404, detail="No active negotiation for this property")
    return PropertyNegotiationOut.model_validate(negotiation_service.to_negotiation_out(negotiation))


@router.get(
    "/negotiations/{negotiation_id}",
    response_model=PropertyNegotiationDetailOut,
    dependencies=[Depends(_require_enabled)],
)
def get_negotiation(
    negotiation_id: int,
    language: str = "en",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """`language` (Prompt 5, optional query param, defaults "en") only
    affects `summary_text` — the deterministic "myMakan Summary" (NO AI
    call, see negotiation_ai.py), so requesting Arabic here costs nothing
    extra and needs no rate limiting, unlike the AI-backed
    POST .../ai-guidance action below."""
    negotiation = db.get(PropertyNegotiation, negotiation_id)
    if not negotiation:
        raise HTTPException(status_code=404, detail="Negotiation not found")
    if negotiation.customer_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your negotiation")
    return PropertyNegotiationDetailOut.model_validate(
        negotiation_service.to_negotiation_detail_out(db, negotiation, language=language)
    )


def _get_own_negotiation(db: Session, negotiation_id: int, current_user: User) -> PropertyNegotiation:
    """Shared 404/403 lookup for the customer-side action routes below —
    same ownership rule as GET /negotiations/{id}."""
    negotiation = db.get(PropertyNegotiation, negotiation_id)
    if not negotiation:
        raise HTTPException(status_code=404, detail="Negotiation not found")
    if negotiation.customer_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your negotiation")
    return negotiation


@router.post(
    "/negotiations/{negotiation_id}/offer",
    response_model=PropertyNegotiationOut,
    dependencies=[Depends(_require_enabled)],
)
def counter_negotiation(
    negotiation_id: int,
    body: NegotiationOfferCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Customer's "Counter Again" action — backed by the same
    submit_counter() the mediator's Prompt 4 "Counter Offer" action uses,
    with offer_type="customer_counter" identifying which side placed it."""
    negotiation = _get_own_negotiation(db, negotiation_id, current_user)
    try:
        negotiation = negotiation_service.submit_counter(
            db,
            current_user,
            negotiation,
            amount=body.amount,
            message=body.message,
            offer_type="customer_counter",
        )
    except NegotiationDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PropertyNegotiationOut.model_validate(negotiation_service.to_negotiation_out(negotiation))


@router.post(
    "/negotiations/{negotiation_id}/accept",
    response_model=PropertyNegotiationOut,
    dependencies=[Depends(_require_enabled)],
)
def accept_negotiation(
    negotiation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Customer accepting the mediator's latest counter. Blocked (409) when
    the latest pending offer was placed by this same customer (self-accept)
    — see property_negotiation.accept_offer()'s docstring."""
    negotiation = _get_own_negotiation(db, negotiation_id, current_user)
    try:
        negotiation = negotiation_service.accept_offer(db, current_user, negotiation, actor_role="customer")
    except NegotiationDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PropertyNegotiationOut.model_validate(negotiation_service.to_negotiation_out(negotiation))


@router.post(
    "/negotiations/{negotiation_id}/withdraw",
    response_model=PropertyNegotiationOut,
    dependencies=[Depends(_require_enabled)],
)
def withdraw_negotiation(
    negotiation_id: int,
    body: NegotiationWithdrawRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    negotiation = _get_own_negotiation(db, negotiation_id, current_user)
    try:
        negotiation = negotiation_service.withdraw_negotiation(db, current_user, negotiation, reason=body.reason)
    except NegotiationDomainError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return PropertyNegotiationOut.model_validate(negotiation_service.to_negotiation_out(negotiation))


@router.post(
    "/negotiations/{negotiation_id}/ai-guidance",
    response_model=NegotiationAIGuidanceResponse,
    dependencies=[
        Depends(_require_enabled),
        Depends(rate_limit_dependency("negotiation_ai_guidance", limit=20, window_seconds=600, by_user=True)),
    ],
)
def negotiation_ai_guidance(
    negotiation_id: int,
    body: NegotiationAIGuidanceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """"Ask myMakan" (brief §5) — answers a free-text question (or, if
    omitted, gives a general read of the current position) grounded ONLY in
    this negotiation's own deterministic facts. Rate-limited the same way
    every other on-request AI endpoint in this app is
    (rate_limit_dependency, see app/api/routes/ai.py) — unlike
    `summary_text` on GET /negotiations/{id} above, this is a real AI call
    (with a deterministic fallback on failure, never a 500 — see
    negotiation_ai.generate_guidance's docstring)."""
    negotiation = _get_own_negotiation(db, negotiation_id, current_user)
    offers = list(negotiation.offers)
    price_intel, insight = negotiation_service.price_intelligence_and_insight(db, negotiation.property)
    guidance, generated_by = negotiation_ai.generate_guidance(
        negotiation,
        offers,
        price_intel,
        insight,
        body.language,
        question=body.question,
        user_id=current_user.id,
    )
    return NegotiationAIGuidanceResponse(guidance=guidance, generated_by=generated_by)
