from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Mediator(Base):
    __tablename__ = "mediators"
    __table_args__ = (UniqueConstraint("user_id", name="uq_mediators_user_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    license_number: Mapped[str] = mapped_column(String(100), nullable=False)
    agency_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str] = mapped_column(String(30), nullable=False)
    bio: Mapped[str | None] = mapped_column(Text, nullable=True)
    profile_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    # Subscription
    subscription_status: Mapped[str] = mapped_column(String(30), nullable=False, default="inactive")
    subscription_tier: Mapped[str] = mapped_column(String(30), nullable=False, default="standard")
    subscription_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    subscription_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Moyasar card token — saved after first subscription payment, used for per-lead charges
    moyasar_card_token: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Admin approval gate — "pending" | "approved" | "rejected".
    # New self-registrations start "pending" and cannot access the portal until
    # an admin approves. Admin-created partners are "approved" on creation.
    approval_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")

    # Stats
    total_leads_accepted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])  # type: ignore[name-defined]
    areas: Mapped[list["MediatorArea"]] = relationship("MediatorArea", back_populates="mediator", cascade="all, delete-orphan")
    assignments: Mapped[list["LeadAssignment"]] = relationship("LeadAssignment", back_populates="mediator")  # type: ignore[name-defined]
    reviews: Mapped[list["Review"]] = relationship("Review", back_populates="mediator", cascade="all, delete-orphan")  # type: ignore[name-defined]


class MediatorArea(Base):
    __tablename__ = "mediator_areas"
    __table_args__ = (UniqueConstraint("mediator_id", "area_name", "city", name="uq_mediator_area"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mediator_id: Mapped[int] = mapped_column(ForeignKey("mediators.id", ondelete="CASCADE"), nullable=False)
    area_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    mediator: Mapped["Mediator"] = relationship("Mediator", back_populates="areas")
