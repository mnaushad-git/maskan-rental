"""add reservation-form fields to bookings

Adds guest_name, guest_phone, arrival_time, payment_method,
special_requests to bookings — backing the new reservation form step
between "Reserve" and booking confirmation (pay-at-property flow, no
gateway charge). guest_name/guest_phone/arrival_time are nullable at the
DB level since pre-existing bookings predate the form; BookingCreate
requires them for every new booking going forward.

Revision ID: d1e2f3a4b5c6
Revises: c5d6e7f8a9b0
Create Date: 2026-08-12

"""
from alembic import op
import sqlalchemy as sa

revision: str = "d1e2f3a4b5c6"
down_revision: str = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bookings", sa.Column("guest_name", sa.String(length=120), nullable=True))
    op.add_column("bookings", sa.Column("guest_phone", sa.String(length=30), nullable=True))
    op.add_column("bookings", sa.Column("arrival_time", sa.String(length=20), nullable=True))
    op.add_column("bookings", sa.Column("payment_method", sa.String(length=20), nullable=False, server_default="cash"))
    op.add_column("bookings", sa.Column("special_requests", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("bookings", "special_requests")
    op.drop_column("bookings", "payment_method")
    op.drop_column("bookings", "arrival_time")
    op.drop_column("bookings", "guest_phone")
    op.drop_column("bookings", "guest_name")
