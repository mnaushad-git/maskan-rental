from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

# Analytics event names (Phase 10). Deliberately NOT an enum column
# constraint — new event names ship from client releases faster than
# backend migrations, so this is documentation, not enforcement.
ANALYTICS_EVENTS = (
    "push_permission_prompt_shown",
    "push_permission_granted",
    "push_permission_denied",
    "device_registered",
    "device_token_refreshed",
    "notification_created",
    "push_delivery_attempted",
    "push_delivery_accepted",
    "push_delivery_failed",
    "notification_received_foreground",
    "notification_opened",
    "notification_deep_link_opened",
    "notification_marked_read",
    "notification_deleted",
    "notification_settings_changed",
    "digest_generated",
    "digest_opened",
    "lead_notification_created",
    "lead_notification_opened",
    "property_alert_opened",
    "property_alert_saved",
    "property_alert_lead_created",
    # ── Property Request platform (Phase 15) ────────────────────────────────
    "property_request_started",
    "property_request_created_from_form",
    "property_request_created_from_ai",
    "property_request_clarification_asked",
    "property_request_clarification_answered",
    "property_request_activated",
    "property_request_paused",
    "property_request_resumed",
    "property_request_edited",
    "property_request_closed",
    "property_request_fulfilled",
    "property_request_expired",
    "property_request_match_created",
    "property_request_match_viewed",
    "property_request_match_saved",
    "property_request_match_dismissed",
    "property_request_match_contacted",
    "property_request_no_match",
    "property_request_ai_suggestion_accepted",
    "property_request_ai_suggestion_rejected",
    "mediator_request_viewed",
    "mediator_request_response_started",
    "mediator_request_response_submitted",
    "mediator_request_response_rejected",
    "mediator_response_opened",
    "mediator_response_converted_to_lead",
)


class AnalyticsEvent(Base):
    """Lightweight, append-only analytics event log (Phase 10). `properties`
    must never contain private message content or full search criteria —
    enforced by convention at each call site (see docstrings there), not by
    this model. This is intentionally separate from `AuditLog` (compliance
    trail of who-changed-what) — analytics events are much higher volume and
    have no retention/legal requirement."""

    __tablename__ = "analytics_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_name: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    properties: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    trace_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    user = relationship("User")
