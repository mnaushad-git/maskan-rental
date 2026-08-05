from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.property_request import (
    CLARIFICATION_STATUSES,
    MEDIATOR_PREFERENCES,
    PROPERTY_REQUEST_ALERT_FREQUENCIES,
    PROPERTY_REQUEST_STATUSES,
)
from app.models.property_request_match import PROPERTY_REQUEST_MATCH_STATUSES
from app.models.property_request_mediator_response import MEDIATOR_RESPONSE_TYPES

# Field names a customer may classify as must-have / nice-to-have / flexible —
# kept in sync with app.services.property_request_matcher's checked fields.
CRITERIA_FIELD_NAMES = {
    "transaction_type", "city", "max_price", "min_price", "bedrooms_min", "bedrooms_max",
    "bathrooms_min", "bathrooms_max", "min_area_sq_m", "max_area_sq_m", "furnishing",
    "property_category", "verified_only", "preferred_districts",
}


def _validate_criteria_fields(v: list[str]) -> list[str]:
    invalid = set(v) - CRITERIA_FIELD_NAMES
    if invalid:
        raise ValueError(f"unknown criteria fields: {sorted(invalid)}")
    return v


class PropertyRequestBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    locale: str = "en"
    transaction_type: str | None = None
    property_category: str | None = None
    city: str | None = None
    preferred_districts: list[str] = Field(default_factory=list)
    excluded_districts: list[str] = Field(default_factory=list)
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    bedrooms_min: int | None = Field(default=None, ge=0)
    bedrooms_max: int | None = Field(default=None, ge=0)
    bathrooms_min: int | None = Field(default=None, ge=0)
    bathrooms_max: int | None = Field(default=None, ge=0)
    min_area_sq_m: int | None = Field(default=None, ge=0)
    max_area_sq_m: int | None = Field(default=None, ge=0)
    furnishing: str | None = None
    required_amenities: list[str] = Field(default_factory=list)
    preferred_amenities: list[str] = Field(default_factory=list)
    property_age_preference: str | None = None
    availability_date: date | None = None
    move_in_date: date | None = None
    rental_payment_frequency: str | None = None
    mediator_preference: str = "either"
    verified_only: bool = False
    max_commute_minutes: int | None = Field(default=None, ge=0)
    commute_destination_name: str | None = None
    commute_destination_lat: float | None = None
    commute_destination_lng: float | None = None
    school_preference: bool = False
    hospital_preference: bool = False
    lifestyle_preferences: list[str] = Field(default_factory=list)
    family_size: int | None = Field(default=None, ge=0)
    household_type: str | None = None
    accessibility_requirements: list[str] = Field(default_factory=list)
    pet_preference: str | None = None
    notes: str | None = None
    must_have_fields: list[str] = Field(default_factory=list)
    nice_to_have_fields: list[str] = Field(default_factory=list)
    flexible_fields: list[str] = Field(default_factory=list)
    priority_weighting: dict[str, float] = Field(default_factory=dict)
    matching_enabled: bool = True
    mediator_responses_enabled: bool = True
    alert_frequency: str = "instant"

    @field_validator("transaction_type")
    @classmethod
    def _valid_txn(cls, v: str | None) -> str | None:
        if v is not None and v not in ("rent", "sale"):
            raise ValueError("transaction_type must be 'rent' or 'sale'")
        return v

    @field_validator("locale")
    @classmethod
    def _valid_locale(cls, v: str) -> str:
        if v not in ("en", "ar"):
            raise ValueError("locale must be 'en' or 'ar'")
        return v

    @field_validator("mediator_preference")
    @classmethod
    def _valid_mediator_pref(cls, v: str) -> str:
        if v not in MEDIATOR_PREFERENCES:
            raise ValueError(f"mediator_preference must be one of {MEDIATOR_PREFERENCES}")
        return v

    @field_validator("alert_frequency")
    @classmethod
    def _valid_alert_freq(cls, v: str) -> str:
        if v not in PROPERTY_REQUEST_ALERT_FREQUENCIES:
            raise ValueError(f"alert_frequency must be one of {PROPERTY_REQUEST_ALERT_FREQUENCIES}")
        return v

    @field_validator("must_have_fields", "nice_to_have_fields", "flexible_fields")
    @classmethod
    def _valid_criteria_fields(cls, v: list[str]) -> list[str]:
        return _validate_criteria_fields(v)

    @field_validator("max_price")
    @classmethod
    def _max_price_gte_min(cls, v: float | None, info) -> float | None:
        min_price = info.data.get("min_price")
        if v is not None and min_price is not None and v < min_price:
            raise ValueError("max_price must be >= min_price")
        return v


class PropertyRequestCreate(PropertyRequestBase):
    pass


class PropertyRequestUpdate(BaseModel):
    """All optional — PATCH semantics (`exclude_unset=True`), mirrors
    SavedSearchUpdate's convention."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    transaction_type: str | None = None
    property_category: str | None = None
    city: str | None = None
    preferred_districts: list[str] | None = None
    excluded_districts: list[str] | None = None
    min_price: float | None = None
    max_price: float | None = None
    bedrooms_min: int | None = None
    bedrooms_max: int | None = None
    bathrooms_min: int | None = None
    bathrooms_max: int | None = None
    min_area_sq_m: int | None = None
    max_area_sq_m: int | None = None
    furnishing: str | None = None
    required_amenities: list[str] | None = None
    preferred_amenities: list[str] | None = None
    property_age_preference: str | None = None
    availability_date: date | None = None
    move_in_date: date | None = None
    rental_payment_frequency: str | None = None
    mediator_preference: str | None = None
    verified_only: bool | None = None
    max_commute_minutes: int | None = None
    commute_destination_name: str | None = None
    commute_destination_lat: float | None = None
    commute_destination_lng: float | None = None
    school_preference: bool | None = None
    hospital_preference: bool | None = None
    lifestyle_preferences: list[str] | None = None
    family_size: int | None = None
    household_type: str | None = None
    accessibility_requirements: list[str] | None = None
    pet_preference: str | None = None
    notes: str | None = None
    must_have_fields: list[str] | None = None
    nice_to_have_fields: list[str] | None = None
    flexible_fields: list[str] | None = None
    priority_weighting: dict[str, float] | None = None
    matching_enabled: bool | None = None
    mediator_responses_enabled: bool | None = None
    alert_frequency: str | None = None

    @field_validator("must_have_fields", "nice_to_have_fields", "flexible_fields")
    @classmethod
    def _valid_criteria_fields(cls, v: list[str] | None) -> list[str] | None:
        return _validate_criteria_fields(v) if v is not None else v

    @field_validator("alert_frequency")
    @classmethod
    def _valid_alert_freq(cls, v: str | None) -> str | None:
        if v is not None and v not in PROPERTY_REQUEST_ALERT_FREQUENCIES:
            raise ValueError(f"alert_frequency must be one of {PROPERTY_REQUEST_ALERT_FREQUENCIES}")
        return v


class PropertyRequestOut(PropertyRequestBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    ai_extracted_criteria: dict | None = None
    ai_confidence: float | None = None
    clarification_status: str
    clarification_rounds: int
    status: str
    expiry_date: datetime | None = None
    last_matched_at: datetime | None = None
    last_customer_activity_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    revision_number: int
    # Populated by the route (cheap COUNTs), not model columns.
    match_count: int = 0
    new_match_count: int = 0
    mediator_response_count: int = 0


class PropertyRequestSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: str
    transaction_type: str | None
    city: str | None
    min_price: float | None
    max_price: float | None
    bedrooms_min: int | None
    expiry_date: datetime | None
    created_at: datetime
    updated_at: datetime
    match_count: int = 0
    new_match_count: int = 0
    mediator_response_count: int = 0


class PropertyRequestFromText(BaseModel):
    text: str = Field(min_length=3, max_length=4000)
    locale: str = "en"

    @field_validator("locale")
    @classmethod
    def _valid_locale(cls, v: str) -> str:
        if v not in ("en", "ar"):
            raise ValueError("locale must be 'en' or 'ar'")
        return v


class PropertyRequestExtractionOut(BaseModel):
    """A `draft`/`awaiting_clarification` Property Request pre-filled from
    AI-extracted criteria. It already has a real `id` (so the frontend can
    show clarifications / let the user review and edit it), but it is NOT
    active — the user must still call `/activate` before matching or
    mediator responses begin (Phase 2/3: "AI may suggest but not confirm
    critical criteria. User confirmation is required before activating an
    AI-created request.")."""

    draft: PropertyRequestOut
    ai_confidence: float
    missing_fields: list[str]
    clarifying_questions: list[str]
    ai_trace_id: str | None = None


class ClarificationAnswer(BaseModel):
    answer: str = Field(min_length=1, max_length=1000)


class ClarificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    round_number: int
    question: str
    question_locale: str
    field_hint: str | None
    status: str
    answer: str | None
    answered_at: datetime | None
    created_at: datetime


class PropertyRequestMatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    # None only for ephemeral, non-persisted preview rows (POST /preview-matches).
    id: int | None = None
    property_id: int
    match_score: float
    flexible_coverage: float
    preference_score: float
    price_fit_score: float
    area_fit_score: float
    commute_fit_score: float
    listing_quality_score: float
    confidence: float
    match_reasons: list[dict]
    trade_offs: list[dict]
    match_version: str
    status: str
    created_at: datetime
    updated_at: datetime

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v: str) -> str:
        if v not in PROPERTY_REQUEST_MATCH_STATUSES:
            raise ValueError("invalid match status")
        return v


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_type: str
    actor_id: int | None
    activity_type: str
    payload: dict
    created_at: datetime


class NoMatchDiagnosticOut(BaseModel):
    field: str
    candidates_with_field: int
    candidates_if_relaxed: int


class AreaSuggestionOut(BaseModel):
    area_name: str
    city: str
    fit_score: float
    label: str  # "best_overall" | "best_value" | "best_commute" | "best_family" | "premium" | "flexible_alternative"
    typical_price_range: tuple[float | None, float | None] | None = None
    estimated_availability: int
    commute_estimate_minutes: float | None = None
    reasons: list[str]
    trade_offs: list[str]
    data_confidence: float


class AIAgentRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[dict] = Field(default_factory=list)


class AIAgentResponse(BaseModel):
    reply: str
    ai_trace_id: str | None = None


# ── Mediator marketplace ────────────────────────────────────────────────────

class PartnerRequestSummaryOut(BaseModel):
    """Privacy-safe summary shown to mediators — no customer name/phone/email,
    no free-text notes/description (Phase 9/16)."""

    id: int
    transaction_type: str | None
    property_category: str | None
    city: str | None
    preferred_districts: list[str]
    min_price: float | None
    max_price: float | None
    bedrooms_min: int | None
    bedrooms_max: int | None
    must_have_fields: list[str]
    flexible_fields: list[str]
    created_at: datetime
    expiry_date: datetime | None
    inventory_match_count: int = 0
    already_responded: bool = False


class MediatorResponseCreate(BaseModel):
    response_type: str
    message: str | None = Field(default=None, max_length=1000)
    property_ids: list[int] = Field(default_factory=list)

    @field_validator("response_type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in MEDIATOR_RESPONSE_TYPES:
            raise ValueError(f"response_type must be one of {MEDIATOR_RESPONSE_TYPES}")
        return v


class MediatorResponseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    mediator_id: int
    response_type: str
    message: str | None
    status: str
    created_at: datetime
    property_ids: list[int] = Field(default_factory=list)


# ── Admin ────────────────────────────────────────────────────────────────────

class AdminPropertyRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    status: str
    city: str | None
    transaction_type: str | None
    min_price: float | None
    max_price: float | None
    created_at: datetime
    expiry_date: datetime | None
    match_count: int = 0
    mediator_response_count: int = 0
    ai_trace_id: str | None = None


class AdminAnalyticsOut(BaseModel):
    total_requests: int
    active_requests: int
    by_status: dict[str, int]
    by_city: dict[str, int]
    no_match_rate: float
    avg_time_to_first_match_hours: float | None
    match_to_save_rate: float
    match_to_contact_rate: float
    mediator_response_rate: float
    fulfillment_rate: float
    expiry_rate: float
