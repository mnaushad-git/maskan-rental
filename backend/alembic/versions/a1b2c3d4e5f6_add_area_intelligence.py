"""add area_intelligence table

Revision ID: a1b2c3d4e5f6
Revises: 3f8b2a1c9d7e
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "a1b2c3d4e5f6"
down_revision = "3f8b2a1c9d7e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "area_intelligence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("area_name", sa.String(length=100), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("center_lat", sa.Float(), nullable=True),
        sa.Column("center_lng", sa.Float(), nullable=True),
        sa.Column("schools", JSONB(), nullable=False, server_default="[]"),
        sa.Column("hospitals", JSONB(), nullable=False, server_default="[]"),
        sa.Column("lifestyle", JSONB(), nullable=False, server_default="{}"),
        sa.Column("commute_minutes_to_center", sa.Integer(), nullable=True),
        sa.Column("school_score", sa.Float(), nullable=True),
        sa.Column("healthcare_score", sa.Float(), nullable=True),
        sa.Column("lifestyle_score", sa.Float(), nullable=True),
        sa.Column("traffic_score", sa.Float(), nullable=True),
        sa.Column("family_score", sa.Float(), nullable=True),
        sa.Column("area_score", sa.Float(), nullable=True),
        sa.Column("rent_trend", JSONB(), nullable=False, server_default="[]"),
        sa.Column("tags", JSONB(), nullable=False, server_default="[]"),
        sa.Column("overview", sa.Text(), nullable=True),
        sa.Column("market_notes", JSONB(), nullable=False, server_default="[]"),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("area_name", "city", name="uq_area_intelligence_area_city"),
    )
    op.create_index("ix_area_intelligence_id", "area_intelligence", ["id"])
    op.create_index("ix_area_intelligence_area_name", "area_intelligence", ["area_name"])


def downgrade() -> None:
    op.drop_index("ix_area_intelligence_area_name", table_name="area_intelligence")
    op.drop_index("ix_area_intelligence_id", table_name="area_intelligence")
    op.drop_table("area_intelligence")
