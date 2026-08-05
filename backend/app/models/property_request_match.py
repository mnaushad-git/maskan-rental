"""PropertyRequestMatch: one durable row per (request, property) pair the
deterministic matcher (app.services.property_request_matcher) has scored —
the request-side analog of SavedSearchMatch, but carrying a full score
breakdown + explanation instead of just a change reason, since a Property
Request match is shown to the customer as a ranked recommendation, not a
"something changed" alert.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

PROPERTY_REQUEST_MATCH_STATUSES = ("new", "viewed", "saved", "contacted", "dismissed", "shortlisted", "expired")


class PropertyRequestMatch(Base):
    __tablename__ = "property_request_matches"
    __table_args__ = (UniqueConstraint("request_id", "property_id", name="uq_property_request_match"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)

    match_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0", index=True)
    hard_pass: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    must_have_failures: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    flexible_coverage: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    preference_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    price_fit_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    area_fit_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    commute_fit_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    listing_quality_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0, server_default="0")

    match_reasons: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    trade_offs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    rejection_reasons: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    match_version: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new", server_default="new", index=True)

    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    request = relationship("PropertyRequest", back_populates="matches")
    property = relationship("Property")
