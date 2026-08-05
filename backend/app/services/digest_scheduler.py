"""Per-user digest scheduling math (Phase 5).

Computes the next UTC instant a user's daily/weekly digest should run, given
their local `digest_hour` (0-23), `weekly_digest_day` (0=Monday..6=Sunday,
ISO weekday), and IANA `timezone` name. Pure functions, no DB/Redis access,
so they're trivially unit-testable and reusable from both the preferences
API (recompute on save) and the bucketed scheduler task (recompute after
each run).

`NotificationPreference.next_daily_digest_at` / `next_weekly_digest_at` are
the source of truth the scheduler queries against — see
`app.tasks.notifications.run_digest_bucket` — rather than recomputing
hour/timezone math for every user on every 15-minute tick.
"""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def _safe_zone(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("Asia/Riyadh")


def next_daily_run(*, digest_hour: int, tz_name: str, now: datetime | None = None) -> datetime:
    """Next UTC instant `digest_hour:00` occurs in `tz_name`, strictly after
    `now` (so a preference save at exactly the target hour schedules
    tomorrow, not "immediately", avoiding a digest firing mid-edit)."""
    now = now or datetime.now(timezone.utc)
    zone = _safe_zone(tz_name)
    local_now = now.astimezone(zone)
    candidate = local_now.replace(hour=digest_hour, minute=0, second=0, microsecond=0)
    if candidate <= local_now:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc)


def next_weekly_run(*, digest_hour: int, weekly_day: int, tz_name: str, now: datetime | None = None) -> datetime:
    """Next UTC instant `digest_hour:00` occurs on ISO weekday `weekly_day`
    (0=Monday..6=Sunday) in `tz_name`, strictly after `now`."""
    now = now or datetime.now(timezone.utc)
    zone = _safe_zone(tz_name)
    local_now = now.astimezone(zone)
    candidate = local_now.replace(hour=digest_hour, minute=0, second=0, microsecond=0)
    days_ahead = (weekly_day - candidate.weekday()) % 7
    candidate += timedelta(days=days_ahead)
    if candidate <= local_now:
        candidate += timedelta(days=7)
    return candidate.astimezone(timezone.utc)


def reschedule(preference, *, now: datetime | None = None) -> None:
    """Mutates `preference.next_daily_digest_at` / `next_weekly_digest_at`
    in place from its current digest_hour/weekly_digest_day/timezone. Call
    whenever those fields change, or when a preference row is first
    created, so the bucket scheduler always has a valid next-run instant to
    query against."""
    preference.next_daily_digest_at = next_daily_run(digest_hour=preference.digest_hour, tz_name=preference.timezone, now=now)
    preference.next_weekly_digest_at = next_weekly_run(
        digest_hour=preference.digest_hour, weekly_day=preference.weekly_digest_day, tz_name=preference.timezone, now=now
    )


def in_quiet_hours(preference, *, now: datetime | None = None) -> bool:
    """True if `now` (default: current instant) falls inside the user's
    configured quiet-hours window, expressed in their local timezone.
    Handles overnight windows (e.g. 22:00-07:00) by checking whether the
    window wraps midnight."""
    if not preference.quiet_hours_enabled:
        return False
    now = now or datetime.now(timezone.utc)
    zone = _safe_zone(preference.timezone)
    local_now = now.astimezone(zone).time()
    start_h, start_m = (int(x) for x in preference.quiet_hours_start.split(":"))
    end_h, end_m = (int(x) for x in preference.quiet_hours_end.split(":"))
    start = time(start_h, start_m)
    end = time(end_h, end_m)
    if start == end:
        return False  # zero-width window == disabled
    if start < end:
        return start <= local_now < end
    return local_now >= start or local_now < end  # wraps midnight
