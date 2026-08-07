"""add short-term booking fields to properties

Adds is_bookable, nightly_rate, has_elevator, has_airconditioners,
arrival_time, departure_time, latest_booking_time, insurance_amount to
properties — backing the Aqar-style "book a stay" browse/detail experience
(browse screen filters on is_bookable, detail page shows Unit Rules for
bookable listings, BookingCalendar prefers the real nightly_rate over its
monthly_rent-derived heuristic when present).

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-08-07

"""
from alembic import op
import sqlalchemy as sa

revision: str = "a3b4c5d6e7f8"
down_revision: str = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("is_bookable", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("nightly_rate", sa.Float(), nullable=True))
    op.add_column("properties", sa.Column("has_elevator", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("has_airconditioners", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("properties", sa.Column("arrival_time", sa.String(length=20), nullable=True))
    op.add_column("properties", sa.Column("departure_time", sa.String(length=20), nullable=True))
    op.add_column("properties", sa.Column("latest_booking_time", sa.String(length=20), nullable=True))
    op.add_column("properties", sa.Column("insurance_amount", sa.Float(), nullable=False, server_default="0"))
    op.create_index("ix_properties_is_bookable", "properties", ["is_bookable"])


def downgrade() -> None:
    op.drop_index("ix_properties_is_bookable", table_name="properties")
    op.drop_column("properties", "insurance_amount")
    op.drop_column("properties", "latest_booking_time")
    op.drop_column("properties", "departure_time")
    op.drop_column("properties", "arrival_time")
    op.drop_column("properties", "has_airconditioners")
    op.drop_column("properties", "has_elevator")
    op.drop_column("properties", "nightly_rate")
    op.drop_column("properties", "is_bookable")
