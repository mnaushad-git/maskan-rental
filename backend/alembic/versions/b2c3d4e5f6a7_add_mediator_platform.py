"""add mediator platform tables

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-06-14
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── mediators ────────────────────────────────────────────────────────────
    op.create_table(
        "mediators",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("license_number", sa.String(length=100), nullable=False),
        sa.Column("agency_name", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=30), nullable=False),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("profile_image_url", sa.String(length=512), nullable=True),
        sa.Column("subscription_status", sa.String(length=30), nullable=False, server_default="inactive"),
        sa.Column("subscription_tier", sa.String(length=30), nullable=False, server_default="standard"),
        sa.Column("subscription_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("subscription_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("moyasar_card_token", sa.String(length=255), nullable=True),
        sa.Column("total_leads_accepted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", name="uq_mediators_user_id"),
    )
    op.create_index("ix_mediators_id", "mediators", ["id"])

    # ── mediator_areas ────────────────────────────────────────────────────────
    op.create_table(
        "mediator_areas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mediator_id", sa.Integer(), nullable=False),
        sa.Column("area_name", sa.String(length=100), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["mediator_id"], ["mediators.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mediator_id", "area_name", "city", name="uq_mediator_area"),
    )
    op.create_index("ix_mediator_areas_id", "mediator_areas", ["id"])
    op.create_index("ix_mediator_areas_area_name", "mediator_areas", ["area_name"])

    # ── payments ──────────────────────────────────────────────────────────────
    op.create_table(
        "payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("mediator_id", sa.Integer(), nullable=True),
        sa.Column("payment_type", sa.String(length=30), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="SAR"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("gateway", sa.String(length=30), nullable=False, server_default="moyasar"),
        sa.Column("gateway_payment_id", sa.String(length=255), nullable=True),
        sa.Column("gateway_raw", JSONB(), nullable=True),
        sa.Column("description", sa.String(length=255), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["mediator_id"], ["mediators.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("gateway_payment_id", name="uq_payments_gateway_id"),
    )
    op.create_index("ix_payments_id", "payments", ["id"])

    # ── leads ─────────────────────────────────────────────────────────────────
    op.create_table(
        "leads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("customer_user_id", sa.Integer(), nullable=False),
        sa.Column("customer_name", sa.String(length=255), nullable=False),
        sa.Column("customer_phone", sa.String(length=30), nullable=False),
        sa.Column("customer_email", sa.String(length=255), nullable=False),
        sa.Column("area_name", sa.String(length=100), nullable=False),
        sa.Column("city", sa.String(length=100), nullable=False),
        sa.Column("min_budget", sa.Float(), nullable=True),
        sa.Column("max_budget", sa.Float(), nullable=True),
        sa.Column("bedrooms_needed", sa.Integer(), nullable=True),
        sa.Column("move_in_date", sa.Date(), nullable=True),
        sa.Column("requirements_note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
        sa.Column("source", sa.String(length=50), nullable=False, server_default="web_form"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["customer_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_leads_id", "leads", ["id"])
    op.create_index("ix_leads_status", "leads", ["status"])
    op.create_index("ix_leads_area_name", "leads", ["area_name"])
    op.create_index("ix_leads_created_at", "leads", ["created_at"])

    # ── lead_suggestions ──────────────────────────────────────────────────────
    op.create_table(
        "lead_suggestions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lead_id", sa.Integer(), nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=True),
        sa.Column("match_score", sa.Float(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("lead_id", "property_id", name="uq_lead_suggestion"),
    )
    op.create_index("ix_lead_suggestions_id", "lead_suggestions", ["id"])
    op.create_index("ix_lead_suggestions_lead_id", "lead_suggestions", ["lead_id"])

    # ── lead_assignments ──────────────────────────────────────────────────────
    op.create_table(
        "lead_assignments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lead_id", sa.Integer(), nullable=False),
        sa.Column("mediator_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="pending"),
        sa.Column("assigned_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payment_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["mediator_id"], ["mediators.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["payment_id"], ["payments.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lead_assignments_id", "lead_assignments", ["id"])
    op.create_index("ix_lead_assignments_lead_id", "lead_assignments", ["lead_id"])
    op.create_index("ix_lead_assignments_mediator_id", "lead_assignments", ["mediator_id"])
    # Partial unique index: only one active assignment per lead at a time
    op.execute(
        "CREATE UNIQUE INDEX uq_lead_active_assignment ON lead_assignments(lead_id) "
        "WHERE status IN ('pending', 'accepted')"
    )

    # ── lead_messages ──────────────────────────────────────────────────────────
    op.create_table(
        "lead_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("lead_id", sa.Integer(), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), nullable=True),
        sa.Column("sender_role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lead_messages_id", "lead_messages", ["id"])
    op.create_index("ix_lead_messages_lead_id", "lead_messages", ["lead_id"])
    op.create_index("ix_lead_messages_created_at", "lead_messages", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_lead_messages_created_at", table_name="lead_messages")
    op.drop_index("ix_lead_messages_lead_id", table_name="lead_messages")
    op.drop_index("ix_lead_messages_id", table_name="lead_messages")
    op.drop_table("lead_messages")

    op.execute("DROP INDEX IF EXISTS uq_lead_active_assignment")
    op.drop_index("ix_lead_assignments_mediator_id", table_name="lead_assignments")
    op.drop_index("ix_lead_assignments_lead_id", table_name="lead_assignments")
    op.drop_index("ix_lead_assignments_id", table_name="lead_assignments")
    op.drop_table("lead_assignments")

    op.drop_index("ix_lead_suggestions_lead_id", table_name="lead_suggestions")
    op.drop_index("ix_lead_suggestions_id", table_name="lead_suggestions")
    op.drop_table("lead_suggestions")

    op.drop_index("ix_leads_created_at", table_name="leads")
    op.drop_index("ix_leads_area_name", table_name="leads")
    op.drop_index("ix_leads_status", table_name="leads")
    op.drop_index("ix_leads_id", table_name="leads")
    op.drop_table("leads")

    op.drop_index("ix_payments_id", table_name="payments")
    op.drop_table("payments")

    op.drop_index("ix_mediator_areas_area_name", table_name="mediator_areas")
    op.drop_index("ix_mediator_areas_id", table_name="mediator_areas")
    op.drop_table("mediator_areas")

    op.drop_index("ix_mediators_id", table_name="mediators")
    op.drop_table("mediators")
