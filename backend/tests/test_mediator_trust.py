"""Trust Center — Mediator Trust: verified/rating/review-count/listing-
history weighting, rating-omission when there are no reviews yet, the
"None when no mediator" contract that lets the overall Trust Assessment
omit this component and renormalize, and the new-partner grace period that
protects a brand-new, unverified mediator from being scored near-0 simply
for having just joined.
"""
from datetime import datetime, timedelta, timezone

from app.models.mediator import Mediator
from app.services.mediator_trust import compute_mediator_trust

NOW = datetime(2026, 8, 17, 12, 0, 0, tzinfo=timezone.utc)


def _mediator(**overrides) -> Mediator:
    defaults = dict(user_id=1, license_number="LIC-1", phone="0500000000", is_verified=True)
    defaults.update(overrides)
    return Mediator(**defaults)


def test_returns_none_when_no_mediator():
    assert compute_mediator_trust(None) is None


def test_verified_mediator_with_strong_signals_scores_high():
    mediator = _mediator(is_verified=True)
    result = compute_mediator_trust(mediator, review_count=20, avg_rating=4.8, listing_count=10)
    assert result.score >= 85
    assert result.is_verified is True
    assert "Verified by myMakan" in result.reason


def test_unverified_mediator_with_no_reviews_scores_low():
    mediator = _mediator(is_verified=False)
    result = compute_mediator_trust(mediator, review_count=0, avg_rating=None, listing_count=0)
    assert result.score < 30
    assert result.is_verified is False
    assert "Not yet verified" in result.reason


def test_rating_signal_omitted_without_reviews_does_not_crash_and_still_scores():
    mediator = _mediator(is_verified=True)
    with_no_reviews = compute_mediator_trust(mediator, review_count=0, avg_rating=None, listing_count=2)
    assert with_no_reviews.avg_rating is None
    assert 0 <= with_no_reviews.score <= 100


def test_verified_always_scores_higher_than_unverified_all_else_equal():
    verified = compute_mediator_trust(_mediator(is_verified=True), review_count=5, avg_rating=4.0, listing_count=3)
    unverified = compute_mediator_trust(_mediator(is_verified=False), review_count=5, avg_rating=4.0, listing_count=3)
    assert verified.score > unverified.score


def test_listing_count_and_review_count_ramp_up_to_target_then_cap():
    mediator = _mediator(is_verified=True)
    below_target = compute_mediator_trust(mediator, review_count=2, avg_rating=5.0, listing_count=1)
    at_target = compute_mediator_trust(mediator, review_count=10, avg_rating=5.0, listing_count=5)
    beyond_target = compute_mediator_trust(mediator, review_count=50, avg_rating=5.0, listing_count=50)
    assert below_target.score <= at_target.score
    assert at_target.score == beyond_target.score  # capped at 1.0 per signal, no further credit


def test_brand_new_unverified_mediator_within_window_is_in_grace_period():
    mediator = _mediator(is_verified=False, created_at=NOW - timedelta(days=5))
    result = compute_mediator_trust(
        mediator, review_count=0, avg_rating=None, listing_count=1, now=NOW,
    )
    assert result.in_grace_period is True
    # The raw score is still computed (for admin/internal use) even though
    # the top-level orchestrator won't weight it while graced.
    assert result.score < 30


def test_grace_period_expires_after_the_configured_window():
    mediator = _mediator(is_verified=False, created_at=NOW - timedelta(days=400))
    result = compute_mediator_trust(
        mediator, review_count=0, avg_rating=None, listing_count=1, now=NOW,
    )
    assert result.in_grace_period is False


def test_grace_period_does_not_apply_once_verified():
    mediator = _mediator(is_verified=True, created_at=NOW - timedelta(days=1))
    result = compute_mediator_trust(
        mediator, review_count=0, avg_rating=None, listing_count=1, now=NOW,
    )
    assert result.in_grace_period is False


def test_grace_period_does_not_apply_once_a_review_exists():
    mediator = _mediator(is_verified=False, created_at=NOW - timedelta(days=1))
    result = compute_mediator_trust(
        mediator, review_count=1, avg_rating=5.0, listing_count=1, now=NOW,
    )
    assert result.in_grace_period is False


def test_grace_period_does_not_apply_beyond_a_single_listing():
    mediator = _mediator(is_verified=False, created_at=NOW - timedelta(days=1))
    result = compute_mediator_trust(
        mediator, review_count=0, avg_rating=None, listing_count=2, now=NOW,
    )
    assert result.in_grace_period is False


def test_grace_period_fails_safe_when_created_at_is_unset():
    mediator = _mediator(is_verified=False)  # created_at left None (not persisted)
    result = compute_mediator_trust(
        mediator, review_count=0, avg_rating=None, listing_count=1, now=NOW,
    )
    assert result.in_grace_period is False
