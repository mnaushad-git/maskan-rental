from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.property_transaction import (
    PROPERTY_TRANSACTION_STATUSES,
    TRANSACTION_DOCUMENT_STATUSES,
)


class ChecklistStepOut(BaseModel):
    """Mirrors `app.services.transaction_progress.ChecklistStep` — the
    deterministic engine's own dataclass, never recomputed here."""

    key: str
    label: str
    status: str
    detail: str | None = None


class NextBestActionOut(BaseModel):
    key: str
    message: str


class CustomerInformationUpdate(BaseModel):
    """Request body for PATCH /transactions/{id}/customer-information.
    Deliberately edits the underlying `User.full_name`/`User.phone` fields
    (not a transaction-specific table — see
    docs/implementation/mymakan-transaction-workspace.md's "Checklist
    methodology": Prompt 2 already decided there are no new DB columns for
    this content, since `User` already carries it). Both optional so a
    partial update (only filling in the one missing field) is supported;
    `None` means "leave unchanged", never "clear this field"."""

    full_name: str | None = None
    phone: str | None = None


class TransactionCancelRequest(BaseModel):
    """Reason values mirror `NegotiationWithdrawRequest`'s own convention
    (brief §23 examples) — persisted as free text, no enum validation on the
    backend."""

    reason: str


class TransactionAssistantRequest(BaseModel):
    """Request body for POST .../ai-assistant (Prompt 6). `quick_action` must
    be one of the caller's own role vocabulary
    (`app.services.transaction_ai.CUSTOMER_QUICK_ACTIONS` /
    `MEDIATOR_QUICK_ACTIONS`) — validated in the service layer (422 via
    `InvalidQuickAction`), not here, so a direct service caller gets the
    same guarantee a route caller does."""

    quick_action: str
    language: str = "en"

    @field_validator("language")
    @classmethod
    def _known_language(cls, v: str) -> str:
        if v not in ("en", "ar"):
            raise ValueError("language must be 'en' or 'ar'")
        return v


class TransactionAssistantOut(BaseModel):
    quick_action: str
    reply: str
    generated_by: str  # "ai" | "fallback"


class TransactionDocumentReviewRequest(BaseModel):
    """Request body for POST .../documents/{document_id}/request-update
    (Prompt 5). Unlike `TransactionCancelRequest`/`NegotiationWithdrawRequest`
    (free text, no validation), the brief explicitly requires "a short reason
    string" here, so this one rejects an empty/whitespace-only value."""

    reason: str

    @field_validator("reason")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("reason is required")
        return v


class TransactionDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    transaction_id: int
    document_type: str
    label: str
    required: bool
    status: str
    file_reference: str | None = None
    uploaded_at: datetime | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in TRANSACTION_DOCUMENT_STATUSES:
            raise ValueError(f"status must be one of {TRANSACTION_DOCUMENT_STATUSES}")
        return v


class CustomerInfoOut(BaseModel):
    """Customer identity/contact snapshot for the transaction's "My
    Information" step (Prompt 3) — reuses existing `User` fields verbatim;
    no new DB columns needed for the content itself. `email` is required
    (`User.email` is NOT NULL); `full_name`/`phone` are optional, matching
    User's own nullable columns — a customer with an incomplete profile
    genuinely has nothing to reuse there yet, so this is never fabricated."""

    email: str
    full_name: str | None = None
    phone: str | None = None


class PropertyTransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reference: str
    property_id: int
    transaction_type: str
    customer_user_id: int
    mediator_id: int | None
    lead_id: int | None
    negotiation_id: int
    viewing_id: int | None

    # Immutable through normal transaction editing (brief's global
    # constraint) — any change requires a new negotiation/amendment, never a
    # direct field edit on this schema.
    agreed_amount: Decimal
    currency: str

    status: str
    progress_percentage: int

    customer_info_confirmed_at: datetime | None = None
    # Mediator-side counterpart (Prompt 5) — see
    # PropertyTransaction.mediator_info_confirmed_at's docstring.
    mediator_info_confirmed_at: datetime | None = None

    created_at: datetime
    updated_at: datetime
    ready_at: datetime | None = None
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None

    cancellation_reason: str | None = None
    cancelled_by: str | None = None

    # Denormalized display fields (mirrors property_negotiation.to_negotiation_out's
    # own "avoid N+1 fetches on list/detail screens" convention) + the
    # deterministic engine's own live-computed fields (Prompt 3's
    # `compute_transaction_progress()` — never recomputed independently
    # here, just packaged onto the response).
    property_title: str | None = None
    property_image_url: str | None = None
    property_area: str | None = None
    mediator_agent_name: str | None = None
    next_best_action: NextBestActionOut
    readiness_label: str

    @field_validator("status")
    @classmethod
    def _known_status(cls, v: str) -> str:
        if v not in PROPERTY_TRANSACTION_STATUSES:
            raise ValueError(f"status must be one of {PROPERTY_TRANSACTION_STATUSES}")
        return v


class TermsSnapshotOut(BaseModel):
    """The transaction's "Agreed Commercial Terms" — reused verbatim from
    `property_negotiation.build_agreement_summary()` rather than re-derived
    a second way (see tracking doc's Prompt 1 inspection notes, bullet 1).
    `None` only if the underlying negotiation somehow isn't `accepted`
    (should never happen for a transaction that exists at all, since it's
    only ever auto-created inside `accept_offer()`)."""

    property_id: int
    property_title: str | None = None
    customer_name: str | None = None
    mediator_agent_name: str | None = None
    transaction_type: str
    original_listing_amount: Decimal | None = None
    final_agreed_amount: Decimal
    agreed_at: datetime | None = None
    negotiation_reference: str


class PropertyTransactionDetailOut(PropertyTransactionOut):
    """Adds the full checklist, document set, customer info snapshot, and
    terms snapshot (Prompt 4)."""

    checklist: list[ChecklistStepOut]
    documents: list[TransactionDocumentOut] = []
    customer_info: CustomerInfoOut
    terms_snapshot: TermsSnapshotOut | None = None


class PartnerTransactionCustomerOut(BaseModel):
    """Mediator-facing customer summary (Prompt 5) — deliberately narrower
    than `CustomerInfoOut` (no email/phone): document review/confirm-
    information only needs to know who the transaction is for, not how to
    contact them (that's the existing lead/negotiation messaging channel's
    job, not this endpoint's)."""

    full_name: str | None = None


class PartnerPropertyTransactionOut(PropertyTransactionOut):
    """Mediator-facing summary for GET /partner/transactions (Prompt 5) —
    adds only the customer's display name on top of every field the base
    transaction response already carries."""

    customer_name: str | None = None


class PartnerPropertyTransactionDetailOut(PartnerPropertyTransactionOut):
    """GET /partner/transactions/{id} (Prompt 5) — same checklist/documents/
    terms_snapshot shape as the customer's own detail response, but with the
    restricted `customer` snapshot above instead of the customer's full
    `customer_info`."""

    checklist: list[ChecklistStepOut]
    documents: list[TransactionDocumentOut] = []
    customer: PartnerTransactionCustomerOut
    terms_snapshot: TermsSnapshotOut | None = None


class AdminTransactionTimelineEntryOut(BaseModel):
    """One `OutboxEvent` row for this transaction (Prompt 7) — there is no
    separate event-log/history table for `PropertyTransaction` (see that
    model's own docstring), so the timeline is read directly off the same
    outbox rows every notification in this feature is already built from,
    never a second history mechanism."""

    event_type: str
    created_at: datetime
    payload: dict


class AdminTransactionListItemOut(PropertyTransactionOut):
    """GET /admin/transactions (Prompt 7) — same base fields as the
    customer's own `PropertyTransactionOut` (reference/type/property/
    mediator/amount/status/progress/created/last-activity) plus the
    customer's display name/email, broader than the partner's name-only
    privacy bar since this is an internal admin-only surface."""

    customer_name: str | None = None
    customer_email: str | None = None


class AdminTransactionDetailOut(AdminTransactionListItemOut):
    """GET /admin/transactions/{id} (Prompt 7) — checklist/documents/
    customer_info/terms_snapshot reused verbatim from
    `PropertyTransactionDetailOut` (never re-derived a second way); the
    brief's "negotiation reference" requirement is already covered by
    `terms_snapshot.negotiation_reference` (Prompt 4's own reuse of
    `property_negotiation.build_agreement_summary()`), so no duplicate field
    is added here. Read-only by design — no admin mutation endpoints exist
    on this router at all."""

    checklist: list[ChecklistStepOut]
    documents: list[TransactionDocumentOut] = []
    customer_info: CustomerInfoOut
    terms_snapshot: TermsSnapshotOut | None = None
    timeline: list[AdminTransactionTimelineEntryOut] = []
