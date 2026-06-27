from datetime import datetime
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (UniqueConstraint("gateway_payment_id", name="uq_payments_gateway_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    mediator_id: Mapped[int | None] = mapped_column(ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True)
    payment_type: Mapped[str] = mapped_column(String(30), nullable=False)  # "subscription" | "lead_pickup"
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="SAR")
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")  # pending | paid | failed | refunded
    gateway: Mapped[str] = mapped_column(String(30), nullable=False, default="moyasar")
    gateway_payment_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    gateway_raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    mediator: Mapped["Mediator"] = relationship("Mediator")  # type: ignore[name-defined]
