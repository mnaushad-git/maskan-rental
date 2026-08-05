from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class DigestRun(Base):
    """Durable, Postgres-backed record that a given user's daily/weekly
    digest was (or is being) compiled for a given period. The unique
    constraint is the actual idempotency guarantee — a duplicate scheduler
    tick, a redelivered Celery task, or an APScheduler restart can all
    attempt the same digest run without ever sending it twice, independent
    of whether Redis happens to be up. Redis locking (`maskan:digest:lock:*`)
    is layered on top only to avoid wasted concurrent work, not for
    correctness."""

    __tablename__ = "digest_runs"
    __table_args__ = (UniqueConstraint("user_id", "period", "run_date", name="uq_digest_run"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    period: Mapped[str] = mapped_column(String(10), nullable=False)  # "daily" | "weekly"
    run_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed", server_default="completed")
    notification_count: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
