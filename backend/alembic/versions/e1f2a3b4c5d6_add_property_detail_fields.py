"""add property detail fields (Aqar-style detail page)

Adds living_rooms, property_age_years, commission_percent, a 7-flag features
checklist (kitchen/water/electricity/private roof/in-villa/two entrances/
separate electrical meter), per-listing license_number/license_expiration_date,
deed_area, views_count, and updated_at to properties — backing the richer
Aqar-style property details page (Property Information, Property Features,
Listing details panel).

Revision ID: e1f2a3b4c5d6
Revises: d2e3f4a5b6c7
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

revision: str = "e1f2a3b4c5d6"
down_revision: str = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("living_rooms", sa.Integer(), nullable=True))
    op.add_column("properties", sa.Column("property_age_years", sa.Integer(), nullable=True))
    op.add_column("properties", sa.Column("commission_percent", sa.Float(), nullable=True))
    op.add_column("properties", sa.Column("has_kitchen", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("has_water", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("has_electricity", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("has_private_roof", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("in_villa", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("has_two_entrances", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("has_separate_electrical_meter", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("license_number", sa.String(length=100), nullable=True))
    op.add_column("properties", sa.Column("license_expiration_date", sa.Date(), nullable=True))
    op.add_column("properties", sa.Column("deed_area", sa.Integer(), nullable=True))
    op.add_column("properties", sa.Column("views_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column(
        "properties",
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("properties", "updated_at")
    op.drop_column("properties", "views_count")
    op.drop_column("properties", "deed_area")
    op.drop_column("properties", "license_expiration_date")
    op.drop_column("properties", "license_number")
    op.drop_column("properties", "has_separate_electrical_meter")
    op.drop_column("properties", "has_two_entrances")
    op.drop_column("properties", "in_villa")
    op.drop_column("properties", "has_private_roof")
    op.drop_column("properties", "has_electricity")
    op.drop_column("properties", "has_water")
    op.drop_column("properties", "has_kitchen")
    op.drop_column("properties", "commission_percent")
    op.drop_column("properties", "property_age_years")
    op.drop_column("properties", "living_rooms")
