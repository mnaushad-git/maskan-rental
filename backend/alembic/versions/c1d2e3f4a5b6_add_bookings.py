"""add bookings table

Short-term stay booking (session A — data layer only, no pricing/AI yet). A
booking ties a renter to a property for a check-in/check-out date range.
Overlap prevention is enforced at the DB level via a GiST exclusion
constraint on (property_id, daterange(check_in, check_out)) restricted to
non-cancelled rows, so two confirmed bookings on the same property can never
share a night even under concurrent writes — the app-level pre-check in
bookings.py is just a friendlier 409 before hitting the constraint.

Revision ID: c1d2e3f4a5b6
Revises: b3c4d5e6f7a8
Create Date: 2026-08-06

"""
from alembic import op
import sqlalchemy as sa

revision: str = "c1d2e3f4a5b6"
down_revision: str = "b3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")

    op.create_table(
        "bookings",
        sa.Column("id", sa.Integer, primary_key=True, index=True),
        sa.Column("property_id", sa.Integer, sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("renter_user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True),
        sa.Column("check_in", sa.Date, nullable=False),
        sa.Column("check_out", sa.Date, nullable=False),
        sa.Column("total_price", sa.Float, nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="confirmed"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_bookings_status", "bookings", ["status"])

    op.execute(
        """
        ALTER TABLE bookings
        ADD CONSTRAINT ex_bookings_no_overlap
        EXCLUDE USING gist (
            property_id WITH =,
            daterange(check_in, check_out, '[)') WITH &&
        )
        WHERE (status <> 'cancelled')
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE bookings DROP CONSTRAINT ex_bookings_no_overlap")
    op.drop_index("ix_bookings_status", table_name="bookings")
    op.drop_table("bookings")
