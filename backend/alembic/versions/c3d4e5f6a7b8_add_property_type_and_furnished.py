"""add property_type and furnished to properties

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-06-27
"""
from alembic import op
import sqlalchemy as sa

revision: str = "c3d4e5f6a7b8"
down_revision: str = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("property_type", sa.String(50), nullable=True))
    op.add_column("properties", sa.Column("furnished", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("properties", "furnished")
    op.drop_column("properties", "property_type")
