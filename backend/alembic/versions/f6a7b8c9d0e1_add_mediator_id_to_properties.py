"""add mediator_id to properties and listing_images table

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-06-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("mediator_id", sa.Integer(), nullable=True))
    op.create_index("ix_properties_mediator_id", "properties", ["mediator_id"])
    op.create_foreign_key(
        "fk_properties_mediator_id",
        "properties",
        "mediators",
        ["mediator_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "listing_images",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_listing_images_id", "listing_images", ["id"])
    op.create_index("ix_listing_images_property_id", "listing_images", ["property_id"])


def downgrade() -> None:
    op.drop_index("ix_listing_images_property_id", table_name="listing_images")
    op.drop_index("ix_listing_images_id", table_name="listing_images")
    op.drop_table("listing_images")

    op.drop_constraint("fk_properties_mediator_id", "properties", type_="foreignkey")
    op.drop_index("ix_properties_mediator_id", table_name="properties")
    op.drop_column("properties", "mediator_id")
