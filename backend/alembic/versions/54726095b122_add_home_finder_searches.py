"""add home_finder_searches table

Backs the AI Home Finder's "Recent AI Searches" history (Section 14) — one
row per signed-in user's AI Home Finder search, storing the free-text query
and the structured criteria it resolved to. Not SavedSearch: no
alerting/matching lifecycle, just a lightweight snapshot.

Revision ID: 54726095b122
Revises: d1e2f3a4b5c6
Create Date: 2026-08-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "54726095b122"
down_revision: Union[str, None] = "d1e2f3a4b5c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "home_finder_searches",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("query_text", sa.String(length=500), nullable=False),
        sa.Column("criteria", postgresql.JSONB, nullable=False),
        sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_home_finder_searches_user_id", "home_finder_searches", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_home_finder_searches_user_id", table_name="home_finder_searches")
    op.drop_table("home_finder_searches")
