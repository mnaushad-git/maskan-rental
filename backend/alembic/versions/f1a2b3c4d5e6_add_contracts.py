"""add contracts table

Digital rental contract management: a contract is generated from an accepted
Lead, ties together the tenant, the accepted mediator (landlord side), and
optionally the property, and tracks each party's signature separately.

Revision ID: f1a2b3c4d5e6
Revises: c4a1f0e2b7d3
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

revision: str = "f1a2b3c4d5e6"
down_revision: str = "c4a1f0e2b7d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "contracts",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("lead_id", sa.Integer, sa.ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("tenant_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("landlord_mediator_id", sa.Integer, sa.ForeignKey("mediators.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("property_id", sa.Integer, sa.ForeignKey("properties.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rent_amount", sa.Float, nullable=False),
        sa.Column("deposit_amount", sa.Float, nullable=True),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="draft"),
        sa.Column("tenant_signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("landlord_signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("lead_id", name="uq_contracts_lead_id"),
    )
    op.create_index("ix_contracts_status", "contracts", ["status"])


def downgrade() -> None:
    op.drop_index("ix_contracts_status", table_name="contracts")
    op.drop_table("contracts")
