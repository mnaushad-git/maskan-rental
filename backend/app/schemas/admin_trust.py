"""Admin moderation extensions for the Property Verification & Trust Center
(Prompt 6, spec sections 14-15). Response/request schemas for
`app.api.routes.admin_trust` — the dashboard aggregate, the filterable
property moderation list, the per-property review-detail assembly, and the
hide/restore/resolve-report moderation actions.

Deliberately reuses existing shapes wherever one already exists rather than
redefining them: `TrustAssessmentOut` (Prompt 2/5), `CompletenessOut`
(Prompt 1/2), `ImageQualityOut` (Prompt 3), `MediatorPublicOut` (Prompt 4),
`PropertyReportOut` (Prompt 2), `PropertyIntelligenceOut` (pre-existing
Property Intelligence feature). This file only adds the admin-specific
wrapper shapes those don't already provide.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.mediator import MediatorPublicOut
from app.schemas.partner_quality import ImageQualityOut
from app.schemas.property_intelligence import PropertyIntelligenceOut
from app.schemas.property_report import PropertyReportOut
from app.schemas.trust import CompletenessOut, TrustAssessmentOut


class AdminTrustDashboardOut(BaseModel):
    listings_requiring_review: int
    low_completeness_listings: int
    stale_listings: int
    open_reports: int
    mediators_pending_verification: int
    recently_reported_properties: int


class ModerationListItemOut(BaseModel):
    property_id: int
    title: str
    transaction_type: str
    city: str
    area: str
    status: str
    mediator_id: int | None = None
    mediator_name: str | None = None
    mediator_verified: bool = False
    trust_score: int
    trust_level: str
    completeness_score: int
    freshness_category: str
    open_report_count: int = 0
    updated_at: datetime


class AdminDataQualityOut(BaseModel):
    """The exact same `compute_listing_completeness` + `assess_image_quality`
    calls Prompt 3's partner `GET /partner/properties/{id}/quality` already
    makes — reused, not recomputed, so admin sees the identical data-quality
    picture the partner sees for the same listing."""

    completeness: CompletenessOut
    missing_field_suggestions: list[str] = Field(default_factory=list)
    image_quality: ImageQualityOut


class ModerationHistoryEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    entity_type: str
    entity_id: str | None
    user_id: int | None
    extra_metadata: dict = Field(default_factory=dict)
    created_at: datetime


class PropertyReviewDetailOut(BaseModel):
    property_id: int
    title: str
    transaction_type: str
    city: str
    area: str
    status: str
    trust: TrustAssessmentOut
    data_quality: AdminDataQualityOut
    mediator: MediatorPublicOut | None = None
    mediator_approval_status: str | None = None
    reports: list[PropertyReportOut] = Field(default_factory=list)
    property_intelligence: PropertyIntelligenceOut | None = None
    moderation_history: list[ModerationHistoryEntryOut] = Field(default_factory=list)


class PropertyHideRequest(BaseModel):
    reason: str | None = None


class PropertyModerationActionOut(BaseModel):
    property_id: int
    status: str


class ReportResolveRequest(BaseModel):
    status: Literal["Under Review", "Resolved", "Dismissed"]
    resolution_notes: str | None = None


class ReportResolveOut(BaseModel):
    id: int
    property_id: int
    status: str
    resolved_at: datetime | None
    resolved_by: int | None
    resolution_notes: str | None
