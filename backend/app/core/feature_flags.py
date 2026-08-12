"""Minimal feature-flag surface: env-configurable booleans on `Settings`
(see app/core/config.py), exposed through one lookup function so call sites
don't import `settings` directly and so the storage mechanism (today: env
vars / .env) can be swapped for a real per-user/per-tenant flag service later
without touching every call site.

Deliberately simple — this codebase has no existing flag system (see Phase 1
research) and a full targeting/rollout-percentage engine is out of scope for
this feature; env-var toggles are enough for "roll out incrementally by
deploying with a flag off, then on."
"""
from app.core.config import settings

FLAGS = {
    "saved_search_alerts": "FEATURE_SAVED_SEARCH_ALERTS",
    "notification_center": "FEATURE_NOTIFICATION_CENTER",
    "daily_digest": "FEATURE_DAILY_DIGEST",
    "weekly_digest": "FEATURE_WEEKLY_DIGEST",
    "push_notifications": "FEATURE_PUSH_NOTIFICATIONS",
    "real_push_notifications": "FEATURE_PUSH_NOTIFICATIONS",
    "ai_alert_explanations": "FEATURE_AI_ALERT_EXPLANATIONS",
    "ai_notification_enrichment": "FEATURE_AI_ALERT_EXPLANATIONS",
    "customer_notification_dropdown": "FEATURE_CUSTOMER_NOTIFICATION_DROPDOWN",
    "mobile_notification_center": "FEATURE_MOBILE_NOTIFICATION_CENTER",
    "lead_generic_notifications": "FEATURE_LEAD_GENERIC_NOTIFICATIONS",
    "live_notification_stream": "FEATURE_LIVE_NOTIFICATION_STREAM",
    "per_user_digest_schedule": "FEATURE_PER_USER_DIGEST_SCHEDULE",
    "notification_admin_dashboard": "FEATURE_NOTIFICATION_ADMIN_DASHBOARD",
    "notification_quiet_hours": "FEATURE_NOTIFICATION_QUIET_HOURS",
    "notification_message_preview": "FEATURE_NOTIFICATION_MESSAGE_PREVIEW",
    "push_test_endpoint": "FEATURE_PUSH_TEST_ENDPOINT",
    "property_requests": "FEATURE_PROPERTY_REQUESTS",
    "ai_property_request_creation": "FEATURE_AI_PROPERTY_REQUEST_CREATION",
    "ai_property_agent": "FEATURE_AI_PROPERTY_AGENT",
    "mediator_request_marketplace": "FEATURE_MEDIATOR_REQUEST_MARKETPLACE",
    "property_request_notifications": "FEATURE_PROPERTY_REQUEST_NOTIFICATIONS",
    "property_request_area_suggestions": "FEATURE_PROPERTY_REQUEST_AREA_SUGGESTIONS",
    "property_request_commute_matching": "FEATURE_PROPERTY_REQUEST_COMMUTE_MATCHING",
    "property_request_ai_explanations": "FEATURE_PROPERTY_REQUEST_AI_EXPLANATIONS",
    "property_request_admin_dashboard": "FEATURE_PROPERTY_REQUEST_ADMIN_DASHBOARD",
    # myMakan Phase-1 scope flags (see docs/implementation/mymakan-phase1.md)
    "rent": "FEATURE_RENT",
    "buy": "FEATURE_BUY",
    "ai_advisor": "FEATURE_AI_ADVISOR",
    "area_intelligence": "FEATURE_AREA_INTELLIGENCE",
    "saved_searches": "FEATURE_SAVED_SEARCHES",
    "notifications": "FEATURE_NOTIFICATIONS",
    "leads": "FEATURE_LEADS",
    "projects": "FEATURE_PROJECTS",
    "booking": "FEATURE_BOOKING",
    "short_stay": "FEATURE_SHORT_STAY",
    "financing": "FEATURE_FINANCING",
    "property_management": "FEATURE_PROPERTY_MANAGEMENT",
    "external_transaction": "FEATURE_EXTERNAL_TRANSACTION",
}


def is_enabled(flag: str) -> bool:
    attr = FLAGS.get(flag)
    if attr is None:
        return False
    return bool(getattr(settings, attr, False))
