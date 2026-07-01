"""reconcile users and leads model drift

Idempotent: adds columns only where missing, so it works on both fresh
databases and long-lived dev DBs that already have these columns.

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


def _has_column(table: str, column: str) -> bool:
    insp = sa.inspect(op.get_bind())
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    if not _has_column("users", "phone"):
        op.add_column("users", sa.Column("phone", sa.String(length=30), nullable=True))
    if not _has_column("users", "is_active"):
        op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"))
    if not _has_column("users", "is_admin"):
        op.add_column("users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="false"))

    if not _has_column("leads", "closure_outcome"):
        op.add_column("leads", sa.Column("closure_outcome", sa.String(length=30), nullable=True))
    if not _has_column("leads", "closure_note"):
        op.add_column("leads", sa.Column("closure_note", sa.Text(), nullable=True))
    if not _has_column("leads", "closure_requested_at"):
        op.add_column("leads", sa.Column("closure_requested_at", sa.DateTime(timezone=True), nullable=True))
    if not _has_column("leads", "closure_requested_by_mediator_id"):
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
    if _has_column("leads", "closure_requested_by_mediator_id"):
        op.drop_constraint("fk_leads_closure_requested_by_mediator_id", "leads", type_="foreignkey")
        op.drop_column("leads", "closure_requested_by_mediator_id")
    if _has_column("leads", "closure_requested_at"):
        op.drop_column("leads", "closure_requested_at")
    if _has_column("leads", "closure_note"):
        op.drop_column("leads", "closure_note")
    if _has_column("leads", "closure_outcome"):
        op.drop_column("leads", "closure_outcome")

    if _has_column("users", "is_admin"):
        op.drop_column("users", "is_admin")
    if _has_column("users", "is_active"):
        op.drop_column("users", "is_active")
    if _has_column("users", "phone"):
        op.drop_column("users", "phone")
