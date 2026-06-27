from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.property import PropertyOut


class SavedPropertyCreate(BaseModel):
    user_id: int
    property_id: int
    status: str = "none"
    notes: str | None = None
    viewing_at: datetime | None = None


class SavedPropertyUpdate(BaseModel):
    status: str | None = None
    notes: str | None = None
    viewing_at: datetime | None = None


class SavedPropertyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    property_id: int
    status: str
    notes: str | None = None
    viewing_at: datetime | None = None
    created_at: datetime
    property: PropertyOut