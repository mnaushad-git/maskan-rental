"""saved search alerts + notification center

Revision ID: a1f9c3d7e024
Revises: 36ee978d2668
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'a1f9c3d7e024'
down_revision: Union[str, None] = '36ee978d2668'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Extend saved_searches with alert semantics ─────────────────────────
    op.alter_column(
        "saved_searches", "filters",
        type_=postgresql.JSONB,
        postgresql_using="filters::jsonb",
    )
    op.add_column("saved_searches", sa.Column("locale", sa.String(5), nullable=False, server_default="en"))
    op.add_column("saved_searches", sa.Column("filter_schema_version", sa.Integer, nullable=False, server_default="1"))
    op.add_column("saved_searches", sa.Column("transaction_type", sa.String(20), nullable=True))
    op.add_column("saved_searches", sa.Column("city", sa.String(100), nullable=True))
    op.add_column("saved_searches", sa.Column("alert_enabled", sa.Boolean, nullable=False, server_default="true"))
    op.add_column("saved_searches", sa.Column("alert_frequency", sa.String(20), nullable=False, server_default="instant"))
    op.add_column("saved_searches", sa.Column("channels", postgresql.JSONB, nullable=False, server_default='["in_app"]'))
    op.add_column("saved_searches", sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("saved_searches", sa.Column("last_notified_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("saved_searches", sa.Column("status", sa.String(20), nullable=False, server_default="active"))
    op.add_column("saved_searches", sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))

    op.create_index("ix_saved_searches_user_id", "saved_searches", ["user_id"])
    op.create_index("ix_saved_searches_status", "saved_searches", ["status"])
    op.create_index("ix_saved_searches_alert_enabled", "saved_searches", ["alert_enabled"])
    op.create_index("ix_saved_searches_transaction_type", "saved_searches", ["transaction_type"])
    op.create_index("ix_saved_searches_city", "saved_searches", ["city"])
    op.create_index("ix_saved_searches_updated_at", "saved_searches", ["updated_at"])
    # The matcher's hot query: narrow active/alert-enabled searches by type+city.
    op.create_index(
        "ix_saved_searches_matching_candidates",
        "saved_searches",
        ["status", "alert_enabled", "transaction_type", "city"],
    )

    # ── saved_search_matches ────────────────────────────────────────────────
    op.create_table(
        "saved_search_matches",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("saved_search_id", sa.Integer, sa.ForeignKey("saved_searches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("property_id", sa.Integer, sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("change_type", sa.String(30), nullable=False),
        sa.Column("change_hash", sa.String(64), nullable=False),
        sa.Column("match_reasons", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("match_score", sa.Float, nullable=False, server_default="0"),
        sa.Column("notified", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("notification_id", sa.Integer, nullable=True),
        sa.Column("event_id", sa.String(64), nullable=True),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("saved_search_id", "property_id", "change_hash", name="uq_saved_search_match_dedup"),
    )
    op.create_index("ix_saved_search_matches_saved_search_id", "saved_search_matches", ["saved_search_id"])
    op.create_index("ix_saved_search_matches_property_id", "saved_search_matches", ["property_id"])
    op.create_index("ix_saved_search_matches_user_id", "saved_search_matches", ["user_id"])
    op.create_index("ix_saved_search_matches_created_at", "saved_search_matches", ["created_at"])
    # Digest job's hot query: this user's un-notified matches since last digest.
    op.create_index("ix_saved_search_matches_user_notified", "saved_search_matches", ["user_id", "notified"])

    # ── notifications ────────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("locale", sa.String(5), nullable=False, server_default="en"),
        sa.Column("entity_type", sa.String(30), nullable=True),
        sa.Column("entity_id", sa.Integer, nullable=True),
        sa.Column("saved_search_id", sa.Integer, sa.ForeignKey("saved_searches.id", ondelete="SET NULL"), nullable=True),
        sa.Column("property_id", sa.Integer, sa.ForeignKey("properties.id", ondelete="SET NULL"), nullable=True),
        sa.Column("match_reasons", postgresql.JSONB, nullable=True),
        sa.Column("deep_link", sa.String(512), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivery_status", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("ai_generated", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("meta", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("trace_id", sa.String(64), nullable=True),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"])
    op.create_index("ix_notifications_type", "notifications", ["type"])
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"])
    op.create_index("ix_notifications_saved_search_id", "notifications", ["saved_search_id"])
    # Unread-count / list queries: this user's notifications, unread first.
    op.create_index("ix_notifications_user_read", "notifications", ["user_id", "read_at"])
    op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])

    op.create_foreign_key(
        "fk_saved_search_matches_notification_id",
        "saved_search_matches", "notifications",
        ["notification_id"], ["id"],
        ondelete="SET NULL",
    )

    # ── notification_preferences ────────────────────────────────────────────
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("in_app_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("push_enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("email_enabled", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("digest_hour", sa.Integer, nullable=False, server_default="8"),
        sa.Column("timezone", sa.String(50), nullable=False, server_default="Asia/Riyadh"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_notification_preferences_user_id", "notification_preferences", ["user_id"], unique=True)

    # ── devices ──────────────────────────────────────────────────────────────
    op.create_table(
        "devices",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("platform", sa.String(10), nullable=False),
        sa.Column("push_token", sa.String(512), nullable=False),
        sa.Column("app_version", sa.String(30), nullable=True),
        sa.Column("locale", sa.String(5), nullable=False, server_default="en"),
        sa.Column("enabled", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("last_active_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "push_token", name="uq_device_user_token"),
    )
    op.create_index("ix_devices_user_id", "devices", ["user_id"])
    op.create_index("ix_devices_push_token", "devices", ["push_token"])

    # ── audit_logs ───────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("entity_type", sa.String(50), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_audit_logs_user_id", "audit_logs", ["user_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    # ── digest_runs ──────────────────────────────────────────────────────────
    op.create_table(
        "digest_runs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period", sa.String(10), nullable=False),
        sa.Column("run_date", sa.Date, nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
        sa.Column("notification_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "period", "run_date", name="uq_digest_run"),
    )
    op.create_index("ix_digest_runs_user_id", "digest_runs", ["user_id"])


def downgrade() -> None:
    op.drop_table("digest_runs")
    op.drop_table("audit_logs")
    op.drop_index("ix_devices_push_token", table_name="devices")
    op.drop_index("ix_devices_user_id", table_name="devices")
    op.drop_table("devices")
    op.drop_index("ix_notification_preferences_user_id", table_name="notification_preferences")
    op.drop_table("notification_preferences")
    op.drop_constraint("fk_saved_search_matches_notification_id", "saved_search_matches", type_="foreignkey")
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_index("ix_notifications_user_read", table_name="notifications")
    op.drop_index("ix_notifications_saved_search_id", table_name="notifications")
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_type", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_saved_search_matches_user_notified", table_name="saved_search_matches")
    op.drop_index("ix_saved_search_matches_created_at", table_name="saved_search_matches")
    op.drop_index("ix_saved_search_matches_user_id", table_name="saved_search_matches")
    op.drop_index("ix_saved_search_matches_property_id", table_name="saved_search_matches")
    op.drop_index("ix_saved_search_matches_saved_search_id", table_name="saved_search_matches")
    op.drop_table("saved_search_matches")

    op.drop_index("ix_saved_searches_matching_candidates", table_name="saved_searches")
    op.drop_index("ix_saved_searches_updated_at", table_name="saved_searches")
    op.drop_index("ix_saved_searches_city", table_name="saved_searches")
    op.drop_index("ix_saved_searches_transaction_type", table_name="saved_searches")
    op.drop_index("ix_saved_searches_alert_enabled", table_name="saved_searches")
    op.drop_index("ix_saved_searches_status", table_name="saved_searches")
    op.drop_index("ix_saved_searches_user_id", table_name="saved_searches")
    op.drop_column("saved_searches", "updated_at")
    op.drop_column("saved_searches", "status")
    op.drop_column("saved_searches", "last_notified_at")
    op.drop_column("saved_searches", "last_evaluated_at")
    op.drop_column("saved_searches", "channels")
    op.drop_column("saved_searches", "alert_frequency")
    op.drop_column("saved_searches", "alert_enabled")
    op.drop_column("saved_searches", "city")
    op.drop_column("saved_searches", "transaction_type")
    op.drop_column("saved_searches", "filter_schema_version")
    op.drop_column("saved_searches", "locale")
    op.alter_column("saved_searches", "filters", type_=sa.JSON, postgresql_using="filters::json")
