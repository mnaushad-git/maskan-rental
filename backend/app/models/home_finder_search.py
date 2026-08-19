from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HomeFinderSearch(Base):
    """One row per AI Home Finder search a signed-in user ran — powers
    "Recent AI Searches" (Section 14). Deliberately not `SavedSearch`: no
    alerting/matching lifecycle, just a lightweight history snapshot of the
    free-text query and the structured criteria it resolved to.
    """

    __tablename__ = "home_finder_searches"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    query_text: Mapped[str] = mapped_column(String(500), nullable=False)
    criteria: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
