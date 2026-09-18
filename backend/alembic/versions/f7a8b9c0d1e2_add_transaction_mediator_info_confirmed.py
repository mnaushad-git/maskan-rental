"""add mediator_info_confirmed_at to property_transactions

Rental/Buy Transaction Workspace (Prompt 5): the mediator-side "property and
commercial information confirmed" timestamp, storage-only counterpart to
customer_info_confirmed_at — separate column since confirmation is per-actor,
not shared. No backfill needed since no PropertyTransaction could have been
mediator-confirmed before this column existed.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7a8b9c0d1e2"
down_revision: Union[str, None] = "e6f7a8b9c0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("property_transactions", sa.Column("mediator_info_confirmed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("property_transactions", "mediator_info_confirmed_at")
