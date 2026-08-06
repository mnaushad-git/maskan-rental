"""add financing_interests table

Rent financing / pay-later interest-capture waitlist (lowest-priority Aqar
gap — no real financing partner is confirmed yet, so this is a stub: no real
payment integration, just a renter's stated budget for a property plus the
AI Affordability Advisor's note generated at submission time.

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

revision: str = "d2e3f4a5b6c7"
down_revision: str = "c1d2e3f4a5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "financing_interests",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("renter_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("property_id", sa.Integer, sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("stated_budget", sa.Float, nullable=False),
        sa.Column("ai_note", sa.String(length=1000), nullable=True),
        sa.Column("ai_generated_by", sa.String(length=20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("financing_interests")
