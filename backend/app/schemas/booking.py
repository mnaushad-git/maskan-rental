from datetime import date, datetime

from pydantic import BaseModel, model_validator


class BookingCreate(BaseModel):
    property_id: int
    check_in: date
    check_out: date
    total_price: float

    @model_validator(mode="after")
    def _check_date_order(self) -> "BookingCreate":
        if self.check_out <= self.check_in:
            raise ValueError("check_out must be after check_in")
        return self


class BookingOut(BaseModel):
    id: int
    property_id: int
    renter_user_id: int
    check_in: date
    check_out: date
    total_price: float
    status: str
    created_at: datetime
    updated_at: datetime
    property_title: str | None = None
    renter_name: str | None = None

    model_config = {"from_attributes": True}


class AvailabilityOut(BaseModel):
    property_id: int
    check_in: date
    check_out: date
    available: bool
