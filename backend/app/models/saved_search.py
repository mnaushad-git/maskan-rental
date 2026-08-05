from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

ALERT_FREQUENCIES = ("instant", "daily", "weekly", "off")
NOTIFICATION_CHANNELS = ("in_app", "push", "email")
SAVED_SEARCH_STATUSES = ("active", "disabled")


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="en", server_default="en")

    # Full structured criteria (see app.core.search.filters.PropertyFilterCriteria).
    filters: Mapped[dict] = mapped_column(JSONB, nullable=False)
    filter_schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # Denormalized out of `filters` purely so the matching engine can narrow
    # candidate saved searches with a cheap indexed SQL query instead of
    # deserializing + evaluating every row's JSON on every property event.
    transaction_type: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    city: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)

    # Alerting
    alert_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true", index=True)
    alert_frequency: Mapped[str] = mapped_column(String(20), nullable=False, default="instant", server_default="instant")
    channels: Mapped[list] = mapped_column(JSONB, nullable=False, default=lambda: ["in_app"])
    last_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Soft lifecycle — disabling must never delete historical notification/match rows.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active", index=True)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User", back_populates="saved_searches")
    matches = relationship("SavedSearchMatch", back_populates="saved_search", cascade="all, delete-orphan")
