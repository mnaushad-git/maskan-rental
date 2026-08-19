"""add property_negotiations and negotiation_offers tables

AI Negotiation & Offer Management (Prompt 1): `PropertyNegotiation` — a
customer's active offer/counter-offer exchange with a mediator over a single
property — plus `NegotiationOffer`, the individual offer/counter rows that
back its history. See docs/implementation/mymakan-negotiations.md.

Revision ID: 05cf5fee7bd3
Revises: b1c2d3e4f5a6
Create Date: 2026-08-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "05cf5fee7bd3"
down_revision: Union[str, None] = "b1c2d3e4f5a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "property_negotiations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("customer_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("mediator_id", sa.Integer(), sa.ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True),
        sa.Column("lead_id", sa.Integer(), sa.ForeignKey("leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("viewing_id", sa.Integer(), sa.ForeignKey("property_viewings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("transaction_type", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
        sa.Column("current_offer_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("original_listing_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_property_negotiations_id", "property_negotiations", ["id"])
    op.create_index("ix_property_negotiations_status", "property_negotiations", ["status"])
    op.create_index("ix_property_negotiations_customer_status", "property_negotiations", ["customer_user_id", "status"])
    op.create_index("ix_property_negotiations_mediator_status", "property_negotiations", ["mediator_id", "status"])
    op.create_index("ix_property_negotiations_property_customer", "property_negotiations", ["property_id", "customer_user_id"])

    op.create_table(
        "negotiation_offers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("negotiation_id", sa.Integer(), sa.ForeignKey("property_negotiations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("offered_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("offer_type", sa.String(length=30), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_negotiation_offers_id", "negotiation_offers", ["id"])
    op.create_index("ix_negotiation_offers_negotiation_created", "negotiation_offers", ["negotiation_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_negotiation_offers_negotiation_created", table_name="negotiation_offers")
    op.drop_index("ix_negotiation_offers_id", table_name="negotiation_offers")
    op.drop_table("negotiation_offers")

    op.drop_index("ix_property_negotiations_property_customer", table_name="property_negotiations")
    op.drop_index("ix_property_negotiations_mediator_status", table_name="property_negotiations")
    op.drop_index("ix_property_negotiations_customer_status", table_name="property_negotiations")
    op.drop_index("ix_property_negotiations_status", table_name="property_negotiations")
    op.drop_index("ix_property_negotiations_id", table_name="property_negotiations")
    op.drop_table("property_negotiations")
