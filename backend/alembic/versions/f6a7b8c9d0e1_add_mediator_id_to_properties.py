"""add mediator_id to properties and listing_images table

Idempotent: some databases (e.g. long-lived dev DBs created directly from the
models) already have these objects, while fresh migrate-from-scratch deploys do
not. Guards let the same migration succeed in both cases.

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


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return column in {c["name"] for c in insp.get_columns(table)}


def _has_table(table: str) -> bool:
    return sa.inspect(op.get_bind()).has_table(table)


def upgrade() -> None:
    if not _has_column("properties", "mediator_id"):
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

    if not _has_table("listing_images"):
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
    if _has_table("listing_images"):
        op.drop_index("ix_listing_images_property_id", table_name="listing_images")
        op.drop_index("ix_listing_images_id", table_name="listing_images")
        op.drop_table("listing_images")

    if _has_column("properties", "mediator_id"):
        op.drop_constraint("fk_properties_mediator_id", "properties", type_="foreignkey")
        op.drop_index("ix_properties_mediator_id", table_name="properties")
        op.drop_column("properties", "mediator_id")
