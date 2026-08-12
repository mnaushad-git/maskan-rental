from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    external_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    city: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    area: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="Available", index=True)
    completion_status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    property_category: Mapped[str | None] = mapped_column(String(50), nullable=True)
    price_min: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    area_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    area_max: Mapped[int | None] = mapped_column(Integer, nullable=True)
    unit_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    intro_document_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    is_featured: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    developer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    developer_logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    views_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    mediator_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True, index=True)

    # Listing-specific contact numbers — partners must supply both when
    # creating a project (see PartnerProjectCreate), mirrors Property.
    contact_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    whatsapp_phone: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Moderation workflow, separate from `status` (which means
    # "Available"/"Sold Out" — an availability badge, not a publish gate).
    # Mirrors Property.status's Draft/Pending Approval/Published/Suspended/
    # Rejected values. Defaults to Published so pre-existing/admin-seeded
    # rows keep behaving exactly as before.
    listing_status: Mapped[str] = mapped_column(String(50), nullable=False, default="Published", index=True)

    units: Mapped[list["ProjectUnit"]] = relationship("ProjectUnit", back_populates="project", cascade="all, delete-orphan")
    images: Mapped[list["ProjectImage"]] = relationship(
        "ProjectImage", back_populates="project", cascade="all, delete-orphan", order_by="ProjectImage.display_order"
    )
    mediator = relationship("Mediator", foreign_keys=[mediator_id], lazy="joined")

    @property
    def mediator_phone(self) -> str | None:
        m = self.mediator
        return m.phone if m else None

    @property
    def call_phone(self) -> str | None:
        """Effective number for the Call button — project's own number,
        falling back to the mediator's account phone."""
        return self.contact_phone or self.mediator_phone

    @property
    def whatsapp_number(self) -> str | None:
        """Effective number for the WhatsApp button — same fallback chain
        as call_phone, but prefers a project-specific WhatsApp number."""
        return self.whatsapp_phone or self.contact_phone or self.mediator_phone


class ProjectUnit(Base):
    __tablename__ = "project_units"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    unit_type: Mapped[str] = mapped_column(String(50), nullable=False)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    area_sq_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bedrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    living_rooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="Available")

    project: Mapped["Project"] = relationship("Project", back_populates="units")


class ProjectImage(Base):
    __tablename__ = "project_images"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(1024), nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    project: Mapped["Project"] = relationship("Project", back_populates="images")
