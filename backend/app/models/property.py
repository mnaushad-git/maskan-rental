from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    area: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    size_sq_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    listing_type: Mapped[str] = mapped_column(String(20), nullable=False, default="rent", index=True)
    monthly_rent: Mapped[float | None] = mapped_column(Float, nullable=True)
    sale_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    bedrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="Published")
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    property_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    furnished: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mediator_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    mediator = relationship("Mediator", foreign_keys=[mediator_id], lazy="joined")
    saved_properties = relationship("SavedProperty", back_populates="property", cascade="all, delete-orphan")
    listing_images = relationship("ListingImage", back_populates="property", cascade="all, delete-orphan", order_by="ListingImage.display_order")

    @property
    def mediator_phone(self) -> str | None:
        m = self.mediator
        return m.phone if m else None

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
