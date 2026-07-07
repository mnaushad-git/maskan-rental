"""add listing_type and sale_price to properties

Revision ID: 5b349ad81065
Revises: b8c9d0e1f2a3
Create Date: 2026-07-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "5b349ad81065"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "properties",
        sa.Column("listing_type", sa.String(length=20), nullable=False, server_default="rent"),
    )
    op.add_column("properties", sa.Column("sale_price", sa.Float(), nullable=True))
    # Sale listings don't have a monthly rent — rent listings don't have a sale price.
    op.alter_column("properties", "monthly_rent", existing_type=sa.Float(), nullable=True)
    op.create_index("ix_properties_listing_type", "properties", ["listing_type"])


def downgrade() -> None:
    op.drop_index("ix_properties_listing_type", table_name="properties")
    op.alter_column("properties", "monthly_rent", existing_type=sa.Float(), nullable=False)
    op.drop_column("properties", "sale_price")
    op.drop_column("properties", "listing_type")
