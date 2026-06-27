"""add property admin fields

Revision ID: ef6ab9384c7e
Revises: d0fb4f2214c4
Create Date: 2026-06-11 16:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ef6ab9384c7e"
down_revision: Union[str, None] = "d0fb4f2214c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("size_sq_m", sa.Integer(), nullable=True))
    op.add_column("properties", sa.Column("owner_name", sa.String(length=255), nullable=True))
    op.add_column("properties", sa.Column("status", sa.String(length=50), nullable=False, server_default="Published"))


def downgrade() -> None:
    op.drop_column("properties", "status")
    op.drop_column("properties", "owner_name")
    op.drop_column("properties", "size_sq_m")