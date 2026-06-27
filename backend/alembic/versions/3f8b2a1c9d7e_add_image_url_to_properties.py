"""add image_url to properties

Revision ID: 3f8b2a1c9d7e
Revises: ef6ab9384c7e
Create Date: 2026-06-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "3f8b2a1c9d7e"
down_revision: Union[str, None] = "ef6ab9384c7e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("properties", sa.Column("image_url", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("properties", "image_url")
