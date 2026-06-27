from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    customer_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)

    # Denormalized for mediator to see without JOIN
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    customer_phone: Mapped[str] = mapped_column(String(30), nullable=False)
    customer_email: Mapped[str] = mapped_column(String(255), nullable=False)

    area_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    min_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    bedrooms_needed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    move_in_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    requirements_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending_review", index=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="web_form")

    # Closure request — set by the accepting partner, reviewed by admin
    closure_outcome: Mapped[str | None] = mapped_column(String(30), nullable=True)
    closure_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    closure_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closure_requested_by_mediator_id: Mapped[int | None] = mapped_column(ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    customer: Mapped["User"] = relationship("User", foreign_keys=[customer_user_id])  # type: ignore[name-defined]
    suggestions: Mapped[list["LeadSuggestion"]] = relationship("LeadSuggestion", back_populates="lead", cascade="all, delete-orphan")
    assignments: Mapped[list["LeadAssignment"]] = relationship("LeadAssignment", back_populates="lead", cascade="all, delete-orphan")
    messages: Mapped[list["LeadMessage"]] = relationship("LeadMessage", back_populates="lead", cascade="all, delete-orphan")


_py_property = property  # save builtin before 'property' is shadowed by the relationship name below


class LeadSuggestion(Base):
    __tablename__ = "lead_suggestions"
    __table_args__ = (UniqueConstraint("lead_id", "property_id", name="uq_lead_suggestion"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    property_id: Mapped[int | None] = mapped_column(ForeignKey("properties.id", ondelete="SET NULL"), nullable=True)
    match_score: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lead: Mapped["Lead"] = relationship("Lead", back_populates="suggestions")
    property: Mapped["Property"] = relationship("Property")  # type: ignore[name-defined]

    @_py_property
    def property_title(self) -> str | None:
        return self.property.title if self.property else None

    @_py_property
    def monthly_rent(self) -> float | None:
        return self.property.monthly_rent if self.property else None

    @_py_property
    def bedrooms(self) -> int | None:
        return self.property.bedrooms if self.property else None


class LeadAssignment(Base):
    __tablename__ = "lead_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    mediator_id: Mapped[int | None] = mapped_column(ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    payment_id: Mapped[int | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    lead: Mapped["Lead"] = relationship("Lead", back_populates="assignments")
    mediator: Mapped["Mediator"] = relationship("Mediator", back_populates="assignments")
    payment: Mapped["Payment"] = relationship("Payment")  # type: ignore[name-defined]

    @property
    def mediator_agency_name(self) -> str | None:
        return self.mediator.agency_name if self.mediator else None

    @property
    def mediator_phone(self) -> str | None:
        return self.mediator.phone if self.mediator else None


class LeadMessage(Base):
    __tablename__ = "lead_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sender_role: Mapped[str] = mapped_column(String(20), nullable=False)  # "customer" | "mediator"
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    lead: Mapped["Lead"] = relationship("Lead", back_populates="messages")
