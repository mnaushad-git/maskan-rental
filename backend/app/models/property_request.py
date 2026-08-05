"""PropertyRequest domain: an explicit customer demand for a property,
distinct from a SavedSearch (a passive alert on a filter) — a request carries
must-have/nice-to-have/flexible criteria, an AI interpretation kept separate
from user-confirmed criteria, a clarification history, a revision history,
and a lifecycle that mediators respond to (see app/models/property_request_match.py
and app/models/property_request_mediator_response.py for the matching/response
side entities).

Structured criteria are additionally projected into `canonical_filters`
(the same shape as `app.core.search.filters.PropertyFilterCriteria.to_dict()`)
so the matcher and any future search-driven preview can reuse the existing
filter vocabulary instead of re-deriving "does this property match" logic —
see app/core/property_request/criteria.py for the projection.
"""
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

PROPERTY_REQUEST_STATUSES = (
    "draft",
    "awaiting_clarification",
    "active",
    "paused",
    "matched",
    "negotiating",
    "fulfilled",
    "expired",
    "closed",
    "cancelled",
)

# Terminal statuses remain visible in history but are never re-activated in place.
PROPERTY_REQUEST_TERMINAL_STATUSES = ("fulfilled", "expired", "closed", "cancelled")

MEDIATOR_PREFERENCES = ("owner_only", "mediator_only", "either")
CLARIFICATION_STATUSES = ("none", "pending", "resolved")
PROPERTY_REQUEST_ALERT_FREQUENCIES = ("instant", "daily", "weekly", "off")


class PropertyRequest(Base):
    __tablename__ = "property_requests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="en", server_default="en")

    # ── Basic need / location ────────────────────────────────────────────
    transaction_type: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)  # "rent" | "sale"
    property_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    preferred_districts: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    excluded_districts: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # ── Budget ────────────────────────────────────────────────────────────
    min_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_price: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Property specifications ─────────────────────────────────────────
    bedrooms_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bedrooms_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    min_area_sq_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_area_sq_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    furnishing: Mapped[str | None] = mapped_column(String(50), nullable=True)
    required_amenities: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    preferred_amenities: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    property_age_preference: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # ── Timing ────────────────────────────────────────────────────────────
    availability_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    move_in_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rental_payment_frequency: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # ── Counterparty preference ──────────────────────────────────────────
    mediator_preference: Mapped[str] = mapped_column(String(20), nullable=False, default="either", server_default="either")
    verified_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # ── Commute ───────────────────────────────────────────────────────────
    max_commute_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    commute_destination_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    commute_destination_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    commute_destination_lng: Mapped[float | None] = mapped_column(Float, nullable=True)

    # ── Schools / facilities / lifestyle ─────────────────────────────────
    school_preference: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    hospital_preference: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    lifestyle_preferences: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    family_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    household_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    accessibility_requirements: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    pet_preference: Mapped[str | None] = mapped_column(String(30), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Criteria weighting (Phase 2: "must, flexible, optional must be
    # explicitly distinguishable") — lists of canonical_filters field names.
    must_have_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    nice_to_have_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    flexible_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Optional partial override of the global scoring weight categories
    # (see app.core.property_request.scoring.ScoringWeights) — e.g. a user
    # who cares more about budget than commute can bias their own matches.
    priority_weighting: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # ── AI interpretation — kept separate from confirmed criteria; the AI
    # must never silently overwrite the fields above (Phase 2 rule). ───────
    ai_extracted_criteria: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    clarification_status: Mapped[str] = mapped_column(String(20), nullable=False, default="none", server_default="none")
    clarification_rounds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # ── Matching / mediator / alerting toggles ──────────────────────────
    matching_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)
    mediator_responses_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    alert_frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="instant", server_default="instant")

    # ── Lifecycle ────────────────────────────────────────────────────────
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft", server_default="draft", index=True)
    expiry_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_customer_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # ── Canonical filter projection (see app.core.property_request.criteria) ──
    filter_schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    canonical_filters: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    user = relationship("User", foreign_keys=[user_id])
    revisions = relationship("PropertyRequestRevision", back_populates="request", cascade="all, delete-orphan", order_by="PropertyRequestRevision.revision_number")
    clarifications = relationship("PropertyRequestClarification", back_populates="request", cascade="all, delete-orphan", order_by="PropertyRequestClarification.round_number")
    activities = relationship("PropertyRequestActivity", back_populates="request", cascade="all, delete-orphan", order_by="PropertyRequestActivity.created_at")
    matches = relationship("PropertyRequestMatch", back_populates="request", cascade="all, delete-orphan")
    mediator_responses = relationship("PropertyRequestMediatorResponse", back_populates="request", cascade="all, delete-orphan")


class PropertyRequestRevision(Base):
    """Snapshot of confirmed criteria at the moment of a material change —
    "every material change should produce a new request revision" (Phase 2).
    `snapshot` is a full `canonical_filters`-shaped dict plus the structured
    fields, so any past state can be displayed/diffed without replaying edits."""

    __tablename__ = "property_request_revisions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    revision_number: Mapped[int] = mapped_column(Integer, nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    changed_fields: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    change_reason: Mapped[str] = mapped_column(String(50), nullable=False)  # "user_edit" | "ai_confirmation" | "admin_edit"
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    request = relationship("PropertyRequest", back_populates="revisions")


class PropertyRequestClarification(Base):
    """One AI clarification question + (eventually) its answer. Rounds are
    capped by settings.PROPERTY_REQUEST_MAX_CLARIFICATION_ROUNDS (Phase 3:
    "Maximum clarification rounds should be configurable")."""

    __tablename__ = "property_request_clarifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    question_locale: Mapped[str] = mapped_column(String(5), nullable=False, default="en", server_default="en")
    field_hint: Mapped[str | None] = mapped_column(String(50), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending", index=True)
    answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    answered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    request = relationship("PropertyRequest", back_populates="clarifications")


class PropertyRequestActivity(Base):
    """Append-only timeline feed for the request-detail UI (Phase 10C) —
    distinct from AuditLog (which is a platform-wide security/compliance
    trail); this is the customer-facing "what happened to my request" story."""

    __tablename__ = "property_request_activities"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False)  # customer | mediator | admin | system | ai
    actor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    activity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    request = relationship("PropertyRequest", back_populates="activities")
