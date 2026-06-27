"""add saved_properties

Revision ID: d0fb4f2214c4
Revises: ec56faf6d81a
Create Date: 2026-06-11 15:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d0fb4f2214c4"
down_revision: Union[str, None] = "ec56faf6d81a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "saved_properties",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("viewing_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "property_id", name="uq_saved_properties_user_property"),
    )
    op.create_index(op.f("ix_saved_properties_id"), "saved_properties", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_saved_properties_id"), table_name="saved_properties")
    op.drop_table("saved_properties")