"""Response schema for `GET /properties/{id}/intelligence` — assembles the
Prompt 1-4 deterministic services into one payload. Every nested object is
kept intentionally light (IDs/summaries, not full model duplicates) per the
brief's "avoid unnecessary API proliferation" / no-duplicate-data guidance —
e.g. `area_intelligence` here is a small reference object, not a copy of the
full `AreaIntelligence` row (callers that need the full row already have
`fetchAreaIntelligence`).
"""
from typing import Literal

from pydantic import BaseModel, Field


class DimensionScoreOut(BaseModel):
    score: int
    reason: str


class DataConfidenceOut(BaseModel):
    level: str
    reason: str


class PriceIntelligenceOut(BaseModel):
    type: Literal["rent", "buy"]
    sufficient_data: bool
    asking_price: float | None = None
    fair_range_low: float | None = None
    fair_range_high: float | None = None
    market_midpoint: float | None = None
    price_per_sqm: float | None = None
    comparable_median_price_per_sqm: float | None = None
    estimated_value_low: float | None = None
    estimated_value_high: float | None = None
    percent_difference: float | None = None
    classification: str | None = None
    factors_used: list[str] = Field(default_factory=list)
    comparable_count: int = 0
    explanation: str | None = None


class ComparablePropertySummaryOut(BaseModel):
    property_id: int
    title: str
    image_url: str | None = None
    price: float | None = None
    price_difference: float | None = None
    price_per_sqm: float | None = None
    match_similarity_percent: int
    value_label: str | None = None


class ComparableSummaryOut(BaseModel):
    count: int
    items: list[ComparablePropertySummaryOut] = Field(default_factory=list)


class PersonalizedFitRowOut(BaseModel):
    label: str
    status: str
    detail: str


class PersonalizedFitOut(BaseModel):
    rows: list[PersonalizedFitRowOut]
    priorities_matched: int
    priorities_total: int
    summary: str


class NegotiationInsightOut(BaseModel):
    asking_price: float
    market_midpoint: float
    discussion_range_low: float
    discussion_range_high: float
    approach: str


class AreaIntelligenceRefOut(BaseModel):
    area_name: str
    city: str
    area_score: float | None = None
    summary: str | None = None


class PropertyIntelligenceOut(BaseModel):
    decision_score: int
    component_scores: dict[str, DimensionScoreOut]
    omitted_score_dimensions: list[str] = Field(default_factory=list)
    data_confidence: DataConfidenceOut
    price_intelligence: PriceIntelligenceOut
    comparable_summary: ComparableSummaryOut
    strengths: list[str] = Field(default_factory=list)
    considerations: list[str] = Field(default_factory=list)
    things_to_verify: list[str] = Field(default_factory=list)
    personalized_fit: PersonalizedFitOut | None = None
    smart_questions: list[str] = Field(default_factory=list)
    negotiation_intelligence: NegotiationInsightOut | None = None
    area_intelligence: AreaIntelligenceRefOut | None = None
