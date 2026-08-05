from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

DEVICE_PLATFORMS = ("ios", "android", "web")


class Device(Base):
    """Push-notification device registration. `push_token` is opaque and
    revocable (not a secret credential in the password sense) but is still
    treated as sensitive — never logged, never returned to any user other
    than its owner. Multiple devices per user are supported; the same
    physical device re-registering (reinstall, token rotation) upserts by
    (user_id, push_token) rather than creating a duplicate row.

    `push_token_hash` (sha256, indexed, NOT unique on its own) lets
    `register_device` find and disable any *other* user's row already
    holding this exact token before creating/reactivating this user's row —
    enforcing "one token must not be actively assigned to multiple users"
    without ever needing to read the raw token back out for comparison
    across users."""

    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("user_id", "push_token", name="uq_device_user_token"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    platform: Mapped[str] = mapped_column(String(10), nullable=False)
    push_token: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    push_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    installation_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    device_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(30), nullable=True)
    os_version: Mapped[str | None] = mapped_column(String(30), nullable=True)
    locale: Mapped[str] = mapped_column(String(5), nullable=False, default="en", server_default="en")
    device_timezone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    failure_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    last_active_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_success_push_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failed_push_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")
