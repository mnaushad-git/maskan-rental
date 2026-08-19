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
    approval_status: str
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
    approval_status: str | None = None
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
    approval_status: str = "approved"
    subscription_status: str = "active"


# Property Verification & Trust Center (Prompt 4) — the ONLY verification
# phrase this platform is allowed to show today (never "Government Verified"
# / "REGA Verified" / "Ejar Verified" / "Nafath Verified"), mirroring
# `app.services.mediator_trust`'s identical wording constraint for the
# property-level Trust Model. Centralized here so every caller that needs to
# render a verification badge from `MediatorPublicOut.verification_label`
# uses this exact string rather than composing its own.
MEDIATOR_VERIFIED_LABEL = "✓ Verified by myMakan"


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

    # Trust & Activity (Prompt 4 — Property Verification & Trust Center,
    # spec section 11). All deterministic, computed by the route from
    # existing mediator.py/review.py/property.py/lead.py data — no new
    # tracking infrastructure. `verification_label` is either the single
    # allowed phrase above or None; never invent a different verification
    # claim. `response_rate`/`avg_response_time_hours` are None when the
    # mediator has no lead assignments yet ("if available" per the spec).
    verification_label: str | None = None
    avg_rating: float | None = None
    review_count: int = 0
    active_listing_count: int = 0
    rental_listing_count: int = 0
    sale_listing_count: int = 0
    member_since: datetime | None = None
    response_rate: float | None = None
    avg_response_time_hours: float | None = None

    model_config = {"from_attributes": True}
