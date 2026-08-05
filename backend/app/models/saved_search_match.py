from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

CHANGE_TYPES = (
    "new_listing",
    "back_on_market",
    "price_drop",
    "price_increase",
    "verified",
    "detail_updated",
)


class SavedSearchMatch(Base):
    """One row per (saved search, property, meaningful change) — the durable,
    deterministic record of "this property matched this saved search for
    this reason at this time". Notifications are generated from these, but
    the match record itself outlives the notification (and outlives the
    saved search being disabled) so match/analytics history is never lost.

    `change_hash` + the unique constraint below is the source-of-truth
    dedup guard (Redis dedupe in app.core.redis_client is a fast pre-check
    only) — a retried matching job can safely re-insert the same logical
    match without producing a duplicate alert.
    """

    __tablename__ = "saved_search_matches"
    __table_args__ = (
        UniqueConstraint("saved_search_id", "property_id", "change_hash", name="uq_saved_search_match_dedup"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    saved_search_id: Mapped[int] = mapped_column(ForeignKey("saved_searches.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)

    change_type: Mapped[str] = mapped_column(String(30), nullable=False)
    change_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    match_reasons: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    match_score: Mapped[float] = mapped_column(nullable=False, default=0.0, server_default="0")

    notified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    notification_id: Mapped[int | None] = mapped_column(ForeignKey("notifications.id", ondelete="SET NULL"), nullable=True)

    event_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    saved_search = relationship("SavedSearch", back_populates="matches")
    property = relationship("Property")
