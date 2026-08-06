"""add renter identity verification fields to users

Renter identity verification (Nafath-style, mocked): a renter submits a
document reference, an admin approves/rejects — mirrors the existing
Mediator.is_verified/approval_status pattern.

Revision ID: a1b2c3d4e5f7
Revises: f1a2b3c4d5e6
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f7"
down_revision: str = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("verification_status", sa.String(length=20), nullable=False, server_default="unverified"))
    op.add_column("users", sa.Column("is_verified", sa.Boolean, nullable=False, server_default="false"))
    op.add_column("users", sa.Column("verification_document_ref", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("verification_submitted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("verification_reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_verification_status", "users", ["verification_status"])


def downgrade() -> None:
    op.drop_index("ix_users_verification_status", table_name="users")
    op.drop_column("users", "verification_reviewed_at")
    op.drop_column("users", "verification_submitted_at")
    op.drop_column("users", "verification_document_ref")
    op.drop_column("users", "is_verified")
    op.drop_column("users", "verification_status")
