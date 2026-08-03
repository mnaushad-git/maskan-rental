"""add price, created_at and review status indexes

Revision ID: d9cc3f7d7dc6
Revises: 9b1e2f4a7c6d
Create Date: 2026-08-03 09:59:02.436784

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9cc3f7d7dc6'
down_revision: Union[str, None] = '9b1e2f4a7c6d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Price columns are filtered (min/max_monthly_rent, min/max_sale_price)
    # and sorted on (ai.py rent_summary) but had no index.
    op.create_index("ix_properties_monthly_rent", "properties", ["monthly_rent"])
    op.create_index("ix_properties_sale_price", "properties", ["sale_price"])

    # Newest-first sort (leads.py suggested_properties, and any future
    # "recently listed" view) had no supporting index.
    op.create_index("ix_properties_created_at", "properties", ["created_at"])

    # Covers the common search+sort pattern: filter by status/listing_type/
    # city, order by price. `ix_properties_status_city_area` already covers
    # the area-search path; this one is for the price-bounded browse path.
    op.create_index(
        "ix_properties_status_listing_type_city_rent",
        "properties",
        ["status", "listing_type", "city", "monthly_rent"],
    )

    # Review moderation queue filters on status alone (no mediator_id) —
    # `ix_reviews_mediator_id` doesn't help that query.
    op.create_index("ix_reviews_status", "reviews", ["status"])
    # Public per-mediator "approved reviews" list filters on both columns.
    op.create_index("ix_reviews_mediator_id_status", "reviews", ["mediator_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_reviews_mediator_id_status", table_name="reviews")
    op.drop_index("ix_reviews_status", table_name="reviews")
    op.drop_index("ix_properties_status_listing_type_city_rent", table_name="properties")
    op.drop_index("ix_properties_created_at", table_name="properties")
    op.drop_index("ix_properties_sale_price", table_name="properties")
    op.drop_index("ix_properties_monthly_rent", table_name="properties")
