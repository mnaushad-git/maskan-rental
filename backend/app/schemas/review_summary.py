"""Response schema for `GET /mediators/{id}/review-summary` (Prompt 4 —
Property Verification & Trust Center, spec section 12). Wraps
`app.services.review_summary.ReviewSummaryResult`.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ReviewSummaryOut(BaseModel):
    mediator_id: int
    avg_rating: float | None = None
    review_count: int = 0
    positive_themes: list[str] = Field(default_factory=list)
    considerations: list[str] = Field(default_factory=list)
    generated_by: Literal["ai", "fallback"]
    note: str | None = None
