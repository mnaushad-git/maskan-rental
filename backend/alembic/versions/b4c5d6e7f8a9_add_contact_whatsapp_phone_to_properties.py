"""add contact_phone and whatsapp_phone to properties

Lets a listing carry its own call number and WhatsApp number, separate
from the mediator account's phone. Partner-created listings must supply
both (see PartnerPropertyCreate); older/admin-created rows fall back to
the mediator's phone via Property.call_phone / Property.whatsapp_number.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-08-10

"""
from alembic import op
import sqlalchemy as sa

revision: str = "b4c5d6e7f8a9"
down_revision: str = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("contact_phone", sa.String(length=30), nullable=True))
    op.add_column("properties", sa.Column("whatsapp_phone", sa.String(length=30), nullable=True))


def downgrade() -> None:
    op.drop_column("properties", "whatsapp_phone")
    op.drop_column("properties", "contact_phone")
