from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("mediator_id", "user_id", name="uq_one_review_per_user_mediator"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    mediator_id: Mapped[int] = mapped_column(ForeignKey("mediators.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)   # 1–5
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewer_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # pending → approved (visible on public profile) | rejected (hidden)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    mediator: Mapped["Mediator"] = relationship("Mediator", back_populates="reviews")  # type: ignore[name-defined]
    user: Mapped["User"] = relationship("User")  # type: ignore[name-defined]

    @property
    def mediator_agency_name(self) -> str | None:
        return self.mediator.agency_name if self.mediator else None

    @property
    def reviewer_is_verified(self) -> bool:
        return bool(self.user and self.user.is_verified)
