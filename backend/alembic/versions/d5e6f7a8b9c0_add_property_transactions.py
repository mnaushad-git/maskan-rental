"""add property_transactions and transaction_documents tables

Rental/Buy Transaction Workspace (Prompt 2): `PropertyTransaction` — the
step between an accepted `PropertyNegotiation` and an eventual
(out-of-scope) Ejar/contract/payment process — plus `TransactionDocument`,
the child rows seeded from a rent/buy document template when a transaction
is auto-created. See docs/implementation/mymakan-transaction-workspace.md.

Revision ID: d5e6f7a8b9c0
Revises: c2d3e4f5a6b7
Create Date: 2026-08-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, None] = "c2d3e4f5a6b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "property_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reference", sa.String(length=20), nullable=False),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("transaction_type", sa.String(length=20), nullable=False),
        sa.Column("customer_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("mediator_id", sa.Integer(), sa.ForeignKey("mediators.id", ondelete="SET NULL"), nullable=True),
        sa.Column("lead_id", sa.Integer(), sa.ForeignKey("leads.id", ondelete="SET NULL"), nullable=True),
        sa.Column("negotiation_id", sa.Integer(), sa.ForeignKey("property_negotiations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("viewing_id", sa.Integer(), sa.ForeignKey("property_viewings.id", ondelete="SET NULL"), nullable=True),
        sa.Column("agreed_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False, server_default="SAR"),
        sa.Column("status", sa.String(length=30), nullable=False, server_default="initiated"),
        sa.Column("progress_percentage", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("customer_info_confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.String(length=255), nullable=True),
        sa.UniqueConstraint("negotiation_id", name="uq_property_transactions_negotiation_id"),
        sa.UniqueConstraint("reference", name="uq_property_transactions_reference"),
    )
    op.create_index("ix_property_transactions_id", "property_transactions", ["id"])
    op.create_index("ix_property_transactions_reference", "property_transactions", ["reference"])
    op.create_index("ix_property_transactions_status", "property_transactions", ["status"])
    op.create_index("ix_property_transactions_customer_status", "property_transactions", ["customer_user_id", "status"])
    op.create_index("ix_property_transactions_mediator_status", "property_transactions", ["mediator_id", "status"])
    op.create_index("ix_property_transactions_property_customer", "property_transactions", ["property_id", "customer_user_id"])

    op.create_table(
        "transaction_documents",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("property_transactions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("document_type", sa.String(length=50), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="not_uploaded"),
        sa.Column("file_reference", sa.String(length=512), nullable=True),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("review_note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_transaction_documents_id", "transaction_documents", ["id"])
    op.create_index("ix_transaction_documents_transaction_status", "transaction_documents", ["transaction_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_transaction_documents_transaction_status", table_name="transaction_documents")
    op.drop_index("ix_transaction_documents_id", table_name="transaction_documents")
    op.drop_table("transaction_documents")

    op.drop_index("ix_property_transactions_property_customer", table_name="property_transactions")
    op.drop_index("ix_property_transactions_mediator_status", table_name="property_transactions")
    op.drop_index("ix_property_transactions_customer_status", table_name="property_transactions")
    op.drop_index("ix_property_transactions_status", table_name="property_transactions")
    op.drop_index("ix_property_transactions_reference", table_name="property_transactions")
    op.drop_index("ix_property_transactions_id", table_name="property_transactions")
    op.drop_table("property_transactions")
