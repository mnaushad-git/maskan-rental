"""Rental/Buy Transaction Workspace — see
docs/implementation/mymakan-transaction-workspace.md.

A `PropertyTransaction` is the step between "offer agreed" and an eventual
(out-of-scope) Ejar/contract/payment process: it is auto-created, exactly
once, the moment a `PropertyNegotiation.status` transitions to `accepted`
(see `app/services/property_negotiation.py::accept_offer()`, which calls
`app/services/property_transaction.py::create_transaction_for_negotiation()`
inline, in the SAME database transaction — so the negotiation's `accepted`
status and the new `PropertyTransaction` row land together or not at all).
The unique constraint on `negotiation_id` below is the real duplicate-
prevention backstop even under a concurrent-request race (two requests
racing to accept the same negotiation can both pass the application-level
"only accept once" check before either commits; whichever commits second
gets an IntegrityError and its whole transaction — including the negotiation
status flip — rolls back, matching the "both or neither" guarantee above).

Deliberately a single flat row per transaction (mirrors `PropertyNegotiation`/
`PropertyViewing`'s convention) plus a child `TransactionDocument` row per
required/optional document — no separate event-log/history table.

Status is a plain string column (mirrors `PropertyNegotiation.status`'s
convention, not a DB enum type) so new statuses/transitions stay a
Python-only change. The actual checklist/progress/Next-Best-Action
computation that decides WHEN a transaction should move between these
statuses is Prompt 3's centralized deterministic module — this file only
defines the allowed shape of that state machine, mirroring
`PROPERTY_NEGOTIATION_TRANSITIONS`'s exact pattern.
"""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Phase 1 (Rent + Buy) only — no Ejar, Nafath, title deed, digital
# signatures, payment gateway, escrow, mortgage/financing (see tracking
# doc's "Scope summary"). "cancelled" is reachable from any non-terminal
# status (see PROPERTY_TRANSACTION_TRANSITIONS below); "completed" is the
# other terminal status.
PROPERTY_TRANSACTION_STATUSES = (
    "initiated",
    "information_required",
    "documents_required",
    "under_review",
    "ready_for_next_step",
    "external_process_pending",
    "completed",
    "cancelled",
)

# Explicit status-transition lookup — plain {current_status:
# {allowed_next_statuses}} dict, mirroring PROPERTY_NEGOTIATION_TRANSITIONS's
# shape exactly. Prompt 3's deterministic checklist/progress engine is the
# only thing that decides which of these transitions actually happens on any
# given recompute; this dict is the guardrail both that engine and the
# cancel action (Prompt 4/5) validate against. "cancelled" is reachable from
# every non-terminal status (a customer/mediator/admin can cancel at any
# point before completion, mirroring PropertyNegotiation/PropertyViewing's
# own cancel-from-active-states convention). Back-and-forth between
# information_required/documents_required/under_review is allowed because a
# mediator's "request update" on a document or missing info can legitimately
# move a transaction backwards before it's ready to move forward again.
PROPERTY_TRANSACTION_TRANSITIONS: dict[str, set[str]] = {
    "initiated": {"information_required", "documents_required", "under_review", "cancelled"},
    "information_required": {"documents_required", "under_review", "cancelled"},
    "documents_required": {"information_required", "under_review", "cancelled"},
    "under_review": {"information_required", "documents_required", "ready_for_next_step", "cancelled"},
    "ready_for_next_step": {"external_process_pending", "completed", "cancelled"},
    "external_process_pending": {"completed", "cancelled"},
    # Terminal statuses (completed/cancelled) have no outgoing transitions —
    # omitted from this dict, so a lookup for them is always an empty set
    # via .get(status, set()).
}

# No multi-currency support exists anywhere in this codebase (confirmed by
# Prompt 1's inspection — no currency column on Property/PropertyNegotiation
# either) — every transaction defaults to this fixed constant rather than
# reading a field that doesn't exist.
DEFAULT_CURRENCY = "SAR"

# TransactionDocument.status values.
TRANSACTION_DOCUMENT_STATUSES = (
    "not_uploaded",
    "uploaded",
    "accepted",
    "needs_update",
)

# Document templates seeded onto a new PropertyTransaction, keyed by
# transaction_type ("rent"/"sale", matching Property.listing_type's own
# values). No brief document/checklist examples were found committed
# anywhere in this repo's docs (Prompt 1's inspection notes searched
# thoroughly) — these are deliberately conservative, generic KYC-style
# document types only (identity + ability-to-pay), matching the tracking
# doc's "Absolutely NOT in scope" list: no Ejar-specific paperwork, no
# Nafath/government-verification claims, no financing/mortgage documents,
# no legal contract text. `document_type` is a stable machine key; `label`
# is the display string. Kept identical in shape (2 required + 1 optional)
# between rent and sale so Prompt 3's checklist fraction math (e.g.
# documents "2/3") works the same for both transaction types.
DOCUMENT_TEMPLATES: dict[str, list[dict]] = {
    "rent": [
        {"document_type": "national_id", "label": "National ID / Iqama Copy", "required": True},
        {"document_type": "proof_of_income", "label": "Proof of Income (Salary Certificate or Bank Statement)", "required": True},
        {"document_type": "supporting_document", "label": "Additional Supporting Document", "required": False},
    ],
    "sale": [
        {"document_type": "national_id", "label": "National ID / Iqama Copy", "required": True},
        {"document_type": "proof_of_funds", "label": "Proof of Funds (Bank Statement)", "required": True},
        {"document_type": "supporting_document", "label": "Additional Supporting Document", "required": False},
    ],
}


class PropertyTransaction(Base):
    __tablename__ = "property_transactions"
    __table_args__ = (
        Index("ix_property_transactions_customer_status", "customer_user_id", "status"),
        Index("ix_property_transactions_mediator_status", "mediator_id", "status"),
        Index("ix_property_transactions_property_customer", "property_id", "customer_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    # Human-readable display id (e.g. "MYM-00042"), assigned right after
    # insert once `id` is known (see create_transaction_for_negotiation()) —
    # deterministic (derived from the primary key), never random, so it's
    # reproducible/debuggable. Unlike PropertyNegotiation's equivalent
    # (`negotiation_reference`, computed on the fly, never persisted), this
    # one IS a real column per the brief's explicit field list.
    reference: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)

    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False)
    # Copied from PropertyNegotiation.transaction_type at creation time
    # (itself copied from Property.listing_type) — never read live, same
    # "snapshot, don't re-derive" rationale as the negotiation feature.
    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)

    customer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    mediator_id: Mapped[int | None] = mapped_column(ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True)
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    # Exactly one PropertyTransaction per accepted PropertyNegotiation — this
    # unique constraint (not just an application-level check) is what
    # actually prevents duplicates under a race. See module docstring.
    negotiation_id: Mapped[int] = mapped_column(ForeignKey("property_negotiations.id", ondelete="CASCADE"), unique=True, nullable=False)
    # Copied verbatim from PropertyNegotiation.viewing_id at creation time —
    # the negotiation already did the real ownership/completion validation
    # for this id, so no new validation is needed here (see tracking doc
    # "Inspection notes" §2).
    viewing_id: Mapped[int | None] = mapped_column(ForeignKey("property_viewings.id", ondelete="SET NULL"), nullable=True)

    # Immutable through normal transaction editing (brief's global
    # constraint) — any change requires a new negotiation/amendment, never a
    # direct field edit. Snapshotted from the accepted negotiation's
    # current_offer_amount at creation time.
    agreed_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default=DEFAULT_CURRENCY, server_default=DEFAULT_CURRENCY)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="initiated", index=True)
    progress_percentage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # "Customer info" checklist step (Prompt 3): full name/phone/email are
    # reused verbatim from the User row (see
    # app/services/property_transaction.py::customer_info_snapshot()) — no
    # new columns needed for the content itself. This timestamp IS
    # genuinely transaction-specific (a customer confirms their info once
    # PER transaction, not once ever), so it can't be reused from User and
    # is added here. Set by the future POST
    # .../confirm-information action (Prompt 4) — this prompt only adds the
    # column.
    customer_info_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Mediator-side counterpart to customer_info_confirmed_at above — the
    # assigned mediator's own "property and commercial information
    # confirmed" timestamp (Prompt 5's POST .../confirm-information action).
    # Deliberately a separate column, not a shared one: confirmation is
    # per-actor (customer confirms their side, mediator confirms theirs),
    # mirroring why customer_info_confirmed_at itself couldn't live on User.
    # Storage only — Prompt 3's checklist/progress engine does not read this
    # column (see tracking doc's "Checklist / Progress methodology": only
    # one confirmation flag existed when that engine was built; wiring this
    # one into the checklist is left for a future prompt).
    mediator_info_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    cancellation_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # "customer" | "mediator" | "admin" — three possible cancelling parties
    # (unlike PropertyNegotiation/PropertyViewing's customer/mediator-only
    # convention this column's String(20) type still mirrors), added by
    # Prompt 4 alongside its cancel action. Prompt 2 deliberately omitted
    # this column (see its own "Known limitations" note); this Prompt 4
    # migration adds it as a plain nullable column, not a backfill concern
    # since no PropertyTransaction could have been cancelled before this
    # column existed.
    cancelled_by: Mapped[str | None] = mapped_column(String(20), nullable=True)

    property = relationship("Property", foreign_keys=[property_id])
    customer = relationship("User", foreign_keys=[customer_user_id])
    mediator = relationship("Mediator", foreign_keys=[mediator_id])
    lead = relationship("Lead", foreign_keys=[lead_id])
    viewing = relationship("PropertyViewing", foreign_keys=[viewing_id])
    negotiation = relationship("PropertyNegotiation", foreign_keys=[negotiation_id])
    documents: Mapped[list["TransactionDocument"]] = relationship(
        "TransactionDocument",
        back_populates="transaction",
        cascade="all, delete-orphan",
        # Same tie-breaker rationale as NegotiationOffer.negotiation's
        # order_by (see property_negotiation.py) — rows seeded in the same
        # transaction can share a server_default now() tick under this test
        # suite's savepoint-based isolation, so `id` (insertion order) is
        # the deterministic secondary sort key.
        order_by="TransactionDocument.created_at, TransactionDocument.id",
    )


class TransactionDocument(Base):
    __tablename__ = "transaction_documents"
    __table_args__ = (
        Index("ix_transaction_documents_transaction_status", "transaction_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    transaction_id: Mapped[int] = mapped_column(ForeignKey("property_transactions.id", ondelete="CASCADE"), nullable=False)
    # Stable machine key (e.g. "national_id") — see DOCUMENT_TEMPLATES above.
    document_type: Mapped[str] = mapped_column(String(50), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_uploaded")

    # Populated by Prompt 4's upload endpoint — this prompt only defines the
    # column. Storage mechanism (local disk vs. elsewhere) is Prompt 4's
    # call per Prompt 1's document-storage inspection notes; whatever it
    # picks, this column holds an opaque reference (path or id), never a
    # public URL (transaction documents are private, unlike listing photos).
    file_reference: Mapped[str | None] = mapped_column(String(512), nullable=True)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # No separate "review status" column: `status`'s own accepted/
    # needs_update values already ARE the review outcome — a duplicate
    # column would just be two names for the same fact and risk drifting
    # out of sync. `reviewed_at`/`review_note` are the only genuinely
    # separate review facts (when, and why on a needs_update).
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    transaction: Mapped["PropertyTransaction"] = relationship("PropertyTransaction", back_populates="documents")
