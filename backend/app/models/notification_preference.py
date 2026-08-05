from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Categories a user can independently control (Phase 4). Each maps to a
# {"channels": [...], "frequency": "instant"|"daily"|"weekly"|"off"} entry
# inside `category_preferences`. "security" is intentionally excluded from
# the category list surfaced for disabling — see NOTIFICATION_CATEGORIES
# below and `_deliver`'s security bypass.
NOTIFICATION_CATEGORIES = (
    "property_alerts",
    "price_changes",
    "saved_search_digest",
    "lead_updates",
    "lead_messages",
    "review_updates",
    "subscription_payments",
    "ai_recommendations",
    "product_announcements",
    "security",
)

DIGEST_PERIODS = ("daily", "weekly")


def default_category_preferences() -> dict:
    return {
        category: {"channels": ["in_app", "push"], "frequency": "instant"}
        for category in NOTIFICATION_CATEGORIES
        if category != "security"
    } | {"security": {"channels": ["in_app", "push"], "frequency": "instant"}}


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)

    in_app_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    # Per-category channel + frequency overrides (Phase 4). Keyed by
    # NOTIFICATION_CATEGORIES; see default_category_preferences(). A
    # category not present in the dict falls back to the global
    # in_app/push/email toggles above at "instant" frequency.
    category_preferences: Mapped[dict] = mapped_column(JSONB, nullable=False, default=default_category_preferences)

    # Local hour (0-23) the daily digest should be compiled for this user,
    # and the ISO weekday (0=Monday..6=Sunday) the weekly digest should run
    # on. The bucketed scheduler (app/tasks/notifications.py:run_digest_bucket)
    # reads `next_daily_digest_at`/`next_weekly_digest_at` directly rather
    # than recomputing hour/timezone math on every tick — those two columns
    # are kept up to date by `_reschedule_digest()` whenever digest_hour,
    # weekly_digest_day, or timezone change.
    digest_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=8, server_default="8")
    weekly_digest_day: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    timezone: Mapped[str] = mapped_column(String(50), nullable=False, default="Asia/Riyadh", server_default="Asia/Riyadh")
    next_daily_digest_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    next_weekly_digest_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # Quiet hours (Phase 4). Push/email deliveries falling inside the window
    # are suppressed (in-app record still created) unless the notification
    # is security-critical and allow_urgent_bypass is True.
    quiet_hours_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    quiet_hours_start: Mapped[str] = mapped_column(String(5), nullable=False, default="22:00", server_default="22:00")  # "HH:MM", local to `timezone`
    quiet_hours_end: Mapped[str] = mapped_column(String(5), nullable=False, default="07:00", server_default="07:00")
    quiet_hours_allow_urgent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    # Hide message preview text from push/lock-screen payloads (Phase 3/14) —
    # push still delivers, but with a generic title/body instead of content.
    hide_message_preview: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")
