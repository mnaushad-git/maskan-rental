from datetime import date, datetime

from pydantic import BaseModel


class ContractCreate(BaseModel):
    lead_id: int
    property_id: int | None = None
    rent_amount: float
    deposit_amount: float | None = None
    start_date: date
    end_date: date


class ContractOut(BaseModel):
    id: int
    lead_id: int
    tenant_user_id: int
    landlord_mediator_id: int
    property_id: int | None
    rent_amount: float
    deposit_amount: float | None
    start_date: date
    end_date: date
    status: str
    tenant_signed_at: datetime | None
    landlord_signed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    tenant_name: str | None = None
    landlord_agency_name: str | None = None
    property_title: str | None = None

    model_config = {"from_attributes": True}
