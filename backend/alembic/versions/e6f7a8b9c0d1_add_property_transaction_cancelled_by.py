"""add cancelled_by to property_transactions

Rental/Buy Transaction Workspace (Prompt 4): the customer-facing cancel
action needs to record which of the three possible parties (customer,
mediator, admin) cancelled — Prompt 2 deliberately omitted this column (see
its own "Known limitations" note); this migration adds it as a plain
nullable column, no backfill needed since no PropertyTransaction could have
been cancelled before this column existed.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Create Date: 2026-09-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6f7a8b9c0d1"
down_revision: Union[str, None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("property_transactions", sa.Column("cancelled_by", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("property_transactions", "cancelled_by")
