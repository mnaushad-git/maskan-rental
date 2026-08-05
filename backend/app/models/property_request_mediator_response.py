"""Mediator response marketplace entities (Phase 9). A mediator responds to
an active PropertyRequest with one of: submit one property, submit several,
flag upcoming inventory, ask a permitted clarification question, or decline.
Submitted properties live in a child table with a (request, property) unique
constraint so the SAME property can never be submitted twice against one
request, even across different response rows / different mediators.
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

MEDIATOR_RESPONSE_TYPES = ("submit_property", "submit_multiple", "upcoming_inventory", "clarification_question", "decline")
MEDIATOR_RESPONSE_STATUSES = ("pending", "accepted", "dismissed", "saved", "question_answered", "declined")


class PropertyRequestMediatorResponse(Base):
    __tablename__ = "property_request_mediator_responses"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    mediator_id: Mapped[int] = mapped_column(ForeignKey("mediators.id", ondelete="CASCADE"), nullable=False, index=True)

    response_type: Mapped[str] = mapped_column(String(30), nullable=False)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending", index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    request = relationship("PropertyRequest", back_populates="mediator_responses")
    mediator = relationship("Mediator")
    submitted_properties = relationship("PropertyRequestMediatorResponseProperty", back_populates="response", cascade="all, delete-orphan")


class PropertyRequestMediatorResponseProperty(Base):
    __tablename__ = "property_request_mediator_response_properties"
    __table_args__ = (UniqueConstraint("request_id", "property_id", name="uq_property_request_submitted_property"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("property_request_mediator_responses.id", ondelete="CASCADE"), nullable=False, index=True)
    # Denormalized from the parent response purely to carry the (request, property) uniqueness
    # constraint above — a property can only ever be submitted once per request, platform-wide.
    request_id: Mapped[int] = mapped_column(Integer, ForeignKey("property_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    response = relationship("PropertyRequestMediatorResponse", back_populates="submitted_properties")
    property = relationship("Property")
