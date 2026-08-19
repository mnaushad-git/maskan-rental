"""Response/request schemas for `POST /partner/properties/*` (Prompt 3).
Reuses `CompletenessOut` from `schemas/trust.py` rather than redefining the
same shape twice — `GET /partner/properties/{id}/quality` and
`GET /properties/{id}/trust` both wrap the exact same
`compute_listing_completeness` result.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.trust import CompletenessOut
from app.services.image_quality import ImageQualityResult


class ImageQualityIssueOut(BaseModel):
    code: str
    severity: str  # "info" | "warning" | "blocking"
    message: str


class ImageQualityOut(BaseModel):
    image_count: int
    issues: list[ImageQualityIssueOut] = Field(default_factory=list)
    has_blocking_issues: bool = False

    @classmethod
    def from_result(cls, result: ImageQualityResult) -> "ImageQualityOut":
        return cls(
            image_count=result.image_count,
            issues=[ImageQualityIssueOut(code=i.code, severity=i.severity, message=i.message) for i in result.issues],
            has_blocking_issues=result.has_blocking_issues,
        )


class PartnerListingQualityOut(BaseModel):
    property_id: int
    completeness: CompletenessOut
    missing_field_suggestions: list[str] = Field(default_factory=list)
    image_quality: ImageQualityOut
    availability_confirmed_at: datetime | None = None


class PartnerAvailabilityConfirmOut(BaseModel):
    property_id: int
    availability_confirmed_at: datetime


class PartnerImproveWithAiRequest(BaseModel):
    focus: Literal["title", "description", "both"] = "both"
    language: Literal["en", "ar"] = "en"


class PartnerImproveWithAiOut(BaseModel):
    property_id: int
    suggested_title: str | None = None
    suggested_description: str | None = None
    generated_by: Literal["ai", "fallback"]
    note: str = "This is a suggestion only. Review it and explicitly save to apply — nothing has been changed yet."
