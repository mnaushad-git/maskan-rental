from datetime import datetime
from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base


class AreaIntelligence(Base):
    __tablename__ = "area_intelligence"
    __table_args__ = (UniqueConstraint("area_name", "city", name="uq_area_intelligence_area_city"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    area_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    center_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    center_lng: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Raw place data from Maskan area intelligence
    schools: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    hospitals: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    lifestyle: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Commute
    commute_minutes_to_center: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Computed scores (0–100)
    school_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    healthcare_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    lifestyle_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    traffic_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    family_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    area_score: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Manual / aggregated data
    rent_trend: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    tags: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    overview: Mapped[str | None] = mapped_column(Text, nullable=True)
    market_notes: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    last_refreshed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
