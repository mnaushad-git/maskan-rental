"""add mediator_id, contact_phone, whatsapp_phone, listing_status to projects

Lets partners list a Project the same way they list a Property: a
mediator-owned row with its own call/WhatsApp numbers, gated behind the
same Draft/Pending Approval/Published/Suspended/Rejected moderation
workflow. `listing_status` is a new column rather than a repurposing of
the existing `status` column — `status` already means "Available"/"Sold
Out" (an availability badge shown in the mobile UI) and must keep
meaning that. All existing rows default to listing_status='Published'
so nothing changes for them.

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-08-11

"""
from alembic import op
import sqlalchemy as sa

revision: str = "c5d6e7f8a9b0"
down_revision: str = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("mediator_id", sa.Integer(), nullable=True))
    op.add_column("projects", sa.Column("contact_phone", sa.String(length=30), nullable=True))
    op.add_column("projects", sa.Column("whatsapp_phone", sa.String(length=30), nullable=True))
    op.add_column(
        "projects",
        sa.Column("listing_status", sa.String(length=50), nullable=False, server_default="Published"),
    )
    op.create_index(op.f("ix_projects_mediator_id"), "projects", ["mediator_id"])
    op.create_index(op.f("ix_projects_listing_status"), "projects", ["listing_status"])
    op.create_foreign_key(
        "fk_projects_mediator_id_mediators",
        "projects",
        "mediators",
        ["mediator_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_projects_mediator_id_mediators", "projects", type_="foreignkey")
    op.drop_index(op.f("ix_projects_listing_status"), table_name="projects")
    op.drop_index(op.f("ix_projects_mediator_id"), table_name="projects")
    op.drop_column("projects", "listing_status")
    op.drop_column("projects", "whatsapp_phone")
    op.drop_column("projects", "contact_phone")
    op.drop_column("projects", "mediator_id")
