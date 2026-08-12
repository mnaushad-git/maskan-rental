from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, computed_field


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
    latitude: float | None = None
    longitude: float | None = None
    living_rooms: int | None = None
    property_age_years: int | None = None
    commission_percent: float | None = None
    has_kitchen: bool = False
    has_water: bool = False
    has_electricity: bool = False
    has_private_roof: bool = False
    in_villa: bool = False
    has_two_entrances: bool = False
    has_separate_electrical_meter: bool = False
    license_number: str | None = None
    license_expiration_date: date | None = None
    deed_area: int | None = None
    contact_phone: str | None = None
    whatsapp_phone: str | None = None
    is_bookable: bool = False
    nightly_rate: float | None = None
    has_elevator: bool = False
    has_airconditioners: bool = False
    arrival_time: str | None = None
    departure_time: str | None = None
    latest_booking_time: str | None = None
    insurance_amount: float = 0


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
    living_rooms: int | None = None
    property_age_years: int | None = None
    commission_percent: float | None = None
    has_kitchen: bool = False
    has_water: bool = False
    has_electricity: bool = False
    has_private_roof: bool = False
    in_villa: bool = False
    has_two_entrances: bool = False
    has_separate_electrical_meter: bool = False
    license_number: str | None = None
    deed_area: int | None = None
    # Mandatory — every partner listing must expose a way to call and a way
    # to WhatsApp the agent/owner, even if it's the same number for both.
    contact_phone: str
    whatsapp_phone: str


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
    latitude: float | None = None
    longitude: float | None = None
    living_rooms: int | None = None
    property_age_years: int | None = None
    commission_percent: float | None = None
    has_kitchen: bool | None = None
    has_water: bool | None = None
    has_electricity: bool | None = None
    has_private_roof: bool | None = None
    in_villa: bool | None = None
    has_two_entrances: bool | None = None
    has_separate_electrical_meter: bool | None = None
    license_number: str | None = None
    license_expiration_date: date | None = None
    deed_area: int | None = None
    contact_phone: str | None = None
    whatsapp_phone: str | None = None
    is_bookable: bool | None = None
    nightly_rate: float | None = None
    has_elevator: bool | None = None
    has_airconditioners: bool | None = None
    arrival_time: str | None = None
    departure_time: str | None = None
    latest_booking_time: str | None = None
    insurance_amount: float | None = None


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
    living_rooms: int | None = None
    property_age_years: int | None = None
    commission_percent: float | None = None
    has_kitchen: bool | None = None
    has_water: bool | None = None
    has_electricity: bool | None = None
    has_private_roof: bool | None = None
    in_villa: bool | None = None
    has_two_entrances: bool | None = None
    has_separate_electrical_meter: bool | None = None
    license_number: str | None = None
    deed_area: int | None = None
    contact_phone: str | None = None
    whatsapp_phone: str | None = None


class ListingImageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    display_order: int


class PropertyOut(PropertyBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    views_count: int = 0
    # ORM relationship is named `listing_images`, not `images` — without this
    # alias, from_attributes silently falls back to the [] default instead
    # of raising, so every response's images list was empty regardless of
    # actual data.
    images: list[ListingImageOut] = Field(default=[], validation_alias="listing_images")
    mediator_phone: str | None = None
    # Effective numbers the Call/WhatsApp buttons should use — listing's own
    # contact_phone/whatsapp_phone, falling back to mediator_phone for rows
    # created before these per-listing fields existed. See Property.call_phone
    # / Property.whatsapp_number.
    call_phone: str | None = None
    whatsapp_number: str | None = None
    mediator_profile_image_url: str | None = None
    mediator_agent_name: str | None = None
    mediator_is_verified: bool = False
    # Schema-only — not ORM columns. Populated manually by the route handler
    # (GET /{property_id}) via a single reviews-summary lookup, so the list
    # endpoint (which also returns PropertyOut) never pays that extra query
    # cost per row.
    mediator_rating: float | None = None
    mediator_review_count: int = 0

    # `Property.listing_type` predates `transaction_type`, the field name used
    # by PropertyRequest/SavedSearch for the same rent/sale concept (see
    # docs/implementation/mymakan-phase1.md "Database impact"). Renaming the
    # column would be a breaking/destructive change for existing API
    # consumers, so this is an additive, read-only alias: API responses carry
    # both `listing_type` (unchanged) and `transaction_type` (new, mirrors
    # it) so myMakan Phase-1 clients can standardize on one field name.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def transaction_type(self) -> str:
        return self.listing_type
