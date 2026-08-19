"""add property_viewings table

Visit & Viewing Management (Prompt 1): `PropertyViewing` — a customer's
request to visit a listed property in person, tracked through mediator
confirmation/reschedule/cancellation/completion. See
docs/implementation/mymakan-viewings.md.

Revision ID: b1c2d3e4f5a6
Revises: a9b0c1d2e3f4
Create Date: 2026-08-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "a9b0c1d2e3f4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "property_viewings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("customer_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("mediator_id", sa.Integer(), sa.ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True),
        sa.Column("lead_id", sa.Integer(), sa.ForeignKey("leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("requested_start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("requested_end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("confirmed_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("timezone", sa.String(length=50), nullable=False, server_default="Asia/Riyadh"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="requested"),
        sa.Column("customer_note", sa.Text(), nullable=True),
        sa.Column("mediator_note", sa.Text(), nullable=True),
        sa.Column("cancellation_reason", sa.String(length=255), nullable=True),
        sa.Column("cancelled_by", sa.String(length=20), nullable=True),
        sa.Column("proposed_start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proposed_end_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proposed_by", sa.String(length=20), nullable=True),
        sa.Column("last_reminder_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("checklist_state", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("private_notes", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("interest_level", sa.String(length=30), nullable=True),
        sa.Column("feedback_reason", sa.String(length=50), nullable=True),
        sa.Column("feedback_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_property_viewings_id", "property_viewings", ["id"])
    op.create_index("ix_property_viewings_status", "property_viewings", ["status"])
    op.create_index("ix_property_viewings_customer_status", "property_viewings", ["customer_user_id", "status"])
    op.create_index("ix_property_viewings_mediator_status", "property_viewings", ["mediator_id", "status"])
    op.create_index("ix_property_viewings_property_customer", "property_viewings", ["property_id", "customer_user_id"])


def downgrade() -> None:
    op.drop_index("ix_property_viewings_property_customer", table_name="property_viewings")
    op.drop_index("ix_property_viewings_mediator_status", table_name="property_viewings")
    op.drop_index("ix_property_viewings_customer_status", table_name="property_viewings")
    op.drop_index("ix_property_viewings_status", table_name="property_viewings")
    op.drop_index("ix_property_viewings_id", table_name="property_viewings")
    op.drop_table("property_viewings")
