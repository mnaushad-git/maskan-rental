"""add ai_call_logs table

Revision ID: 36ee978d2668
Revises: ef9e9695e9a6
Create Date: 2026-08-03 10:53:19.406723

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '36ee978d2668'
down_revision: Union[str, None] = 'ef9e9695e9a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ai_call_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("feature", sa.String(50), nullable=False),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("prompt_name", sa.String(50), nullable=False),
        sa.Column("prompt_version", sa.Integer, nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("latency_ms", sa.Float, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("cost_estimate_usd", sa.Float, nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ai_call_logs_feature", "ai_call_logs", ["feature"])
    op.create_index("ix_ai_call_logs_created_at", "ai_call_logs", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_call_logs_created_at", table_name="ai_call_logs")
    op.drop_index("ix_ai_call_logs_feature", table_name="ai_call_logs")
    op.drop_table("ai_call_logs")
