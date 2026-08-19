"""AI Negotiation & Offer Management domain logic (Prompts 2-3). See
docs/implementation/mymakan-negotiations.md.

Mirrors app/services/property_viewing.py's create_viewing: write the
PropertyNegotiation row + the first NegotiationOffer row and emit the
outbox event in ONE transaction, db.flush() first so record_event's
aggregate_id (the new negotiation's id) is available before commit.
"""
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.outbox import EventType, record_event
from app.models.property import Property
from app.models.property_negotiation import (
    PROPERTY_NEGOTIATION_TRANSITIONS,
    NegotiationOffer,
    PropertyNegotiation,
)
from app.models.property_viewing import PropertyViewing
from app.models.user import User
from app.services.property_viewing import _find_linked_lead_id

# Negotiation statuses that mean "this negotiation is over" — a customer may
# only have one negotiation NOT in this set open per property at a time
# (mirrors PROPERTY_VIEWING_INACTIVE_STATUSES's role, just named for what it
# actually gates here: duplicate-active-negotiation + the
# GET .../negotiations/active lookup).
NEGOTIATION_TERMINAL_STATUSES = {"accepted", "rejected", "withdrawn", "closed"}


class NegotiationDomainError(Exception):
    """A business-rule violation the route layer translates into a specific
    HTTP status (never a generic 500)."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(detail)


def _listing_amount(prop: Property) -> Decimal | None:
    """Property.monthly_rent/sale_price are plain Floats — convert via str()
    (not directly) to avoid binary-float noise leaking into the Numeric(12,2)
    column."""
    value = prop.sale_price if prop.listing_type == "sale" else prop.monthly_rent
    return Decimal(str(value)) if value is not None else None


def create_negotiation(
    db: Session,
    customer_user: User,
    *,
    property_id: int,
    amount: Decimal,
    message: str | None = None,
    viewing_id: int | None = None,
) -> PropertyNegotiation:
    prop = db.get(Property, property_id)
    if not prop or prop.status != "Published":
        raise NegotiationDomainError(404, "Property not found")

    if amount is None or amount <= 0:
        raise NegotiationDomainError(422, "amount must be greater than zero")

    # original_listing_amount is a SNAPSHOT of the property's actual listing
    # price at creation time — deliberately NOT the same value as amount
    # (the customer's offer). See tracking doc "Models" for the "copy, don't
    # read live" rationale this mirrors from transaction_type.
    original_listing_amount = _listing_amount(prop)
    if original_listing_amount is None:
        raise NegotiationDomainError(422, "This property has no listing price to negotiate against")

    existing = (
        db.query(PropertyNegotiation)
        .filter(
            PropertyNegotiation.customer_user_id == customer_user.id,
            PropertyNegotiation.property_id == property_id,
            PropertyNegotiation.status.notin_(NEGOTIATION_TERMINAL_STATUSES),
        )
        .first()
    )
    if existing:
        raise NegotiationDomainError(409, "You already have an active negotiation for this property")

    # A viewing_id is never trusted at face value — it must genuinely belong
    # to this customer, this property, and be completed (see brief: "don't
    # trust an arbitrary id from the client").
    linked_viewing_id = None
    if viewing_id is not None:
        viewing = db.get(PropertyViewing, viewing_id)
        if (
            not viewing
            or viewing.customer_user_id != customer_user.id
            or viewing.property_id != property_id
            or viewing.status != "completed"
        ):
            raise NegotiationDomainError(
                422, "viewing_id must reference a completed viewing you attended for this property"
            )
        linked_viewing_id = viewing.id

    # Reuses property_viewing.py's exact lead-linking query — never
    # reimplemented, never auto-creates a Lead (see tracking doc "Lead
    # integration").
    lead_id = _find_linked_lead_id(db, customer_user, property_id)

    negotiation = PropertyNegotiation(
        property_id=property_id,
        customer_user_id=customer_user.id,
        mediator_id=prop.mediator_id,
        lead_id=lead_id,
        viewing_id=linked_viewing_id,
        transaction_type=prop.listing_type,
        status="submitted",
        current_offer_amount=amount,
        original_listing_amount=original_listing_amount,
    )
    db.add(negotiation)
    db.flush()  # assigns negotiation.id, without committing, so the first offer row + outbox event below are in the SAME transaction

    offer = NegotiationOffer(
        negotiation_id=negotiation.id,
        offered_by_user_id=customer_user.id,
        amount=amount,
        message=message,
        offer_type="customer_offer",
        status="pending",
    )
    db.add(offer)
    db.flush()

    record_event(
        db,
        event_type=EventType.NEGOTIATION_SUBMITTED,
        aggregate_type="property_negotiation",
        aggregate_id=negotiation.id,
        payload={
            "negotiation_id": negotiation.id,
            "property_id": property_id,
            "customer_user_id": customer_user.id,
            "mediator_id": prop.mediator_id,
            "amount": str(amount),
            "actor_user_id": customer_user.id,
        },
    )
    db.commit()
    db.refresh(negotiation)
    return negotiation


def _transition(negotiation: PropertyNegotiation, new_status: str) -> None:
    """Mirrors app/services/property_viewing.py's _transition exactly."""
    allowed = PROPERTY_NEGOTIATION_TRANSITIONS.get(negotiation.status, set())
    if new_status not in allowed:
        raise NegotiationDomainError(409, f"Cannot move a negotiation from '{negotiation.status}' to '{new_status}'")
    negotiation.status = new_status


def _latest_offer(db: Session, negotiation: PropertyNegotiation) -> NegotiationOffer | None:
    """The most recently placed NegotiationOffer row for this negotiation —
    what accept_offer()'s "only the latest valid counter" rule and
    submit_counter()'s supersede step both key off. Queried directly (not
    via negotiation.offers, which may be stale relative to a row this same
    request just flushed) ordered by created_at then id as a tiebreaker
    (rows created in the same transaction can share a server_default now()
    tick)."""
    return (
        db.query(NegotiationOffer)
        .filter(NegotiationOffer.negotiation_id == negotiation.id)
        .order_by(NegotiationOffer.created_at.desc(), NegotiationOffer.id.desc())
        .first()
    )


def submit_counter(
    db: Session,
    actor_user: User,
    negotiation: PropertyNegotiation,
    *,
    amount: Decimal,
    message: str | None,
    offer_type: str,
) -> PropertyNegotiation:
    """Backs BOTH the customer's "Counter Again" action
    (offer_type="customer_counter") and the mediator's "Counter Offer"
    action from Prompt 4 (offer_type="mediator_counter") — same transition,
    different offer_type/actor. Only valid from submitted/countered (enforced
    via _transition below). Marks the previous pending offer 'superseded',
    inserts the new pending offer row, and updates current_offer_amount."""
    if amount is None or amount <= 0:
        raise NegotiationDomainError(422, "amount must be greater than zero")

    _transition(negotiation, "countered")

    previous = _latest_offer(db, negotiation)
    if previous is not None and previous.status == "pending":
        previous.status = "superseded"

    offer = NegotiationOffer(
        negotiation_id=negotiation.id,
        offered_by_user_id=actor_user.id,
        amount=amount,
        message=message,
        offer_type=offer_type,
        status="pending",
    )
    db.add(offer)
    negotiation.current_offer_amount = amount
    db.flush()
    record_event(
        db,
        event_type=EventType.NEGOTIATION_COUNTERED,
        aggregate_type="property_negotiation",
        aggregate_id=negotiation.id,
        payload={
            "negotiation_id": negotiation.id,
            "property_id": negotiation.property_id,
            "customer_user_id": negotiation.customer_user_id,
            "mediator_id": negotiation.mediator_id,
            "offer_type": offer_type,
            "amount": str(amount),
            "actor_user_id": actor_user.id,
        },
    )
    db.commit()
    db.refresh(negotiation)
    return negotiation


def accept_offer(
    db: Session,
    actor_user: User,
    negotiation: PropertyNegotiation,
    *,
    actor_role: str,
) -> PropertyNegotiation:
    """actor_role: "customer" | "mediator" — carried in the outbox payload
    purely for notification rendering; ownership/authorization is the route
    layer's job. Enforces brief §11's "only the latest valid counter, by the
    OTHER party" rule explicitly: rejects when the latest NegotiationOffer
    isn't pending, or when it was placed by this same actor_user (a customer
    can't accept their own offer, a mediator can't accept their own
    counter) — checked against the actual acting user's id, not offer_type,
    so it holds even if a mediator's account has multiple users acting on
    its behalf."""
    latest = _latest_offer(db, negotiation)
    if latest is None or latest.status != "pending":
        raise NegotiationDomainError(409, "There is no pending offer to accept")
    if latest.offered_by_user_id == actor_user.id:
        raise NegotiationDomainError(409, "You cannot accept your own offer")

    _transition(negotiation, "accepted")
    latest.status = "accepted"
    negotiation.accepted_at = datetime.now(timezone.utc)
    db.flush()
    record_event(
        db,
        event_type=EventType.NEGOTIATION_ACCEPTED,
        aggregate_type="property_negotiation",
        aggregate_id=negotiation.id,
        payload={
            "negotiation_id": negotiation.id,
            "property_id": negotiation.property_id,
            "customer_user_id": negotiation.customer_user_id,
            "mediator_id": negotiation.mediator_id,
            "accepted_by": actor_role,
            "amount": str(latest.amount),
            "actor_user_id": actor_user.id,
        },
    )
    db.commit()
    db.refresh(negotiation)
    return negotiation


def withdraw_negotiation(
    db: Session,
    customer_user: User,
    negotiation: PropertyNegotiation,
    *,
    reason: str,
) -> PropertyNegotiation:
    """Customer-only — ownership check (negotiation.customer_user_id ==
    customer_user.id) is the route layer's job, mirroring
    cancel_viewing()'s convention. Allowed from submitted/countered (enforced
    via _transition below). No dedicated withdrawn_at column exists on
    PropertyNegotiation (only accepted_at/rejected_at/closed_at) —
    `updated_at`'s auto-onupdate timestamp is treated as sufficient for this
    feature-first build, same as every other plain status flip in this
    file."""
    _transition(negotiation, "withdrawn")
    negotiation.cancellation_reason = reason
    negotiation.cancelled_by = "customer"
    db.flush()
    record_event(
        db,
        event_type=EventType.NEGOTIATION_WITHDRAWN,
        aggregate_type="property_negotiation",
        aggregate_id=negotiation.id,
        payload={
            "negotiation_id": negotiation.id,
            "property_id": negotiation.property_id,
            "customer_user_id": negotiation.customer_user_id,
            "mediator_id": negotiation.mediator_id,
            "reason": reason,
            "actor_user_id": customer_user.id,
        },
    )
    db.commit()
    db.refresh(negotiation)
    return negotiation


def reject_negotiation(
    db: Session,
    mediator_user: User,
    negotiation: PropertyNegotiation,
    *,
    reason: str,
) -> PropertyNegotiation:
    """Mediator-only reject (Prompt 4) — ownership check
    (negotiation.mediator_id == mediator.id) is the route layer's job,
    mirroring withdraw_negotiation()'s convention exactly but on the
    "rejected" transition instead of "withdrawn", and cancelled_by=
    "mediator" instead of "customer". Allowed from submitted/countered
    (enforced via _transition below). Unlike withdraw_negotiation() (which
    has no dedicated withdrawn_at column), PropertyNegotiation DOES have a
    rejected_at column — set it explicitly here."""
    _transition(negotiation, "rejected")
    negotiation.cancellation_reason = reason
    negotiation.cancelled_by = "mediator"
    negotiation.rejected_at = datetime.now(timezone.utc)
    db.flush()
    record_event(
        db,
        event_type=EventType.NEGOTIATION_REJECTED,
        aggregate_type="property_negotiation",
        aggregate_id=negotiation.id,
        payload={
            "negotiation_id": negotiation.id,
            "property_id": negotiation.property_id,
            "customer_user_id": negotiation.customer_user_id,
            "mediator_id": negotiation.mediator_id,
            "reason": reason,
            "actor_user_id": mediator_user.id,
        },
    )
    db.commit()
    db.refresh(negotiation)
    return negotiation


def find_active_negotiation(db: Session, customer_user: User, property_id: int) -> PropertyNegotiation | None:
    """Backs GET /properties/{property_id}/negotiations/active — what the
    frontend's "Make an Offer" vs "View Negotiation" CTA decision calls."""
    return (
        db.query(PropertyNegotiation)
        .filter(
            PropertyNegotiation.customer_user_id == customer_user.id,
            PropertyNegotiation.property_id == property_id,
            PropertyNegotiation.status.notin_(NEGOTIATION_TERMINAL_STATUSES),
        )
        .order_by(PropertyNegotiation.updated_at.desc())
        .first()
    )


def to_negotiation_out(negotiation: PropertyNegotiation) -> dict:
    """Denormalizes property/mediator display fields onto the response dict,
    mirroring property_viewing.py's to_viewing_out() — avoids N+1 fetches on
    list/detail screens. `negotiation.property`/`negotiation.mediator` are
    the ORM relationships defined on PropertyNegotiation."""
    prop = negotiation.property
    mediator = negotiation.mediator
    return {
        "id": negotiation.id,
        "property_id": negotiation.property_id,
        "customer_user_id": negotiation.customer_user_id,
        "mediator_id": negotiation.mediator_id,
        "lead_id": negotiation.lead_id,
        "viewing_id": negotiation.viewing_id,
        "transaction_type": negotiation.transaction_type,
        "status": negotiation.status,
        "current_offer_amount": negotiation.current_offer_amount,
        "original_listing_amount": negotiation.original_listing_amount,
        "created_at": negotiation.created_at,
        "updated_at": negotiation.updated_at,
        "accepted_at": negotiation.accepted_at,
        "rejected_at": negotiation.rejected_at,
        "closed_at": negotiation.closed_at,
        "cancellation_reason": negotiation.cancellation_reason,
        "cancelled_by": negotiation.cancelled_by,
        "property_title": prop.title if prop else None,
        "property_image_url": prop.image_url if prop else None,
        # This codebase treats "district" and Property.area as the same
        # concept (e.g. app/services/home_finder_scoring.py matches
        # HomeFinderCriteria.districts against prop.area; Property has no
        # separate district column) — both denormalized fields below echo
        # the same value rather than fabricating a second one.
        "property_area": prop.area if prop else None,
        "property_district": prop.area if prop else None,
        "property_listing_amount": _listing_amount(prop) if prop else None,
        "mediator_agent_name": mediator.agency_name if mediator else None,
    }


def _negotiation_signal_dict(db: Session, negotiation: PropertyNegotiation) -> dict:
    """Computes the same negotiation_signal dict to_negotiation_detail_out()
    embeds (Prompt 12 polish pass) — shared by to_negotiation_list_out()/
    to_partner_negotiation_list_out() below so the My Negotiations / partner
    inbox LIST cards can render the same strength badge the detail screens
    already do, using the one real backend classification rather than each
    surface re-deriving its own approximation."""
    from app.services.negotiation_signals import compute_negotiation_signal

    price_intel, _insight = price_intelligence_and_insight(db, negotiation.property)
    signal = compute_negotiation_signal(negotiation.current_offer_amount, price_intel)
    return {"signal": signal.signal, "label": signal.label}


def to_negotiation_list_out(db: Session, negotiation: PropertyNegotiation) -> dict:
    """List-endpoint variant of to_negotiation_out() (Prompt 12) — adds
    negotiation_signal on top of the same denormalized fields. Kept separate
    from to_negotiation_out() (used by the create/counter/accept/withdraw
    action routes, whose responses never render a badge — callers always
    re-fetch GET /negotiations/{id} afterward for the full detail shape
    anyway, see negotiations.py) so those hot paths don't pay for an extra
    price-intelligence computation they don't use."""
    base = to_negotiation_out(negotiation)
    base["negotiation_signal"] = _negotiation_signal_dict(db, negotiation)
    return base


def to_partner_negotiation_list_out(db: Session, negotiation: PropertyNegotiation) -> dict:
    """Mediator-facing variant of to_negotiation_list_out() — mirrors
    to_partner_negotiation_out()'s "wrap with customer contact fields"
    pattern."""
    return _with_customer_contact(to_negotiation_list_out(db, negotiation), negotiation)


def price_intelligence_and_insight(db: Session, prop: Property | None):
    """Shared helper (Prompt 5): computes the same
    (price_intelligence, negotiation_insight) pair `to_negotiation_detail_out`
    already computed fresh on every call, plus the new
    `POST /negotiations/{id}/ai-guidance` route (Prompt 5) — both need the
    raw `price_intelligence` object (not just the `NegotiationInsight`
    echo) to ground `negotiation_signals.compute_negotiation_signal()` and
    the AI guidance prompt. Returns `(price_intelligence | None,
    NegotiationInsight | None)` — `None, None` when there's no property to
    compute against."""
    from app.services import negotiation_intelligence, price_intelligence

    if prop is None:
        return None, None
    price_intel = (
        price_intelligence.buy_price_intelligence(db, prop)
        if prop.listing_type == "sale"
        else price_intelligence.rent_price_intelligence(db, prop)
    )
    insight = negotiation_intelligence.negotiation_insight(prop, price_intel)
    return price_intel, insight


def to_negotiation_detail_out(db: Session, negotiation: PropertyNegotiation, *, language: str = "en") -> dict:
    """Adds the full offer history + a freshly computed NegotiationInsight.
    Per the tracking doc's "Property Intelligence integration" decision,
    this NEVER persists/reads a stale copy of market data on the negotiation
    row — negotiation_insight() is called fresh from the same
    price_intelligence plumbing GET /properties/{id}/intelligence already
    uses.

    **Added in Prompt 5:** also embeds `summary_text` — the deterministic
    "myMakan Summary" (`app.services.negotiation_ai.generate_summary()`, NO
    AI call, see that module's docstring for the AI-vs-deterministic split)
    — directly onto the response, so the frontend never needs a second round
    trip just to show it. `language` defaults to "en"; the route layer may
    accept a `?language=` query param to request Arabic instead."""
    from app.services import negotiation_ai
    from app.services.negotiation_signals import compute_negotiation_signal

    base = to_negotiation_out(negotiation)
    offers = list(negotiation.offers)
    base["offers"] = offers

    prop = negotiation.property
    price_intel, insight = price_intelligence_and_insight(db, prop)

    base["negotiation_insight"] = (
        {
            "asking_price": insight.asking_price,
            "market_midpoint": insight.market_midpoint,
            "discussion_range_low": insight.discussion_range_low,
            "discussion_range_high": insight.discussion_range_high,
            "approach": insight.approach,
        }
        if insight is not None
        else None
    )
    # Prompt 8 follow-up: expose the same deterministic strength
    # classification negotiation_ai.py already grounds itself in, so the
    # frontend badge (web/mobile/partner) reuses one backend source of truth
    # instead of re-deriving an approximation per surface.
    # compute_negotiation_signal() already handles price_intel is None (and
    # sufficient_data is False) by returning "limited_comparable_data" —
    # never call-site-guarded, always populated.
    signal = compute_negotiation_signal(negotiation.current_offer_amount, price_intel)
    base["negotiation_signal"] = {"signal": signal.signal, "label": signal.label}
    base["summary_text"] = negotiation_ai.generate_summary(negotiation, offers, price_intel, insight, language)
    # Prompt 6: only non-None once the negotiation is actually accepted —
    # build_agreement_summary() itself also guards on status, this
    # early-out just avoids the (cheap) call otherwise.
    base["agreement_summary"] = (
        build_agreement_summary(negotiation, offers, prop) if negotiation.status == "accepted" else None
    )
    return base


def build_agreement_summary(
    negotiation: PropertyNegotiation, offers: list[NegotiationOffer], prop: Property | None
) -> dict | None:
    """Agreement Summary (brief §22, Prompt 6) — deterministic, no AI call.
    Added directly here (rather than a new `negotiation_agreement.py`) since
    it's a small pure function reusing data this module already loads for
    every other negotiation response — see tracking doc "Agreement Summary"
    for the "sibling function vs. new file" call.

    Only meaningful once a negotiation has actually been accepted — returns
    `None` for every other status, so `to_negotiation_detail_out()` below
    can call this unconditionally without an extra branch at every call
    site (though it currently still gates on `status == "accepted"` too,
    for clarity at the call site).

    `final_agreed_amount` is read off the offer row actually marked
    `status == "accepted"` in `offers` (set by `accept_offer()` above) —
    falling back to `negotiation.current_offer_amount` only defensively, in
    case that row can't be found (`accept_offer()` always sets it in the
    same transaction that flips `negotiation.status` to `"accepted"`, so
    this fallback should never actually trigger in practice).
    `negotiation_reference` is a display-only id (`NEG-000123`) — no new
    persisted column, derived from the negotiation's own primary key."""
    if negotiation.status != "accepted":
        return None

    accepted_offer = next((o for o in offers if o.status == "accepted"), None)
    final_amount = accepted_offer.amount if accepted_offer is not None else negotiation.current_offer_amount

    customer = negotiation.customer
    mediator = negotiation.mediator

    return {
        "property_id": negotiation.property_id,
        "property_title": prop.title if prop else None,
        "customer_name": customer.full_name if customer else None,
        "mediator_agent_name": mediator.agency_name if mediator else None,
        "transaction_type": negotiation.transaction_type,
        "original_listing_amount": negotiation.original_listing_amount,
        "final_agreed_amount": final_amount,
        "agreed_at": negotiation.accepted_at,
        "negotiation_reference": f"NEG-{negotiation.id:06d}",
    }


def _with_customer_contact(base: dict, negotiation: PropertyNegotiation) -> dict:
    """Adds the mediator-facing customer_name/customer_phone/customer_email
    fields (Prompt 4) — matches, not exceeds, the existing privacy bar an
    assigned mediator already gets for their own lead via LeadSummaryOut/
    LeadDetailOut (see app/schemas/lead.py). Shared by
    to_partner_negotiation_out() and to_partner_negotiation_detail_out()
    below."""
    customer = negotiation.customer
    base.update(
        {
            "customer_name": customer.full_name if customer else None,
            "customer_phone": customer.phone if customer else None,
            "customer_email": customer.email if customer else None,
        }
    )
    return base


def to_partner_negotiation_out(negotiation: PropertyNegotiation) -> dict:
    """Mediator-facing variant of to_negotiation_out() (Prompt 4) — adds
    denormalized customer contact fields. Mirrors
    property_viewing.py's to_partner_viewing_out() exactly."""
    return _with_customer_contact(to_negotiation_out(negotiation), negotiation)


def to_partner_negotiation_detail_out(db: Session, negotiation: PropertyNegotiation) -> dict:
    """Mediator-facing variant of to_negotiation_detail_out() (Prompt 4) —
    same full offer history + freshly computed negotiation_insight the
    customer's GET /negotiations/{id} returns, plus the denormalized customer
    contact fields above. Neither the offer history nor the insight carries
    any additional customer PII, so this stays within the same privacy bar
    as to_partner_negotiation_out()."""
    return _with_customer_contact(to_negotiation_detail_out(db, negotiation), negotiation)
