from datetime import datetime

from pydantic import BaseModel, ConfigDict


class PropertyBase(BaseModel):
    title: str
    area: str
    city: str
    size_sq_m: int | None = None
    listing_type: str = "rent"
    monthly_rent: float | None = None
    sale_price: float | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    owner_name: str | None = None
    status: str = "Published"
    description: str | None = None
    image_url: str | None = None
    external_id: str | None = None
    mediator_id: int | None = None
    property_type: str | None = None
    furnished: str | None = None


class PropertyCreate(PropertyBase):
    pass


class PartnerPropertyCreate(BaseModel):
    """Used by partners — status is always forced to Pending Approval."""
    title: str
    area: str
    city: str
    size_sq_m: int | None = None
    listing_type: str = "rent"
    monthly_rent: float | None = None
    sale_price: float | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    owner_name: str | None = None
    description: str | None = None
    property_type: str | None = None
    furnished: str | None = None


class PropertyUpdate(BaseModel):
    title: str | None = None
    area: str | None = None
    city: str | None = None
    size_sq_m: int | None = None
    listing_type: str | None = None
    monthly_rent: float | None = None
    sale_price: float | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    owner_name: str | None = None
    status: str | None = None
    description: str | None = None
    image_url: str | None = None
    external_id: str | None = None
    mediator_id: int | None = None
    property_type: str | None = None
    furnished: str | None = None


class PartnerPropertyUpdate(BaseModel):
    """Partner can only edit content fields — status is managed by the backend."""
    title: str | None = None
    area: str | None = None
    city: str | None = None
    size_sq_m: int | None = None
    listing_type: str | None = None
    monthly_rent: float | None = None
    sale_price: float | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    owner_name: str | None = None
    description: str | None = None
    property_type: str | None = None
    furnished: str | None = None


class ListingImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    display_order: int


class PropertyOut(PropertyBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    images: list[ListingImageOut] = []
    mediator_phone: str | None = None
    mediator_profile_image_url: str | None = None
    mediator_agent_name: str | None = None
