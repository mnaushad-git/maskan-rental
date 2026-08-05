"""Centralized, versioned scoring-weight configuration for the
PropertyRequestMatcher (Phase 6: "Do not hardcode the weights throughout the
code. Use centralized, versioned configuration."). Exactly one row has
`is_active=True` at a time; admins can publish a new version (a new row) and
flip the active flag, and every PropertyRequestMatch records the
`match_version` it was scored under so historical matches remain explainable
even after weights change. See app.core.property_request.scoring for the
in-code defaults used to seed version 1.
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PropertyRequestScoringConfig(Base):
    __tablename__ = "property_request_scoring_configs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    weights: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false", index=True)
    created_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
