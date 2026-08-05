"""notification platform upgrade: push delivery, lead notifications, digest scheduling, analytics

Revision ID: b2e0d5f1a933
Revises: a1f9c3d7e024
Create Date: 2026-08-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b2e0d5f1a933'
down_revision: Union[str, None] = 'a1f9c3d7e024'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── devices: real push-provider fields ──────────────────────────────────
    op.add_column("devices", sa.Column("push_token_hash", sa.String(64), nullable=True))
    op.add_column("devices", sa.Column("installation_id", sa.String(128), nullable=True))
    op.add_column("devices", sa.Column("device_id", sa.String(128), nullable=True))
    op.add_column("devices", sa.Column("os_version", sa.String(30), nullable=True))
    op.add_column("devices", sa.Column("device_timezone", sa.String(50), nullable=True))
    op.add_column("devices", sa.Column("failure_count", sa.Integer, nullable=False, server_default="0"))
    op.add_column("devices", sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("last_success_push_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("last_failed_push_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_devices_push_token_hash", "devices", ["push_token_hash"])
    op.create_index("ix_devices_enabled", "devices", ["enabled"])
    op.create_index("ix_devices_last_active_at", "devices", ["last_active_at"])

    # ── notification_preferences: categories, quiet hours, digest scheduling ──
    op.add_column(
        "notification_preferences",
        sa.Column(
            "category_preferences", postgresql.JSONB, nullable=False,
            server_default=sa.text("""'{
                "property_alerts": {"channels": ["in_app", "push"], "frequency": "instant"},
                "price_changes": {"channels": ["in_app", "push"], "frequency": "instant"},
                "saved_search_digest": {"channels": ["in_app", "push"], "frequency": "instant"},
                "lead_updates": {"channels": ["in_app", "push"], "frequency": "instant"},
                "lead_messages": {"channels": ["in_app", "push"], "frequency": "instant"},
                "review_updates": {"channels": ["in_app", "push"], "frequency": "instant"},
                "subscription_payments": {"channels": ["in_app", "push"], "frequency": "instant"},
                "ai_recommendations": {"channels": ["in_app", "push"], "frequency": "instant"},
                "product_announcements": {"channels": ["in_app", "push"], "frequency": "instant"},
                "security": {"channels": ["in_app", "push"], "frequency": "instant"}
            }'::jsonb"""),
        ),
    )
    op.add_column("notification_preferences", sa.Column("weekly_digest_day", sa.Integer, nullable=False, server_default="0"))
    op.add_column("notification_preferences", sa.Column("next_daily_digest_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notification_preferences", sa.Column("next_weekly_digest_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("notification_preferences", sa.Column("quiet_hours_enabled", sa.Boolean, nullable=False, server_default="false"))
    op.add_column("notification_preferences", sa.Column("quiet_hours_start", sa.String(5), nullable=False, server_default="22:00"))
    op.add_column("notification_preferences", sa.Column("quiet_hours_end", sa.String(5), nullable=False, server_default="07:00"))
    op.add_column("notification_preferences", sa.Column("quiet_hours_allow_urgent", sa.Boolean, nullable=False, server_default="true"))
    op.add_column("notification_preferences", sa.Column("hide_message_preview", sa.Boolean, nullable=False, server_default="false"))
    op.create_index("ix_notification_preferences_next_daily_digest_at", "notification_preferences", ["next_daily_digest_at"])
    op.create_index("ix_notification_preferences_next_weekly_digest_at", "notification_preferences", ["next_weekly_digest_at"])

    # ── notifications: event-driven dedupe key ──────────────────────────────
    op.add_column("notifications", sa.Column("dedupe_key", sa.String(160), nullable=True))
    op.create_index(
        "uq_notifications_dedupe_key", "notifications", ["dedupe_key"],
        unique=True, postgresql_where=sa.text("dedupe_key IS NOT NULL"),
    )

    # ── notification_deliveries ──────────────────────────────────────────────
    op.create_table(
        "notification_deliveries",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("notification_id", sa.Integer, sa.ForeignKey("notifications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("device_id", sa.Integer, sa.ForeignKey("devices.id", ondelete="SET NULL"), nullable=True),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("provider", sa.String(30), nullable=False),
        sa.Column("provider_message_id", sa.String(128), nullable=True),
        sa.Column("attempt_number", sa.Integer, nullable=False, server_default="1"),
        sa.Column("status", sa.String(30), nullable=False),
        sa.Column("failure_code", sa.String(50), nullable=True),
        sa.Column("failure_message", sa.String(500), nullable=True),
        sa.Column("attempted_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("trace_id", sa.String(64), nullable=True),
    )
    op.create_index("ix_notification_deliveries_notification_id", "notification_deliveries", ["notification_id"])
    op.create_index("ix_notification_deliveries_device_id", "notification_deliveries", ["device_id"])
    op.create_index("ix_notification_deliveries_status", "notification_deliveries", ["status"])
    op.create_index("ix_notification_deliveries_created_at", "notification_deliveries", ["created_at"])

    # ── analytics_events ─────────────────────────────────────────────────────
    op.create_table(
        "analytics_events",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("event_name", sa.String(80), nullable=False),
        sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("properties", postgresql.JSONB, nullable=False, server_default="{}"),
        sa.Column("trace_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_analytics_events_event_name", "analytics_events", ["event_name"])
    op.create_index("ix_analytics_events_user_id", "analytics_events", ["user_id"])
    op.create_index("ix_analytics_events_created_at", "analytics_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_analytics_events_created_at", table_name="analytics_events")
    op.drop_index("ix_analytics_events_user_id", table_name="analytics_events")
    op.drop_index("ix_analytics_events_event_name", table_name="analytics_events")
    op.drop_table("analytics_events")

    op.drop_index("ix_notification_deliveries_created_at", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_status", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_device_id", table_name="notification_deliveries")
    op.drop_index("ix_notification_deliveries_notification_id", table_name="notification_deliveries")
    op.drop_table("notification_deliveries")

    op.drop_index("uq_notifications_dedupe_key", table_name="notifications")
    op.drop_column("notifications", "dedupe_key")

    op.drop_index("ix_notification_preferences_next_weekly_digest_at", table_name="notification_preferences")
    op.drop_index("ix_notification_preferences_next_daily_digest_at", table_name="notification_preferences")
    op.drop_column("notification_preferences", "hide_message_preview")
    op.drop_column("notification_preferences", "quiet_hours_allow_urgent")
    op.drop_column("notification_preferences", "quiet_hours_end")
    op.drop_column("notification_preferences", "quiet_hours_start")
    op.drop_column("notification_preferences", "quiet_hours_enabled")
    op.drop_column("notification_preferences", "next_weekly_digest_at")
    op.drop_column("notification_preferences", "next_daily_digest_at")
    op.drop_column("notification_preferences", "weekly_digest_day")
    op.drop_column("notification_preferences", "category_preferences")

    op.drop_index("ix_devices_last_active_at", table_name="devices")
    op.drop_index("ix_devices_enabled", table_name="devices")
    op.drop_index("ix_devices_push_token_hash", table_name="devices")
    op.drop_column("devices", "last_failed_push_at")
    op.drop_column("devices", "last_success_push_at")
    op.drop_column("devices", "invalidated_at")
    op.drop_column("devices", "failure_count")
    op.drop_column("devices", "device_timezone")
    op.drop_column("devices", "os_version")
    op.drop_column("devices", "device_id")
    op.drop_column("devices", "installation_id")
    op.drop_column("devices", "push_token_hash")
