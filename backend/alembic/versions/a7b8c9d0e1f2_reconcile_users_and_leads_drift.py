"""reconcile users and leads model drift

Adds columns that exist in the models but were never created by a migration,
so a fresh migrate-from-scratch deploy matches the models:
- users.phone, users.is_active, users.is_admin
- leads closure columns (outcome, note, requested_at, requested_by_mediator_id)

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-06-30 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users: auth/profile columns added to the model after initial migration ──
    op.add_column("users", sa.Column("phone", sa.String(length=30), nullable=True))
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"))
    op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="false"))

    # ── leads: closure workflow columns ────────────────────────────────────────
    op.add_column("leads", sa.Column("closure_outcome", sa.String(length=30), nullable=True))
    op.add_column("leads", sa.Column("closure_note", sa.Text(), nullable=True))
    op.add_column("leads", sa.Column("closure_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("leads", sa.Column("closure_requested_by_mediator_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_leads_closure_requested_by_mediator_id",
        "leads",
        "mediators",
        ["closure_requested_by_mediator_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_leads_closure_requested_by_mediator_id", "leads", type_="foreignkey")
    op.drop_column("leads", "closure_requested_by_mediator_id")
    op.drop_column("leads", "closure_requested_at")
    op.drop_column("leads", "closure_note")
    op.drop_column("leads", "closure_outcome")

    op.drop_column("users", "is_admin")
    op.drop_column("users", "is_active")
    op.drop_column("users", "phone")
