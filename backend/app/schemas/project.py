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
