from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.saved_search import ALERT_FREQUENCIES, NOTIFICATION_CHANNELS


class PropertyFilterCriteriaIn(BaseModel):
    """Request/response shape for `app.core.search.filters.PropertyFilterCriteria`
    — the canonical filter vocabulary shared by saved searches and the
    matching engine (see Phase 2/4 of the platform plan)."""

    keyword: str = ""
    transaction_type: str | None = None
    property_type: str | None = None
    city: str | None = None
    districts: list[str] = Field(default_factory=list)
    min_price: float | None = Field(default=None, ge=0)
    max_price: float | None = Field(default=None, ge=0)
    bedrooms: int | None = Field(default=None, ge=0)
    bathrooms: int | None = Field(default=None, ge=0)
    min_area_sq_m: int | None = Field(default=None, ge=0)
    max_area_sq_m: int | None = Field(default=None, ge=0)
    furnishing: str | None = None
    amenities: list[str] = Field(default_factory=list)
    mediator_id: int | None = None
    verified_only: bool = False
    min_lat: float | None = None
    max_lat: float | None = None
    min_lng: float | None = None
    max_lng: float | None = None
    sort: str = "newest"

    @field_validator("transaction_type")
    @classmethod
    def _valid_transaction_type(cls, v: str | None) -> str | None:
        if v is not None and v not in ("rent", "sale"):
            raise ValueError("transaction_type must be 'rent' or 'sale'")
        return v

    @field_validator("sort")
    @classmethod
    def _valid_sort(cls, v: str) -> str:
        if v not in ("newest", "price_asc", "price_desc"):
            raise ValueError("sort must be one of: newest, price_asc, price_desc")
        return v

    @field_validator("max_price")
    @classmethod
    def _max_price_gte_min(cls, v: float | None, info) -> float | None:
        min_price = info.data.get("min_price")
        if v is not None and min_price is not None and v < min_price:
            raise ValueError("max_price must be >= min_price")
        return v


class SavedSearchCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    locale: str = "en"
    filters: PropertyFilterCriteriaIn
    alert_enabled: bool = True
    alert_frequency: str = "instant"
    channels: list[str] = Field(default_factory=lambda: ["in_app"])
    confirm_duplicate: bool = False

    @field_validator("alert_frequency")
    @classmethod
    def _valid_frequency(cls, v: str) -> str:
        if v not in ALERT_FREQUENCIES:
            raise ValueError(f"alert_frequency must be one of {ALERT_FREQUENCIES}")
        return v

    @field_validator("channels")
    @classmethod
    def _valid_channels(cls, v: list[str]) -> list[str]:
        invalid = set(v) - set(NOTIFICATION_CHANNELS)
        if invalid:
            raise ValueError(f"invalid channels: {sorted(invalid)}")
        return v

    @field_validator("locale")
    @classmethod
    def _valid_locale(cls, v: str) -> str:
        if v not in ("en", "ar"):
            raise ValueError("locale must be 'en' or 'ar'")
        return v


class SavedSearchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    filters: PropertyFilterCriteriaIn | None = None
    alert_enabled: bool | None = None
    alert_frequency: str | None = None
    channels: list[str] | None = None
    status: str | None = None

    @field_validator("alert_frequency")
    @classmethod
    def _valid_frequency(cls, v: str | None) -> str | None:
        if v is not None and v not in ALERT_FREQUENCIES:
            raise ValueError(f"alert_frequency must be one of {ALERT_FREQUENCIES}")
        return v

    @field_validator("status")
    @classmethod
    def _valid_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("active", "disabled"):
            raise ValueError("status must be 'active' or 'disabled'")
        return v


class SavedSearchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    locale: str
    filters: dict
    filter_schema_version: int
    alert_enabled: bool
    alert_frequency: str
    channels: list[str]
    last_evaluated_at: datetime | None
    last_notified_at: datetime | None
    status: str
    user_id: int
    created_at: datetime
    updated_at: datetime
    # Populated by the route (cheap COUNT against saved_search_matches), not a model column.
    latest_matches_count: int = 0


class SavedSearchDuplicateCandidate(BaseModel):
    id: int
    name: str
    created_at: datetime


class SavedSearchPreviewResponse(BaseModel):
    estimated_count: int
    duplicate_of: SavedSearchDuplicateCandidate | None = None


class SavedSearchMatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    property_id: int
    change_type: str
    match_reasons: list[dict]
    match_score: float
    notified: bool
    created_at: datetime
