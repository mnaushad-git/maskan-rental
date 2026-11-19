"""add deleted_at to users (self-service account deletion)

Google Play account-deletion requirement: a customer can delete their own
account. The users row itself is never removed — bookings, contracts, leads,
negotiations, transactions and viewings reference it with ON DELETE RESTRICT
and must be retained — so deletion deactivates and anonymizes the row and
stamps this column. NULL for every existing user (no backfill needed);
nullable, so the upgrade is a metadata-only change on PostgreSQL.

Revision ID: a1c2d3e4f5a6
Revises: f7a8b9c0d1e2
Create Date: 2026-11-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1c2d3e4f5a6"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "deleted_at")
