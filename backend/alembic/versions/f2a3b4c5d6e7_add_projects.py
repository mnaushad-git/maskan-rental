"""add projects, project_units, project_images tables

Adds the off-plan "Projects" feature (developments with multiple sale
units) as a new domain parallel to Property — projects, their sale units,
and their gallery images.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-08-07

"""
from alembic import op
import sqlalchemy as sa

revision: str = "f2a3b4c5d6e7"
down_revision: str = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("external_id", sa.String(length=100), nullable=True, unique=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False, index=True),
        sa.Column("area", sa.String(length=100), nullable=False, index=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("image_url", sa.String(length=512), nullable=True),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="Available"),
        sa.Column("completion_status", sa.String(length=50), nullable=True),
        sa.Column("property_category", sa.String(length=50), nullable=True),
        sa.Column("price_min", sa.Float(), nullable=True),
        sa.Column("price_max", sa.Float(), nullable=True),
        sa.Column("area_min", sa.Integer(), nullable=True),
        sa.Column("area_max", sa.Integer(), nullable=True),
        sa.Column("unit_count", sa.Integer(), nullable=True),
        sa.Column("intro_document_url", sa.String(length=512), nullable=True),
        sa.Column("is_featured", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("developer_name", sa.String(length=255), nullable=True),
        sa.Column("developer_logo_url", sa.String(length=512), nullable=True),
        sa.Column("views_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_projects_status", "projects", ["status"])

    op.create_table(
        "project_units",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("unit_type", sa.String(length=50), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("area_sq_m", sa.Integer(), nullable=True),
        sa.Column("bedrooms", sa.Integer(), nullable=True),
        sa.Column("bathrooms", sa.Integer(), nullable=True),
        sa.Column("living_rooms", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="Available"),
    )

    op.create_table(
        "project_images",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("url", sa.String(length=1024), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("project_images")
    op.drop_table("project_units")
    op.drop_index("ix_projects_status", table_name="projects")
    op.drop_table("projects")
