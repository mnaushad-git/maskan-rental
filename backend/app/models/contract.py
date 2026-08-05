from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

_py_property = property  # save builtin before 'property' is shadowed by the relationship name below


class Contract(Base):
    __tablename__ = "contracts"
    __table_args__ = (UniqueConstraint("lead_id", name="uq_contracts_lead_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    tenant_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    landlord_mediator_id: Mapped[int] = mapped_column(ForeignKey("mediators.id", ondelete="RESTRICT"), nullable=False, index=True)
    property_id: Mapped[int | None] = mapped_column(ForeignKey("properties.id", ondelete="SET NULL"), nullable=True)

    rent_amount: Mapped[float] = mapped_column(Float, nullable=False)
    deposit_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    status: Mapped[str] = mapped_column(String(30), nullable=False, default="draft", index=True)  # draft | pending_signature | active | expired

    tenant_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    landlord_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    lead: Mapped["Lead"] = relationship("Lead")  # type: ignore[name-defined]
    tenant: Mapped["User"] = relationship("User", foreign_keys=[tenant_user_id])  # type: ignore[name-defined]
    landlord_mediator: Mapped["Mediator"] = relationship("Mediator", foreign_keys=[landlord_mediator_id])  # type: ignore[name-defined]
    property: Mapped["Property"] = relationship("Property", foreign_keys=[property_id])  # type: ignore[name-defined]

    @_py_property
    def tenant_name(self) -> str | None:
        return self.tenant.full_name if self.tenant else None

    @_py_property
    def landlord_agency_name(self) -> str | None:
        return self.landlord_mediator.agency_name if self.landlord_mediator else None

    @_py_property
    def property_title(self) -> str | None:
        return self.property.title if self.property else None
