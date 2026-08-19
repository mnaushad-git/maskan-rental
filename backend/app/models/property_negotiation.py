"""AI Negotiation & Offer Management — see
docs/implementation/mymakan-negotiations.md.

A `PropertyNegotiation` is a customer's active offer/counter-offer exchange
with a mediator over a single property, tracked through submission,
countering, and acceptance/rejection/withdrawal. Deliberately a single flat
row per negotiation (mirrors `PropertyViewing`'s convention) plus a child
`NegotiationOffer` row per individual offer/counter in the exchange — the
offer history itself IS the timeline, so no separate event-log table is
needed on top.

Status is a plain string column (mirrors `Property.status`'s and
`PropertyViewing.status`'s convention, not a DB enum type) so new
statuses/transitions stay a Python-only change.

No dedicated `draft` status: a `PropertyNegotiation` row is only created once
the customer actually submits their first offer (status starts at
`submitted`). The "Enter Amount -> Review" steps before that are
frontend-only state — see the tracking doc's "Status flow" section.
"""
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Allowed status values for PropertyNegotiation. No separate `draft` (see
# module docstring) and no `expired` (column `NegotiationOffer.expires_at`
# exists per the brief's "if used" but nothing enforces it in this
# feature-first build — see tracking doc "Known limitations"). `closed`
# covers any terminal wrap-up state a later prompt might need on top of an
# already-`accepted` negotiation.
PROPERTY_NEGOTIATION_STATUSES = (
    "submitted",
    "countered",
    "accepted",
    "rejected",
    "withdrawn",
    "closed",
)

# Explicit status-transition lookup — plain {current_status:
# {allowed_next_statuses}} dict, mirroring PROPERTY_VIEWING_TRANSITIONS's
# shape exactly (the brief explicitly says avoid complex state machines).
# "countered" covers BOTH a mediator counter and a customer counter-offer —
# which side acted last is read off the latest NegotiationOffer.offer_type,
# not encoded as a separate negotiation-level status.
PROPERTY_NEGOTIATION_TRANSITIONS: dict[str, set[str]] = {
    "submitted": {"countered", "accepted", "rejected", "withdrawn"},
    "countered": {"countered", "accepted", "rejected", "withdrawn"},
    "accepted": {"closed"},
    # Terminal statuses (rejected/withdrawn/closed) have no outgoing
    # transitions — omitted from this dict, so a lookup for them is always
    # an empty set via .get(status, set()).
}

# NegotiationOffer.offer_type values.
NEGOTIATION_OFFER_TYPES = (
    "customer_offer",
    "mediator_counter",
    "customer_counter",
)

# NegotiationOffer.status values. "superseded" is set when a newer
# offer/counter is placed on the same negotiation — this is what backs
# "only the latest active offer can be accepted".
NEGOTIATION_OFFER_STATUSES = (
    "pending",
    "accepted",
    "rejected",
    "superseded",
)


class PropertyNegotiation(Base):
    __tablename__ = "property_negotiations"
    __table_args__ = (
        Index("ix_property_negotiations_customer_status", "customer_user_id", "status"),
        Index("ix_property_negotiations_mediator_status", "mediator_id", "status"),
        Index("ix_property_negotiations_property_customer", "property_id", "customer_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False)
    customer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    # Copied from Property.mediator_id at creation time — same convention as
    # PropertyViewing.mediator_id (a property is owned by exactly one
    # mediator, no lead indirection needed for ownership checks).
    mediator_id: Mapped[int | None] = mapped_column(ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True)
    # Set only when an existing LeadSuggestion(lead_id, property_id) already
    # links this customer's lead to this exact property — never
    # auto-created from a negotiation (same decision as
    # PropertyViewing.lead_id — see docs/implementation/mymakan-negotiations.md
    # "Lead integration").
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    # Set when this negotiation originated from (or is linked to) a
    # completed/in-progress PropertyViewing — never required, a customer can
    # negotiate without having scheduled a viewing first.
    viewing_id: Mapped[int | None] = mapped_column(ForeignKey("property_viewings.id", ondelete="SET NULL"), nullable=True)

    # Copied from Property.listing_type at creation time — stored (not read
    # live via the property relationship) so a later listing edit can't
    # retroactively change a live negotiation's transaction type.
    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="submitted", index=True)

    current_offer_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Snapshot of Property.monthly_rent/sale_price at creation time — same
    # "copy, don't read live" rationale as transaction_type above.
    original_listing_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Added in Prompt 3 (missed in Prompt 1's field list) — set by
    # withdraw_negotiation() (customer-only) and, in a later prompt, by the
    # mediator-side reject transition. `cancelled_by` mirrors
    # PropertyViewing.cancelled_by's "customer" | "mediator" convention.
    cancellation_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cancelled_by: Mapped[str | None] = mapped_column(String(20), nullable=True)

    property = relationship("Property", foreign_keys=[property_id])
    customer = relationship("User", foreign_keys=[customer_user_id])
    mediator = relationship("Mediator", foreign_keys=[mediator_id])
    lead = relationship("Lead", foreign_keys=[lead_id])
    viewing = relationship("PropertyViewing", foreign_keys=[viewing_id])
    offers: Mapped[list["NegotiationOffer"]] = relationship(
        "NegotiationOffer",
        back_populates="negotiation",
        cascade="all, delete-orphan",
        # `id` is a deliberate secondary sort key (added in Prompt 3): under
        # this test suite's savepoint-based isolation (see
        # tests/conftest.py), every row committed within one test shares the
        # same real outer Postgres transaction, and `created_at`'s
        # `func.now()` server_default resolves to that transaction's start
        # time for ALL of them — so multiple offers placed within a single
        # test can tie on created_at, making order_by="created_at" alone
        # non-deterministic for offer-history ordering. `id` is monotonic
        # and always breaks the tie in insertion order.
        order_by="NegotiationOffer.created_at, NegotiationOffer.id",
    )


class NegotiationOffer(Base):
    __tablename__ = "negotiation_offers"
    __table_args__ = (
        Index("ix_negotiation_offers_negotiation_created", "negotiation_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    negotiation_id: Mapped[int] = mapped_column(ForeignKey("property_negotiations.id", ondelete="CASCADE"), nullable=False)
    # The acting user — customer or mediator's user account, whichever
    # placed this specific offer row. Nullable/SET NULL so a deleted user
    # account doesn't remove offer history.
    offered_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    offer_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Present per the brief's "if used" but NOT enforced by any background
    # job in this feature-first build — see tracking doc "Known limitations".
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    negotiation: Mapped["PropertyNegotiation"] = relationship("PropertyNegotiation", back_populates="offers")
    offered_by = relationship("User", foreign_keys=[offered_by_user_id])
