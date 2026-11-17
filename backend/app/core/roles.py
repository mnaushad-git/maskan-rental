"""Single source of truth for role checks.

Every place that decides "is this user an admin?" — the admin API guard,
login / signup / `/auth/me` responses, and the per-resource admin bypasses
in contracts, bookings and leads — must call `is_admin_user` so the portal
UI and the API can never disagree about who is an admin.
"""

from app.core.config import settings


def is_admin_user(user) -> bool:
    """A user is an admin if the DB flag is set (managed from the Admin
    Portal's Users screen) or their email is in the ADMIN_EMAILS bootstrap
    list. Disabled accounts are never admins."""
    if user is None or not getattr(user, "is_active", True):
        return False
    email = (user.email or "").strip().lower()
    bootstrap = {e.lower() for e in settings.admin_emails}
    return bool(user.is_admin) or email in bootstrap
