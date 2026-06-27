from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SavedSearchBase(BaseModel):
    name: str
    filters: dict


class SavedSearchCreate(SavedSearchBase):
    user_id: int


class SavedSearchUpdate(BaseModel):
    name: str | None = None
    filters: dict | None = None


class SavedSearchOut(SavedSearchBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    created_at: datetime
