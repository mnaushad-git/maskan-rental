"""add reviews table and widen profile_image_url

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-06-27
"""

from alembic import op
import sqlalchemy as sa

revision: str = "d4e5f6a7b8c9"
down_revision: str = "c3d4e5f6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reviews",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("mediator_id", sa.Integer, sa.ForeignKey("mediators.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
        sa.Column("rating", sa.Integer, nullable=False),
        sa.Column("comment", sa.Text, nullable=True),
        sa.Column("reviewer_name", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("mediator_id", "user_id", name="uq_one_review_per_user_mediator"),
    )
    # Widen profile_image_url from VARCHAR(512) to TEXT so base64 uploads fit
    op.alter_column("mediators", "profile_image_url", type_=sa.Text, existing_nullable=True)


def downgrade() -> None:
    op.drop_table("reviews")
    op.alter_column("mediators", "profile_image_url", type_=sa.String(512), existing_nullable=True)
