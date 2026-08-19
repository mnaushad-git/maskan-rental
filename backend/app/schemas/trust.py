"""Response schema for `GET /properties/{id}/trust` — wraps Prompt 1's
`app.services.trust_assessment.TrustAssessment` dataclass (and its five
component-result dataclasses) as a Pydantic model. Mirrors
`schemas/property_intelligence.py`'s existing "small reference objects, not
full model duplicates" pattern for this feature's own response.

Reuses `DataConfidenceOut` from `schemas/property_intelligence.py` rather
than redefining the same {level, reason} shape twice.
"""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.property_intelligence import DataConfidenceOut
from app.services.trust_assessment import TrustAssessment


class CompletenessOut(BaseModel):
    score: int
    present_fields: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    missing_required: list[str] = Field(default_factory=list)
    tier_breakdown: dict[str, dict[str, int]] = Field(default_factory=dict)


class ConsistencyIssueOut(BaseModel):
    code: str
    severity: str  # "info" | "warning" | "blocking"
    message: str


class ConsistencyOut(BaseModel):
    score: int
    issues: list[ConsistencyIssueOut] = Field(default_factory=list)
    has_blocking_issues: bool = False


class MediatorTrustOut(BaseModel):
    score: int
    is_verified: bool
    review_count: int
    avg_rating: float | None = None
    listing_count: int
    reason: str


class FreshnessOut(BaseModel):
    score: int
    category: str
    days_since_reference: int
    reason: str


class MarketplaceConfidenceOut(BaseModel):
    score: int
    level: str
    reason: str


class TrustComponentScoresOut(BaseModel):
    """Only the components the assessment actually computed are populated
    (see `TrustAssessmentOut.omitted_components` for the rest) — never a
    fabricated value standing in for an omitted component."""

    completeness: CompletenessOut | None = None
    consistency: ConsistencyOut | None = None
    mediator_trust: MediatorTrustOut | None = None
    freshness: FreshnessOut | None = None
    marketplace_confidence: MarketplaceConfidenceOut | None = None


class TrustAssessmentOut(BaseModel):
    property_id: int
    overall_score: int
    trust_level: str  # "High" | "Good" | "Moderate" | "Limited Confidence"
    component_scores: TrustComponentScoresOut
    omitted_components: list[str] = Field(default_factory=list)
    positive_signals: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    things_to_verify: list[str] = Field(default_factory=list)
    data_confidence: DataConfidenceOut | None = None

    @classmethod
    def from_assessment(cls, property_id: int, assessment: TrustAssessment) -> "TrustAssessmentOut":
        cs = assessment.component_scores
        completeness = cs.get("completeness")
        consistency = cs.get("consistency")
        mediator_trust = cs.get("mediator_trust")
        freshness = cs.get("freshness")
        marketplace = cs.get("marketplace_confidence")

        return cls(
            property_id=property_id,
            overall_score=assessment.overall_score,
            trust_level=assessment.trust_level,
            component_scores=TrustComponentScoresOut(
                completeness=CompletenessOut(**vars(completeness)) if completeness else None,
                consistency=(
                    ConsistencyOut(
                        score=consistency.score,
                        issues=[
                            ConsistencyIssueOut(code=i.code, severity=i.severity, message=i.message)
                            for i in consistency.issues
                        ],
                        has_blocking_issues=consistency.has_blocking_issues,
                    )
                    if consistency
                    else None
                ),
                mediator_trust=MediatorTrustOut(**vars(mediator_trust)) if mediator_trust else None,
                freshness=FreshnessOut(**vars(freshness)) if freshness else None,
                marketplace_confidence=MarketplaceConfidenceOut(**vars(marketplace)) if marketplace else None,
            ),
            omitted_components=assessment.omitted_components,
            positive_signals=assessment.positive_signals,
            missing_information=assessment.missing_information,
            things_to_verify=assessment.things_to_verify,
            data_confidence=(
                DataConfidenceOut(level=assessment.data_confidence.level, reason=assessment.data_confidence.reason)
                if assessment.data_confidence
                else None
            ),
        )
