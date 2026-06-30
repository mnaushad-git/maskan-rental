"""add mediator approval_status

New self-registered partners require admin approval before they can access the
portal. Adds approval_status ("pending" | "approved" | "rejected"). Existing
partners are backfilled to "approved" so current access is not interrupted.

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-06-30 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c9d0e1f2a3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "mediators",
        sa.Column("approval_status", sa.String(length=20), nullable=False, server_default="pending"),
    )
    # Existing partners predate the approval gate — treat them as already approved.
    op.execute("UPDATE mediators SET approval_status = 'approved'")


def downgrade() -> None:
    op.drop_column("mediators", "approval_status")
