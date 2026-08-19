"""add cancellation_reason and cancelled_by to property_negotiations

AI Negotiation & Offer Management (Prompt 3): these two columns were missed
in Prompt 1's field list. `withdraw_negotiation()`
(app/services/property_negotiation.py) sets both when a customer withdraws;
`cancelled_by` is added now for symmetry with the reject-side actor a later
prompt (mediator rejection) also needs. See
docs/implementation/mymakan-negotiations.md.

Revision ID: c2d3e4f5a6b7
Revises: 05cf5fee7bd3
Create Date: 2026-08-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2d3e4f5a6b7"
down_revision: Union[str, None] = "05cf5fee7bd3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("property_negotiations", sa.Column("cancellation_reason", sa.String(length=255), nullable=True))
    op.add_column("property_negotiations", sa.Column("cancelled_by", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("property_negotiations", "cancelled_by")
    op.drop_column("property_negotiations", "cancellation_reason")
