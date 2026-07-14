"""add status/city indexes and trigram search indexes on properties

Revision ID: 4dcd64629c12
Revises: 5b349ad81065
Create Date: 2026-07-13
"""
from alembic import op

revision: str = "4dcd64629c12"
down_revision: str = "5b349ad81065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_index("ix_properties_status", "properties", ["status"])
    op.create_index("ix_properties_city", "properties", ["city"])
    op.create_index("ix_properties_status_city_area", "properties", ["status", "city", "area"])

    # Trigram GIN indexes accelerate ILIKE '%word%' substring search — a plain
    # btree index (like the existing one on `area`) can't be used once the
    # pattern has a leading wildcard.
    op.execute("CREATE INDEX ix_properties_title_trgm ON properties USING gin (title gin_trgm_ops)")
    op.execute("CREATE INDEX ix_properties_description_trgm ON properties USING gin (description gin_trgm_ops)")
    op.execute("CREATE INDEX ix_properties_area_trgm ON properties USING gin (area gin_trgm_ops)")
    op.execute("CREATE INDEX ix_properties_city_trgm ON properties USING gin (city gin_trgm_ops)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_properties_city_trgm")
    op.execute("DROP INDEX IF EXISTS ix_properties_area_trgm")
    op.execute("DROP INDEX IF EXISTS ix_properties_description_trgm")
    op.execute("DROP INDEX IF EXISTS ix_properties_title_trgm")
    op.drop_index("ix_properties_status_city_area", table_name="properties")
    op.drop_index("ix_properties_city", table_name="properties")
    op.drop_index("ix_properties_status", table_name="properties")
