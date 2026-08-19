"""Trust Center — Listing Freshness: day-threshold category classification
(Recently Confirmed / Recently Updated / Needs Reconfirmation / Potentially
Stale) and the future-proofed (currently inert) availability-confirmation
path.
"""
from datetime import datetime, timedelta, timezone

from app.services.listing_freshness import compute_listing_freshness

NOW = datetime(2026, 8, 17, 12, 0, 0, tzinfo=timezone.utc)


def _days_ago(days: int) -> datetime:
    return NOW - timedelta(days=days)


def test_recently_updated_within_threshold():
    result = compute_listing_freshness(created_at=_days_ago(400), updated_at=_days_ago(5), now=NOW)
    assert result.category == "Recently Updated"
    assert result.score == 80


def test_needs_reconfirmation_between_thresholds():
    result = compute_listing_freshness(created_at=_days_ago(400), updated_at=_days_ago(30), now=NOW)
    assert result.category == "Needs Reconfirmation"
    assert result.score == 50


def test_potentially_stale_beyond_threshold():
    result = compute_listing_freshness(created_at=_days_ago(400), updated_at=_days_ago(90), now=NOW)
    assert result.category == "Potentially Stale"
    assert result.score == 20


def test_no_update_falls_back_to_created_at():
    result = compute_listing_freshness(created_at=_days_ago(3), updated_at=None, now=NOW)
    assert result.category == "Recently Updated"


def test_recently_confirmed_takes_priority_when_within_threshold():
    result = compute_listing_freshness(
        created_at=_days_ago(400), updated_at=_days_ago(90),
        availability_confirmed_at=_days_ago(2), now=NOW,
    )
    assert result.category == "Recently Confirmed"
    assert result.score == 100


def test_stale_availability_confirmation_falls_through_to_updated_at_check():
    # Confirmed too long ago to count as "recently confirmed" — should fall
    # back to the updated_at-based classification instead.
    result = compute_listing_freshness(
        created_at=_days_ago(400), updated_at=_days_ago(5),
        availability_confirmed_at=_days_ago(200), now=NOW,
    )
    assert result.category == "Recently Updated"


def test_boundary_day_counts_as_within_threshold():
    result = compute_listing_freshness(created_at=_days_ago(400), updated_at=_days_ago(14), now=NOW)
    assert result.category == "Recently Updated"
    result_over = compute_listing_freshness(created_at=_days_ago(400), updated_at=_days_ago(15), now=NOW)
    assert result_over.category == "Needs Reconfirmation"
