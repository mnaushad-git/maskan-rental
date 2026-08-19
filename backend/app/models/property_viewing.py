"""Visit & Viewing Management — see docs/implementation/mymakan-viewings.md.

A `PropertyViewing` is a customer's request to visit a listed property in
person, tracked through mediator confirmation/reschedule/cancellation/
completion. Deliberately a single flat row per viewing (no separate
event-log/history table) — the brief calls for "a minimum clean status
model" / "avoid complex negotiation state machines"; timeline/history is
derivable from the timestamp columns already on this row.

Status is a plain string column (mirrors `Property.status`'s convention,
not a DB enum type) so new statuses/transitions stay a Python-only change.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Terminal/inactive statuses — a customer may only have one active viewing
# (i.e. status NOT in this set) per property at a time (brief §18).
PROPERTY_VIEWING_INACTIVE_STATUSES = (
    "cancelled_by_customer",
    "cancelled_by_mediator",
    "completed",
    "no_show_customer",
    "no_show_mediator",
)

PROPERTY_VIEWING_STATUSES = (
    "requested",
    "confirmed",
    "reschedule_proposed",
    *PROPERTY_VIEWING_INACTIVE_STATUSES,
)

# Customer-facing cancellation reasons (brief §10).
CUSTOMER_CANCEL_REASONS = (
    "Plans changed",
    "Found another property",
    "Time no longer works",
    "Other",
)

# Post-viewing feedback interest levels (brief §16).
VIEWING_INTEREST_LEVELS = (
    "Very Interested",
    "Maybe",
    "Not Interested",
)

# Post-viewing feedback reasons — only meaningful when interest_level is
# "Not Interested" (brief §16).
VIEWING_FEEDBACK_REASONS = (
    "Price",
    "Location",
    "Size",
    "Condition",
    "Amenities",
    "Other",
)

# Mediator-facing cancellation reasons (brief §10).
MEDIATOR_CANCEL_REASONS = (
    "Property unavailable",
    "Owner unavailable",
    "Schedule conflict",
    "Other",
)

# Explicit status-transition lookup — "avoid complex negotiation state
# machines" / "minimum clean status model" per the brief. A plain
# {current_status: {allowed_next_statuses}} dict rather than a state-machine
# library; new transitions are a one-line change here.
PROPERTY_VIEWING_TRANSITIONS: dict[str, set[str]] = {
    "requested": {"confirmed", "reschedule_proposed", "cancelled_by_customer", "cancelled_by_mediator"},
    "confirmed": {
        "reschedule_proposed",
        "cancelled_by_customer",
        "cancelled_by_mediator",
        "completed",
        "no_show_customer",
        "no_show_mediator",
    },
    "reschedule_proposed": {"confirmed", "reschedule_proposed", "cancelled_by_customer", "cancelled_by_mediator"},
    # Terminal statuses (completed/cancelled_*/no_show_*) have no outgoing
    # transitions — omitted from this dict, so a lookup for them is always
    # an empty set via .get(status, set()).
}


class PropertyViewing(Base):
    __tablename__ = "property_viewings"
    __table_args__ = (
        Index("ix_property_viewings_customer_status", "customer_user_id", "status"),
        Index("ix_property_viewings_mediator_status", "mediator_id", "status"),
        Index("ix_property_viewings_property_customer", "property_id", "customer_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False)
    customer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    # Copied from Property.mediator_id at request time — a property is owned
    # by exactly one mediator, no lead indirection needed for ownership checks.
    mediator_id: Mapped[int | None] = mapped_column(ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True)
    # Set only when an existing LeadSuggestion(lead_id, property_id) already
    # links this customer's lead to this exact property — never auto-created
    # from a viewing request (see docs/implementation/mymakan-viewings.md
    # "Lead integration").
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)

    requested_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    requested_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    confirmed_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # IANA tz name (e.g. "Asia/Riyadh") the requested/confirmed times are in.
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, default="Asia/Riyadh")

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="requested", index=True)

    customer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    mediator_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    cancellation_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # "customer" | "mediator" — who cancelled.
    cancelled_by: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Reschedule proposal (brief §9) — kept separate from
    # requested_*/confirmed_* so both are preserved as history once resolved.
    proposed_start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    proposed_end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # "customer" | "mediator" — who last proposed the pending time.
    proposed_by: Mapped[str | None] = mapped_column(String(20), nullable=True)

    last_reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # "During Viewing" mode (brief §15) — kept on this row rather than a new
    # table per the brief's "keep implementation lightweight" / "no
    # offline-sync architecture" instructions.
    # checklist_state: {"sections": [...generated items...], "checked": {item_id: bool}}
    checklist_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # private_notes: list of {"text": str, "created_at": iso str}, customer-only.
    private_notes: Mapped[list | None] = mapped_column(JSONB, nullable=True)

    # Post-viewing feedback (brief §16).
    interest_level: Mapped[str | None] = mapped_column(String(30), nullable=True)
    feedback_reason: Mapped[str | None] = mapped_column(String(50), nullable=True)
    feedback_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    property = relationship("Property", foreign_keys=[property_id])
    customer = relationship("User", foreign_keys=[customer_user_id])
    mediator = relationship("Mediator", foreign_keys=[mediator_id])
    lead = relationship("Lead", foreign_keys=[lead_id])
