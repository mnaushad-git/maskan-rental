from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Per-attempt delivery status. "accepted"/"sent" mean the provider took the
# request; "delivered" is only reachable for channels that report delivery
# acks (Expo does not, today — Expo push receipts only confirm "accepted by
# APNs/FCM", not "delivered to device" — see notes in notification_providers.py).
DELIVERY_STATUSES = (
    "accepted",
    "sent",
    "delivered",
    "failed",
    "invalid_token",
    "unregistered_token",
    "rate_limited",
    "provider_unavailable",
    "permanent_rejection",
    "skipped",
)


class NotificationDelivery(Base):
    """Durable per-channel, per-device delivery attempt (Phase 13). This is
    the source of truth for delivery health — provider logs and Redis are
    both best-effort/ephemeral, this table is not. One row per attempt (a
    retried send creates a new row with an incremented `attempt_number`,
    never overwrites the previous one) so admin ops can see the full retry
    history for a notification."""

    __tablename__ = "notification_deliveries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False, index=True)
    device_id: Mapped[int | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)  # "push" | "email" | "in_app"
    provider: Mapped[str] = mapped_column(String(30), nullable=False)  # "expo" | "fake" | "noop" | "sendgrid" | ...
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    status: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    failure_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    failure_message: Mapped[str | None] = mapped_column(String(500), nullable=True)  # sanitized — never raw tokens/PII

    attempted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    notification = relationship("Notification")
    device = relationship("Device")
