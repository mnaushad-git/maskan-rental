from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    area: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    city: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    size_sq_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    listing_type: Mapped[str] = mapped_column(String(20), nullable=False, default="rent", index=True)
    monthly_rent: Mapped[float | None] = mapped_column(Float, nullable=True)
    sale_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    bedrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="Published", index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    property_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    furnished: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mediator_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True, index=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    living_rooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    property_age_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    commission_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    has_kitchen: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_water: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_electricity: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_private_roof: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    in_villa: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_two_entrances: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_separate_electrical_meter: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    license_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    license_expiration_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deed_area: Mapped[int | None] = mapped_column(Integer, nullable=True)
    views_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Short-term "bookable stay" fields — see Booking model. A property is
    # browsable in the mobile Bookings tab only when is_bookable is set;
    # nightly_rate is the real per-night price when set, else callers fall
    # back to a monthly_rent-derived heuristic (see BookingCalendar.tsx).
    is_bookable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    nightly_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    has_elevator: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    has_airconditioners: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    arrival_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    departure_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    latest_booking_time: Mapped[str | None] = mapped_column(String(20), nullable=True)
    insurance_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)

    # Listing-specific contact numbers — partners must supply both when
    # creating a listing (see PartnerPropertyCreate) so the call and
    # WhatsApp buttons on a property can point at different numbers
    # (e.g. an owner's call number vs. an agency WhatsApp Business line).
    contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    whatsapp_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Property Verification & Trust Center (Prompt 2) — set by the partner
    # portal's "Confirm Availability" action (Prompt 3's
    # POST /partner/properties/{id}/confirm-availability). Feeds Listing
    # Freshness's "Recently Confirmed" category — see
    # app/services/listing_freshness.py, which already reads this via
    # getattr(..., None) so it was safe to add after that service shipped.
    availability_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    mediator = relationship("Mediator", foreign_keys=[mediator_id], lazy="joined")
    saved_properties = relationship("SavedProperty", back_populates="property", cascade="all, delete-orphan")
    listing_images = relationship("ListingImage", back_populates="property", cascade="all, delete-orphan", order_by="ListingImage.display_order")
    reports = relationship("PropertyReport", back_populates="property", cascade="all, delete-orphan")

    @property
    def mediator_phone(self) -> str | None:
        m = self.mediator
        return m.phone if m else None

    @property
    def call_phone(self) -> str | None:
        """Effective number for the Call button — listing's own number,
        falling back to the mediator's account phone for rows created
        before per-listing contact fields existed."""
        return self.contact_phone or self.mediator_phone

    @property
    def whatsapp_number(self) -> str | None:
        """Effective number for the WhatsApp button — same fallback chain
        as call_phone, but prefers a listing-specific WhatsApp number."""
        return self.whatsapp_phone or self.contact_phone or self.mediator_phone

    @property
    def mediator_profile_image_url(self) -> str | None:
        m = self.mediator
        return m.profile_image_url if m else None

    @property
    def mediator_agent_name(self) -> str | None:
        m = self.mediator
        if not m:
            return self.owner_name
        return m.agency_name or self.owner_name

    @property
    def mediator_is_verified(self) -> bool:
        m = self.mediator
        return bool(m.is_verified) if m else False
