from datetime import datetime

from pydantic import BaseModel, Field


class FinancingInterestCreate(BaseModel):
    property_id: int
    stated_budget: float = Field(gt=0)


class FinancingInterestOut(BaseModel):
    id: int
    renter_user_id: int
    property_id: int
    stated_budget: float
    ai_note: str | None
    ai_generated_by: str | None
    created_at: datetime
    property_title: str | None = None
    renter_name: str | None = None

    model_config = {"from_attributes": True}
