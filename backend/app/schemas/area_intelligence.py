from datetime import datetime
from pydantic import BaseModel


class AreaIntelligenceOut(BaseModel):
    id: int
    area_name: str
    city: str
    center_lat: float | None
    center_lng: float | None
    schools: list
    hospitals: list
    lifestyle: dict
    commute_minutes_to_center: int | None
    school_score: float | None
    healthcare_score: float | None
    lifestyle_score: float | None
    traffic_score: float | None
    family_score: float | None
    area_score: float | None
    rent_trend: list
    tags: list
    overview: str | None
    market_notes: list
    last_refreshed_at: datetime | None

    model_config = {"from_attributes": True}


class AreaIntelligenceSummary(BaseModel):
    """Lightweight version for the /areas table — no full schools/hospitals arrays."""
    area_name: str
    city: str
    school_score: float | None
    healthcare_score: float | None
    lifestyle_score: float | None
    traffic_score: float | None
    family_score: float | None
    area_score: float | None
    tags: list
    overview: str | None
    last_refreshed_at: datetime | None

    model_config = {"from_attributes": True}


class AreaIntelligenceUpdate(BaseModel):
    center_lat: float | None = None
    center_lng: float | None = None
    overview: str | None = None
    tags: list | None = None
    rent_trend: list | None = None
    market_notes: list | None = None
