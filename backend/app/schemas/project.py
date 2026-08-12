from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectBase(BaseModel):
    title: str
    city: str
    area: str
    description: str | None = None
    image_url: str | None = None
    external_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: str = "Available"
    completion_status: str | None = None
    property_category: str | None = None
    price_min: float | None = None
    price_max: float | None = None
    area_min: int | None = None
    area_max: int | None = None
    unit_count: int | None = None
    intro_document_url: str | None = None
    is_featured: bool = False
    developer_name: str | None = None
    developer_logo_url: str | None = None
    mediator_id: int | None = None
    contact_phone: str | None = None
    whatsapp_phone: str | None = None
    listing_status: str = "Published"


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    title: str | None = None
    city: str | None = None
    area: str | None = None
    description: str | None = None
    image_url: str | None = None
    external_id: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: str | None = None
    completion_status: str | None = None
    property_category: str | None = None
    price_min: float | None = None
    price_max: float | None = None
    area_min: int | None = None
    area_max: int | None = None
    unit_count: int | None = None
    intro_document_url: str | None = None
    is_featured: bool | None = None
    developer_name: str | None = None
    developer_logo_url: str | None = None
    mediator_id: int | None = None
    contact_phone: str | None = None
    whatsapp_phone: str | None = None
    listing_status: str | None = None


class PartnerProjectCreate(BaseModel):
    """Used by partners — listing_status is always forced to Pending Approval."""

    title: str
    city: str
    area: str
    description: str | None = None
    image_url: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: str = "Available"
    completion_status: str | None = None
    property_category: str | None = None
    price_min: float | None = None
    price_max: float | None = None
    area_min: int | None = None
    area_max: int | None = None
    unit_count: int | None = None
    intro_document_url: str | None = None
    developer_name: str | None = None
    developer_logo_url: str | None = None
    # Mandatory — every partner-listed project must expose a way to call and
    # a way to WhatsApp, even if it's the same number for both.
    contact_phone: str
    whatsapp_phone: str


class PartnerProjectUpdate(BaseModel):
    """Partner can only edit content fields — listing_status is managed by the backend."""

    title: str | None = None
    city: str | None = None
    area: str | None = None
    description: str | None = None
    image_url: str | None = None
    status: str | None = None
    completion_status: str | None = None
    property_category: str | None = None
    price_min: float | None = None
    price_max: float | None = None
    area_min: int | None = None
    area_max: int | None = None
    unit_count: int | None = None
    intro_document_url: str | None = None
    developer_name: str | None = None
    developer_logo_url: str | None = None
    contact_phone: str | None = None
    whatsapp_phone: str | None = None


class ProjectUnitOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    unit_type: str
    price: float
    area_sq_m: int | None = None
    bedrooms: int | None = None
    bathrooms: int | None = None
    living_rooms: int | None = None
    status: str


class ProjectImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    display_order: int


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    views_count: int = 0
    units: list[ProjectUnitOut] = []
    images: list[ProjectImageOut] = []
    mediator_phone: str | None = None
    # Effective numbers the Call/WhatsApp buttons should use — project's own
    # contact_phone/whatsapp_phone, falling back to mediator_phone. See
    # Project.call_phone / Project.whatsapp_number.
    call_phone: str | None = None
    whatsapp_number: str | None = None
