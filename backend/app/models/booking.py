from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, func, text
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

_py_property = property  # save builtin before 'property' is shadowed by the relationship name below


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (
        # DB-level overlap guard for short-term stays: two non-cancelled
        # bookings on the same property can never share a night. Uses a
        # half-open range ([) — checkout day == next check-in day is allowed,
        # matching standard hospitality convention. Requires the btree_gist
        # extension (added in the migration) so gist can index the plain
        # integer equality alongside the range overlap.
        ExcludeConstraint(
            (text("property_id"), "="),
            (text("daterange(check_in, check_out, '[)')"), "&&"),
            where=text("status <> 'cancelled'"),
            using="gist",
            name="ex_bookings_no_overlap",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    property_id: Mapped[int] = mapped_column(ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True)
    renter_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)

    check_in: Mapped[date] = mapped_column(Date, nullable=False)
    check_out: Mapped[date] = mapped_column(Date, nullable=False)
    total_price: Mapped[float] = mapped_column(Float, nullable=False)

    # "confirmed" | "cancelled" — no payment flow yet, so bookings are
    # confirmed on creation; cancelling is the only status transition until
    # the pricing/payment session.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="confirmed", server_default="confirmed", index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    property: Mapped["Property"] = relationship("Property")  # type: ignore[name-defined]
    renter: Mapped["User"] = relationship("User", foreign_keys=[renter_user_id])  # type: ignore[name-defined]

    @_py_property
    def property_title(self) -> str | None:
        return self.property.title if self.property else None

    @_py_property
    def renter_name(self) -> str | None:
        return self.renter.full_name if self.renter else None
