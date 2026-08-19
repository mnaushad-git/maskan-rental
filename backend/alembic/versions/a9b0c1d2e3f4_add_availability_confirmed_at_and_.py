"""add availability_confirmed_at and property_reports table

Property Verification & Trust Center (Prompt 2):
- `properties.availability_confirmed_at` backs Listing Freshness's
  "Recently Confirmed" category (`app/services/listing_freshness.py`,
  inert until this column carries a real value — Prompt 3's partner
  "Confirm Availability" action will start writing it).
- `property_reports` backs the "Report a Concern" flow (spec section 24) —
  Open -> Under Review -> Resolved/Dismissed, reviewed later by admin
  moderation (Prompt 6). No auto-hide/merge/delete lands with this
  migration; the table is purely a record for a human to act on.

Revision ID: a9b0c1d2e3f4
Revises: 54726095b122
Create Date: 2026-08-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9b0c1d2e3f4"
down_revision: Union[str, None] = "54726095b122"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "properties",
        sa.Column("availability_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "property_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reporter_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reason", sa.String(length=50), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="Open"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
    )
    op.create_index("ix_property_reports_property_id", "property_reports", ["property_id"])
    op.create_index("ix_property_reports_reporter_user_id", "property_reports", ["reporter_user_id"])
    op.create_index("ix_property_reports_status", "property_reports", ["status"])


def downgrade() -> None:
    op.drop_index("ix_property_reports_status", table_name="property_reports")
    op.drop_index("ix_property_reports_reporter_user_id", table_name="property_reports")
    op.drop_index("ix_property_reports_property_id", table_name="property_reports")
    op.drop_table("property_reports")
    op.drop_column("properties", "availability_confirmed_at")
