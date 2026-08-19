from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.property_negotiation import (
    NEGOTIATION_OFFER_STATUSES,
    NEGOTIATION_OFFER_TYPES,
    PROPERTY_NEGOTIATION_STATUSES,
)


class NegotiationOfferCreate(BaseModel):
    amount: Decimal
    message: str | None = None


class NegotiationWithdrawRequest(BaseModel):
    """Request body for POST /negotiations/{id}/withdraw (Prompt 3). Reason
    values from brief §11 — persisted as free text, no enum column on the
    backend (frontend is expected to send one of "Changed mind" / "Found
    another property" / "Budget changed" / "Other", but the backend doesn't
    validate against that closed list — see tracking doc "Status flow")."""

    reason: str


class NegotiationRejectRequest(BaseModel):
    """Request body for POST /partner/negotiations/{id}/reject (Prompt 4).
    Mediator rejection reason values from brief §11 — "Offer too low" /
    "Property no longer available" / "Owner declined" / "Other". Mirrors
    NegotiationWithdrawRequest exactly: persisted as free text, no enum
    validation on the backend (same "backend accepts any string" decision
    already made for the customer-side withdraw reason — see tracking doc
    "Status flow")."""

    reason: str


class NegotiationAIGuidanceRequest(BaseModel):
    """Request body for POST /negotiations/{id}/ai-guidance (Prompt 5) —
    "Ask myMakan". `question` is optional free-text (brief §5's "is my offer
    reasonable / how far below asking / what should I say" question list,
    without needing 6 separate endpoints) — omit it for a general read of
    the current position instead."""

    question: str | None = None
    language: str = "en"

    @field_validator("language")
    @classmethod
    def _known_language(cls, v: str) -> str:
        if v not in ("en", "ar"):
            raise ValueError("language must be 'en' or 'ar'")
        return v


class NegotiationAIGuidanceResponse(BaseModel):
    guidance: str
    generated_by: str  # "ai" | "fallback"


class PropertyNegotiationCreate(BaseModel):
    """Request body for POST /properties/{property_id}/negotiations
    (Prompt 2). `property_id` itself is a path param, not a body field.
    `amount > 0` is validated in the service layer (app/services/
    property_negotiation.py::create_negotiation), not here, so a direct
    service caller gets the same guarantee a route caller does."""

    amount: Decimal
    message: str | None = None
    # Only trusted after the service layer verifies it belongs to this
    # customer + property and is `completed` — see create_negotiation's
    # docstring. Never trust an arbitrary id from the client at face value.
    viewing_id: int | None = None


class NegotiationOfferOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    negotiation_id: int
    offered_by_user_id: int | None
    amount: Decimal
    message: str | None
    offer_type: str
    status: str
    expires_at: datetime | None
    created_at: datetime

    @field_validator("offer_type")
    @classmethod
    def _known_offer_type(cls, v: str) -> str:
        if v not in NEGOTIATION_OFFER_TYPES:
            raise ValueError(f"offer_type must be one of {NEGOTIATION_OFFER_TYPES}")
        return v

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in NEGOTIATION_OFFER_STATUSES:
            raise ValueError(f"status must be one of {NEGOTIATION_OFFER_STATUSES}")
        return v


class NegotiationSignalOut(BaseModel):
    """Read-only echo of app.services.negotiation_signals.NegotiationSignal
    (Prompt 5) — the deterministic negotiation-strength classification that
    grounds "Ask myMakan" guidance. Added here in Prompt 8's follow-up so the
    strength badge Prompt 8/10/11/12's UIs render is backed by the single
    real backend classification (imported thresholds shared with Price
    Intelligence) rather than each surface re-deriving its own approximation
    client-side. **Moved onto the base PropertyNegotiationOut in Prompt 12**
    (was previously declared only on the *Detail variants) so the My
    Negotiations / partner inbox LIST cards can render the same badge the
    detail screens do, not just plain numbers — see
    property_negotiation.to_negotiation_list_out()."""

    signal: str
    label: str


class PropertyNegotiationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    property_id: int
    customer_user_id: int
    mediator_id: int | None
    lead_id: int | None
    viewing_id: int | None

    transaction_type: str
    status: str

    current_offer_amount: Decimal
    original_listing_amount: Decimal

    created_at: datetime
    updated_at: datetime
    accepted_at: datetime | None
    rejected_at: datetime | None
    closed_at: datetime | None

    # Added in Prompt 3 — see PropertyNegotiation model's docstring for why
    # these were missed in Prompt 1.
    cancellation_reason: str | None = None
    cancelled_by: str | None = None

    # Denormalized so list/detail screens don't need N+1 fetches — mirrors
    # how PropertyViewingOut/PropertyOut denormalize property/mediator
    # fields (see app/schemas/property_viewing.py, app/schemas/property.py).
    # Populated by the route/service layer from the loaded
    # Property/Mediator relationships, not by pydantic alone.
    property_title: str | None = None
    property_image_url: str | None = None
    property_area: str | None = None
    property_district: str | None = None
    property_listing_amount: Decimal | None = None
    mediator_agent_name: str | None = None

    # Added in Prompt 12 — the same deterministic negotiation-strength
    # classification the detail screens already show, now also populated on
    # list/create/action responses via to_negotiation_list_out() /
    # to_partner_negotiation_list_out() (list endpoints only — see those
    # functions' docstrings for why create/action responses don't bother,
    # since their callers always re-fetch the detail endpoint anyway).
    negotiation_signal: NegotiationSignalOut | None = None

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in PROPERTY_NEGOTIATION_STATUSES:
            raise ValueError(f"status must be one of {PROPERTY_NEGOTIATION_STATUSES}")
        return v


class NegotiationInsightOut(BaseModel):
    """Read-only echo of app.services.negotiation_intelligence.NegotiationInsight
    — reused, not duplicated (see tracking doc "Property Intelligence
    integration"). Grounds the negotiation UI in the same asking price /
    market midpoint / discussion range / approach text already shown on
    Property Detail's NegotiationInsightCard."""

    asking_price: float
    market_midpoint: float
    discussion_range_low: float
    discussion_range_high: float
    approach: str


class AgreementSummaryOut(BaseModel):
    """Agreement Summary (brief §22, Prompt 6) — populated ONLY on
    `PropertyNegotiationDetailOut` once `negotiation.status == "accepted"`.
    Deterministic, built by
    `app.services.property_negotiation.build_agreement_summary()` entirely
    from data already on the negotiation/property/offer rows — no new
    persisted columns, no AI call. `negotiation_reference` is a
    display-only id (`NEG-000123`) derived from the negotiation's own
    primary key, not a stored column."""

    property_id: int
    property_title: str | None = None
    customer_name: str | None = None
    mediator_agent_name: str | None = None
    transaction_type: str
    original_listing_amount: Decimal
    final_agreed_amount: Decimal
    agreed_at: datetime | None = None
    negotiation_reference: str


class PropertyNegotiationDetailOut(PropertyNegotiationOut):
    # Full ordered offer history — the timeline itself (brief §12), not a
    # separate timeline-shape schema; a later prompt's UI computes any
    # display timeline client-side from this list + the status timestamps
    # above, same decision the viewings feature made for its own timeline.
    offers: list[NegotiationOfferOut] = []

    # None when Price Intelligence doesn't have sufficient_data for this
    # property (see negotiation_intelligence.negotiation_insight) — never
    # fabricated.
    negotiation_insight: NegotiationInsightOut | None = None
    # negotiation_signal itself is inherited from PropertyNegotiationOut (Prompt
    # 12 moved it onto the base) — always populated here specifically, though,
    # since to_negotiation_detail_out() computes it fresh on every call
    # (falls back to "limited_comparable_data" when Price Intelligence lacks
    # sufficient_data, never fabricated).

    # Added in Prompt 5 — the deterministic "myMakan Summary"
    # (app.services.negotiation_ai.generate_summary(), NO AI call). Embedded
    # directly here (rather than a separate endpoint) so it renders on every
    # negotiation detail view with no extra round trip. Always populated
    # (never None) — it's built from the offer history alone, which always
    # has at least one row by the time a PropertyNegotiation exists.
    summary_text: str = ""

    # Added in Prompt 6 — the deterministic Agreement Summary (brief §22).
    # Only non-null when status == "accepted"; None for every other status
    # (never fabricated ahead of an actual acceptance). See
    # AgreementSummaryOut's docstring.
    agreement_summary: AgreementSummaryOut | None = None


class PartnerNegotiationOut(PropertyNegotiationOut):
    """Mediator-facing negotiation summary (Prompt 4) — adds denormalized
    customer contact fields. Matches (does not exceed) the existing privacy
    bar an assigned mediator already gets for their own lead via
    LeadSummaryOut/LeadDetailOut (backend/app/schemas/lead.py), which expose
    the customer's full name/phone/email directly — ownership
    (negotiation.mediator_id == the requesting mediator's own id) is the gate
    here, same as lead assignment gates lead visibility there. Mirrors
    PartnerPropertyViewingOut (app/schemas/property_viewing.py) exactly."""

    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None


class PartnerNegotiationDetailOut(PartnerNegotiationOut):
    """GET /partner/negotiations/{id} — adds the full offer history + a
    freshly computed negotiation_insight on top of the customer contact
    fields above, mirroring PropertyNegotiationDetailOut's shape for the
    customer side. Neither offers nor negotiation_insight carries any
    additional customer PII beyond what PartnerNegotiationOut already
    exposes, so this stays within the same privacy bar."""

    offers: list[NegotiationOfferOut] = []
    negotiation_insight: NegotiationInsightOut | None = None
    # negotiation_signal is inherited from PropertyNegotiationOut (see above).
