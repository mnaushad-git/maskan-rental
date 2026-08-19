from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

NOTIFICATION_TYPES = (
    "saved_search_new_match",
    "saved_search_price_drop",
    "saved_search_back_on_market",
    "saved_search_verified",
    "saved_search_detail_updated",
    "saved_search_digest",
    "lead_message",
    "lead_status_update",
    "review_status",
    "subscription_status",
    "ai_recommendation",
    "system_announcement",
    "property_request_activated",
    "property_request_new_match",
    "property_request_improved_match",
    "property_request_mediator_response",
    "property_request_clarification_received",
    "property_request_expiring",
    "property_request_expired",
    "property_request_no_match_suggestion",
    "property_request_fulfilled",
    "viewing_requested",
    "viewing_confirmed",
    "viewing_reschedule_proposed",
    "viewing_cancelled",
    "viewing_completed",
    "negotiation_offer_submitted",
    "negotiation_counter_received",
    "negotiation_accepted",
    "negotiation_rejected",
    "negotiation_withdrawn",
)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="en", server_default="en")

    entity_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    saved_search_id: Mapped[int | None] = mapped_column(ForeignKey("saved_searches.id", ondelete="SET NULL"), nullable=True, index=True)
    property_id: Mapped[int | None] = mapped_column(ForeignKey("properties.id", ondelete="SET NULL"), nullable=True)

    match_reasons: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    deep_link: Mapped[str | None] = mapped_column(String(512), nullable=True)

    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # e.g. {"in_app": "delivered", "push": "pending", "email": "skipped"}
    delivery_status: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    ai_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Idempotency key for event-driven notifications (lead.*, review.*, ...):
    # f"{event_type}:{aggregate_id}:{user_id}" — NULL for saved-search-alert
    # notifications, which already dedupe via SavedSearchMatch. Partial
    # unique index (see migration) so NULLs never collide.
    dedupe_key: Mapped[str | None] = mapped_column(String(160), nullable=True)

    user = relationship("User")
