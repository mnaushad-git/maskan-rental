"""add review status for moderation

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-06-27
"""

from alembic import op
import sqlalchemy as sa

revision: str = "e5f6a7b8c9d0"
down_revision: str = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reviews", sa.Column("status", sa.String(20), nullable=False, server_default="pending"))
    # Backfill the sample reviews that were seeded before moderation existed
    op.execute("UPDATE reviews SET status = 'approved'")


def downgrade() -> None:
    op.drop_column("reviews", "status")
