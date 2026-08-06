"""add renter premium tier subscription fields to users

Renter-facing premium tier ("AI Alert Plus") — mirrors the existing
Mediator.subscription_status/subscription_tier pattern, applied to User so
renters can subscribe independently of the mediator (B2B) subscription.

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f7
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

revision: str = "b3c4d5e6f7a8"
down_revision: str = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("subscription_status", sa.String(length=30), nullable=False, server_default="inactive"))
    op.add_column("users", sa.Column("subscription_tier", sa.String(length=30), nullable=False, server_default="free"))
    op.add_column("users", sa.Column("subscription_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("subscription_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("moyasar_card_token", sa.String(length=255), nullable=True))
    op.create_index("ix_users_subscription_status", "users", ["subscription_status"])


def downgrade() -> None:
    op.drop_index("ix_users_subscription_status", table_name="users")
    op.drop_column("users", "moyasar_card_token")
    op.drop_column("users", "subscription_expires_at")
    op.drop_column("users", "subscription_started_at")
    op.drop_column("users", "subscription_tier")
    op.drop_column("users", "subscription_status")
