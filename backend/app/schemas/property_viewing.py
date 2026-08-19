from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.property_viewing import (
    CUSTOMER_CANCEL_REASONS,
    MEDIATOR_CANCEL_REASONS,
    PROPERTY_VIEWING_STATUSES,
    VIEWING_FEEDBACK_REASONS,
    VIEWING_INTEREST_LEVELS,
)


class PropertyViewingCreate(BaseModel):
    property_id: int
    requested_start_at: datetime
    requested_end_at: datetime
    timezone: str = "Asia/Riyadh"
    customer_note: str | None = None


class PropertyViewingCancelRequest(BaseModel):
    reason: str
    note: str | None = None

    @field_validator("reason")
    @classmethod
    def _known_reason(cls, v: str) -> str:
        # Mediator-side cancel (Prompt 4's partner_viewings.py) validates
        # against MEDIATOR_CANCEL_REASONS separately — this schema backs the
        # customer-facing POST /viewings/{id}/cancel only.
        if v not in CUSTOMER_CANCEL_REASONS:
            raise ValueError(f"reason must be one of {CUSTOMER_CANCEL_REASONS}")
        return v


class PropertyViewingProposeTimeRequest(BaseModel):
    start_at: datetime
    end_at: datetime
    note: str | None = None


class PropertyViewingMediatorCancelRequest(BaseModel):
    reason: str
    note: str | None = None

    @field_validator("reason")
    @classmethod
    def _known_reason(cls, v: str) -> str:
        if v not in MEDIATOR_CANCEL_REASONS:
            raise ValueError(f"reason must be one of {MEDIATOR_CANCEL_REASONS}")
        return v


class PropertyViewingConfirmRequest(BaseModel):
    mediator_note: str | None = None


class PropertyViewingNoShowRequest(BaseModel):
    who: str

    @field_validator("who")
    @classmethod
    def _known_who(cls, v: str) -> str:
        if v not in ("customer", "mediator"):
            raise ValueError("who must be 'customer' or 'mediator'")
        return v


class PropertyViewingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    property_id: int
    customer_user_id: int
    mediator_id: int | None
    lead_id: int | None

    requested_start_at: datetime
    requested_end_at: datetime
    confirmed_start_at: datetime | None
    confirmed_end_at: datetime | None
    timezone: str

    status: str

    customer_note: str | None
    mediator_note: str | None
    cancellation_reason: str | None
    cancelled_by: str | None

    proposed_start_at: datetime | None
    proposed_end_at: datetime | None
    proposed_by: str | None

    interest_level: str | None
    feedback_reason: str | None
    feedback_note: str | None

    created_at: datetime
    updated_at: datetime
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    completed_at: datetime | None

    # Denormalized so list/detail screens don't need N+1 fetches — mirrors
    # how PropertyOut denormalizes mediator fields (see
    # app/schemas/property.py). Populated by the route/service layer from
    # the loaded Property/Mediator relationships, not by pydantic alone.
    property_title: str | None = None
    property_image_url: str | None = None
    property_area: str | None = None
    property_city: str | None = None
    mediator_agent_name: str | None = None

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in PROPERTY_VIEWING_STATUSES:
            raise ValueError(f"status must be one of {PROPERTY_VIEWING_STATUSES}")
        return v


class PartnerPropertyViewingOut(PropertyViewingOut):
    """Mediator-facing viewing detail — adds denormalized customer contact
    fields. Matches (does not exceed) the existing privacy bar an assigned
    mediator already gets for their own lead via LeadSummaryOut/
    LeadDetailOut (backend/app/schemas/lead.py), which expose the customer's
    full name/phone/email directly — ownership (mediator_id == the
    requesting mediator's own id) is the gate here, same as lead assignment
    gates lead visibility there."""

    customer_name: str | None = None
    customer_phone: str | None = None
    customer_email: str | None = None


# ── AI Viewing Checklist (Prompt 5) ─────────────────────────────────────────

class ChecklistItemOut(BaseModel):
    id: str
    text: str
    why_it_matters: str | None = None


class ChecklistSectionOut(BaseModel):
    key: str
    title: str
    items: list[ChecklistItemOut] = []


class ViewingChecklistOut(BaseModel):
    sections: list[ChecklistSectionOut] = []
    visit_plan_summary: str | None = None
    generated_by: str = "deterministic"
    checked: dict[str, bool] = {}


class PrivateNoteOut(BaseModel):
    text: str
    created_at: str


class PropertyViewingChecklistPatch(BaseModel):
    checked: dict[str, bool] | None = None
    note: str | None = None


class PropertyViewingFeedbackRequest(BaseModel):
    interest_level: str
    note: str | None = None
    reason: str | None = None

    @field_validator("interest_level")
    @classmethod
    def _known_interest_level(cls, v: str) -> str:
        if v not in VIEWING_INTEREST_LEVELS:
            raise ValueError(f"interest_level must be one of {VIEWING_INTEREST_LEVELS}")
        return v

    @field_validator("reason")
    @classmethod
    def _known_reason(cls, v: str | None) -> str | None:
        if v is not None and v not in VIEWING_FEEDBACK_REASONS:
            raise ValueError(f"reason must be one of {VIEWING_FEEDBACK_REASONS}")
        return v


class ViewingNextStepsOut(BaseModel):
    visit_summary: str
    next_steps: list[str]
    generated_by: str


class PropertyViewingDetailOut(PropertyViewingOut):
    """Customer-facing detail view — GET /viewings/{id} and
    PATCH /viewings/{id}/checklist both return this shape. NEVER used for
    the mediator-facing PartnerPropertyViewingOut — private_notes are
    customer-only (brief §15); PartnerPropertyViewingOut extends
    PropertyViewingOut directly, not this class, so a mediator can never
    receive a customer's private notes."""

    checklist: ViewingChecklistOut | None = None
    private_notes: list[PrivateNoteOut] = []
