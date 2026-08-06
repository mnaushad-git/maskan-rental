from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

_py_property = property  # save builtin before 'property' is shadowed by the relationship name below


class FinancingInterest(Base):
    """Interest-capture waitlist for renter rent financing (Rent Now, Pay
    Later) — no real financing partner is confirmed yet, so this stores intent
    only, no money movement. ai_note is the AI Affordability Advisor's note
    generated at submission time, persisted so admins can see what the renter
    was told."""

    __tablename__ = "financing_interests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    renter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    stated_budget: Mapped[float] = mapped_column(Float, nullable=False)
    ai_note: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    ai_generated_by: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "ai" | "fallback"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    renter: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
    property: Mapped["Property"] = relationship("Property")  # type: ignore[name-defined]

    @_py_property
    def renter_name(self) -> str | None:
        return self.renter.full_name if self.renter else None

    @_py_property
    def property_title(self) -> str | None:
        return self.property.title if self.property else None
