"""AI Home Finder — natural language → structured criteria → deterministic
ranked shortlist. Mirrors the Property Request extractor's shape
(`app.schemas.property_request` / `PROPERTY_REQUEST_EXTRACTOR`) but is
deliberately a separate, smaller vocabulary: Home Finder criteria are
ephemeral (never persisted as their own row beyond `HomeFinderSearch`'s
history snapshot) and scored against live inventory in one request, instead
of being matched continuously like a Property Request.
"""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.property import PropertyOut

# Amenity vocabulary the scoring engine can actually verify against real
# `Property` columns (see app.services.home_finder_scoring.AMENITY_FIELD_MAP).
# Anything the user asks for outside this set (e.g. "parking", "pool", "gym"
# — none of which have a backing column) is never scored; it's carried in
# `unsupported_requests` instead so the UI can still show it back to the user
# without pretending the platform verified it.
SUPPORTED_AMENITIES = (
    "furnished",
    "elevator",
    "air_conditioning",
    "kitchen_equipped",
    "water_included",
    "electricity_included",
    "private_roof",
    "villa_style",
    "two_entrances",
    "separate_electrical_meter",
)

# Lifestyle/preference vocabulary that feeds the area-intelligence-driven
# "lifestyle fit" scoring dimension (see home_finder_scoring._lifestyle_fit).
SUPPORTED_PREFERENCES = (
    "family_friendly",
    "near_schools",
    "near_healthcare",
    "quiet_area",
    "investment_potential",
)


class HomeFinderCriteria(BaseModel):
    """Structured search criteria — either produced by AI extraction from
    free text, edited by the user on the "myMakan understood" screen, or
    both. Every field is optional: an unset field simply means "no stated
    preference", which the scoring engine treats as an excluded dimension
    (see home_finder_scoring.py), never a guessed default.
    """

    transaction_type: Literal["rent", "sale"] | None = None
    city: str | None = None
    districts: list[str] = Field(default_factory=list)
    property_type: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    bedrooms: int | None = None
    required_amenities: list[str] = Field(default_factory=list)
    preferred_amenities: list[str] = Field(default_factory=list)
    unsupported_requests: list[str] = Field(default_factory=list)
    preferences: list[str] = Field(default_factory=list)
    commute_destination: str | None = None


class HomeFinderInterpretRequest(BaseModel):
    text: str
    locale: Literal["en", "ar"] = "en"
    # Set by the Rent/Buy entry point the user came from, so the AI extractor
    # doesn't have to guess when the free text itself is ambiguous.
    transaction_type_hint: Literal["rent", "sale"] | None = None


class HomeFinderInterpretResponse(BaseModel):
    criteria: HomeFinderCriteria
    ai_confidence: float
    missing_fields: list[str] = Field(default_factory=list)
    clarifying_questions: list[str] = Field(default_factory=list)
    generated_by: Literal["ai", "fallback"]


class HomeFinderRefineRequest(BaseModel):
    criteria: HomeFinderCriteria
    instruction: str
    locale: Literal["en", "ar"] = "en"


class CriteriaChange(BaseModel):
    field: str
    from_value: str = Field(alias="from")
    to_value: str = Field(alias="to")
    model_config = ConfigDict(populate_by_name=True)


class HomeFinderRefineResponse(BaseModel):
    criteria: HomeFinderCriteria
    changes: list[CriteriaChange] = Field(default_factory=list)
    generated_by: Literal["ai", "fallback"]


class HomeFinderSearchRequest(BaseModel):
    criteria: HomeFinderCriteria
    limit: int = Field(default=20, ge=1, le=50)
    # Original free-text query, carried through purely so /history can show a
    # human label — never re-parsed server-side.
    query_text: str | None = None


class HomeFinderResult(BaseModel):
    property: PropertyOut
    match_score: int
    dimension_scores: dict[str, float] = Field(default_factory=dict)
    reasons: list[str] = Field(default_factory=list)
    trade_offs: list[str] = Field(default_factory=list)


class HomeFinderCategories(BaseModel):
    best_overall: int | None = None
    best_value: int | None = None
    best_location: int | None = None
    best_family: int | None = None
    best_investment: int | None = None


class EmptyResultSuggestion(BaseModel):
    label: str
    criteria_patch: dict
    estimated_count: int


class EmptyResultInfo(BaseModel):
    message: str
    restrictive_reasons: list[str] = Field(default_factory=list)
    suggestions: list[EmptyResultSuggestion] = Field(default_factory=list)


class HomeFinderSearchResponse(BaseModel):
    results: list[HomeFinderResult]
    categories: HomeFinderCategories
    exact_match_count: int
    pool_count: int
    empty_result: EmptyResultInfo | None = None


class HomeFinderExplainRequest(BaseModel):
    criteria: HomeFinderCriteria
    property_id: int


class HomeFinderExplainResponse(BaseModel):
    summary: str
    match_score: int
    reasons: list[str] = Field(default_factory=list)
    trade_offs: list[str] = Field(default_factory=list)
    generated_by: Literal["ai", "fallback"]


class HomeFinderSearchHistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    query_text: str
    criteria: dict
    result_count: int
    created_at: datetime
