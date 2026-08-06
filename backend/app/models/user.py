from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Renter identity verification (Nafath-style, mocked) — mirrors
    # Mediator.is_verified/approval_status but on User since any renter can
    # submit, not just mediators. "unverified" | "pending" | "approved" | "rejected".
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unverified", server_default="unverified")
    is_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    verification_document_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    verification_submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    saved_searches = relationship("SavedSearch", back_populates="user", cascade="all, delete-orphan")
    saved_properties = relationship("SavedProperty", back_populates="user", cascade="all, delete-orphan")
