from datetime import datetime
from pydantic import BaseModel, EmailStr


class MediatorAreaOut(BaseModel):
    id: int
    mediator_id: int
    area_name: str
    city: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MediatorAreaCreate(BaseModel):
    area_name: str
    city: str


class MediatorOut(BaseModel):
    id: int
    user_id: int
    license_number: str
    agency_name: str | None
    phone: str
    bio: str | None
    profile_image_url: str | None
    subscription_status: str
    subscription_tier: str
    subscription_started_at: datetime | None
    subscription_expires_at: datetime | None
    total_leads_accepted: int
    is_verified: bool
    created_at: datetime
    areas: list[MediatorAreaOut] = []

    model_config = {"from_attributes": True}


class MediatorCreate(BaseModel):
    license_number: str
    agency_name: str | None = None
    phone: str
    bio: str | None = None
    profile_image_url: str | None = None


class MediatorUpdate(BaseModel):
    agency_name: str | None = None
    phone: str | None = None
    bio: str | None = None
    profile_image_url: str | None = None


class MediatorAdminUpdate(BaseModel):
    subscription_status: str | None = None
    is_verified: bool | None = None
    subscription_expires_at: datetime | None = None


class AdminPartnerCreate(BaseModel):
    email: str
    password: str
    full_name: str | None = None
    license_number: str
    agency_name: str | None = None
    phone: str
    bio: str | None = None
    profile_image_url: str | None = None
    is_verified: bool = False
    subscription_status: str = "active"


class MediatorPublicOut(BaseModel):
    id: int
    agency_name: str | None
    phone: str
    bio: str | None
    profile_image_url: str | None
    is_verified: bool
    total_leads_accepted: int
    created_at: datetime
    areas: list[MediatorAreaOut] = []

    model_config = {"from_attributes": True}
