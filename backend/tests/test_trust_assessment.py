"""Trust Center — the top-level `assess_property_trust` orchestrator:
overall weighted score, trust-level thresholds, and missing-component
exclusion + weight renormalization (mirrors property_decision_score.py's
approach, applied across the five Trust Model components instead of the six
Property Decision Score dimensions).
"""
from datetime import datetime, timedelta, timezone

from app.core.trust_config import TRUST_COMPONENT_WEIGHTS
from app.models.listing_image import ListingImage
from app.models.mediator import Mediator
from app.models.property import Property
from app.services.data_confidence import DataConfidence
from app.services.trust_assessment import assess_property_trust

NOW = datetime(2026, 8, 17, 12, 0, 0, tzinfo=timezone.utc)


def _days_ago(days: int) -> datetime:
    return NOW - timedelta(days=days)


def _mediator(**overrides) -> Mediator:
    defaults = dict(user_id=1, license_number="LIC-1", phone="0500000000", is_verified=True)
    defaults.update(overrides)
    return Mediator(**defaults)


def _full_property(**overrides) -> Property:
    defaults = dict(
        title="Test Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, bathrooms=2, size_sq_m=150, living_rooms=1,
        property_type="Apartment", furnished="Furnished", description="A lovely apartment near the park.",
        latitude=24.7, longitude=46.6, contact_phone="0500000000",
        created_at=_days_ago(5), updated_at=_days_ago(2),
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    prop.listing_images = [ListingImage(url="https://example.com/1.jpg", display_order=0)]
    return prop


def test_weights_sum_to_one():
    assert abs(sum(TRUST_COMPONENT_WEIGHTS.values()) - 1.0) < 1e-9


def test_strong_listing_scores_high_and_all_components_present():
    prop = _full_property()
    prop.mediator = _mediator(is_verified=True)
    dc = DataConfidence(level="High", reason="High confidence — ...", signals_present=6, signals_total=6)

    result = assess_property_trust(
        prop, review_count=15, avg_rating=4.7, mediator_listing_count=8,
        data_confidence=dc, now=NOW,
    )

    assert set(result.component_scores.keys()) == set(TRUST_COMPONENT_WEIGHTS.keys())
    assert result.omitted_components == []
    assert 0 <= result.overall_score <= 100
    assert result.overall_score >= 70
    assert result.trust_level in ("High", "Good")
    assert "✓ Verified by myMakan" in result.positive_signals


def test_weak_listing_scores_low_and_limited_confidence():
    prop = Property(
        title="", area="", city="Riyadh", listing_type="rent",
        created_at=_days_ago(500), updated_at=_days_ago(500),
    )
    result = assess_property_trust(prop, now=NOW)
    assert result.overall_score < 50
    assert result.trust_level == "Limited Confidence"
    assert result.missing_information  # non-empty
    assert result.things_to_verify  # non-empty


def test_no_mediator_omits_mediator_trust_component_and_renormalizes():
    prop = _full_property()
    # prop.mediator left unset -> None
    result = assess_property_trust(prop, now=NOW)
    assert "mediator_trust" not in result.component_scores
    assert "mediator_trust" in result.omitted_components
    # remaining components still describe a full 0-100 overall score
    assert 0 <= result.overall_score <= 100
    assert "No mediator is on record for this listing — verify details directly." in result.things_to_verify


def test_no_data_confidence_omits_marketplace_confidence_and_renormalizes():
    prop = _full_property()
    prop.mediator = _mediator(is_verified=True)
    result = assess_property_trust(prop, review_count=5, avg_rating=4.5, mediator_listing_count=3, now=NOW)
    assert "marketplace_confidence" not in result.component_scores
    assert "marketplace_confidence" in result.omitted_components
    assert 0 <= result.overall_score <= 100


def test_missing_both_optional_components_still_produces_valid_score_from_always_on_ones():
    # Only completeness/consistency/freshness are guaranteed present.
    prop = _full_property()
    result = assess_property_trust(prop, now=NOW)
    assert set(result.component_scores.keys()) == {"completeness", "consistency", "freshness"}
    assert set(result.omitted_components) == {"mediator_trust", "marketplace_confidence"}
    assert 0 <= result.overall_score <= 100


def test_trust_level_thresholds_are_monotonic_with_score():
    # A deliberately staged set of listings from worst to best should never
    # produce a trust level that regresses as completeness/consistency/
    # freshness/mediator signals improve.
    level_order = {"Limited Confidence": 0, "Moderate": 1, "Good": 2, "High": 3}

    weak = Property(title="", area="", city="Riyadh", listing_type="rent", created_at=_days_ago(500))
    weak_result = assess_property_trust(weak, now=NOW)

    strong = _full_property()
    strong.mediator = _mediator(is_verified=True)
    dc = DataConfidence(level="High", reason="High confidence — ...", signals_present=6, signals_total=6)
    strong_result = assess_property_trust(
        strong, review_count=15, avg_rating=4.9, mediator_listing_count=10, data_confidence=dc, now=NOW,
    )

    assert level_order[strong_result.trust_level] >= level_order[weak_result.trust_level]
    assert strong_result.overall_score > weak_result.overall_score


def test_data_confidence_passed_through_unmodified_on_assessment():
    prop = _full_property()
    dc = DataConfidence(level="Moderate", reason="custom reason", signals_present=2, signals_total=6)
    result = assess_property_trust(prop, data_confidence=dc, now=NOW)
    assert result.data_confidence is dc


def test_new_partner_grace_period_omits_mediator_trust_from_weighting_but_keeps_it_visible():
    graced_prop = _full_property()
    graced_prop.mediator = _mediator(is_verified=False, created_at=NOW - timedelta(days=5))
    graced = assess_property_trust(graced_prop, review_count=0, avg_rating=None, mediator_listing_count=1, now=NOW)

    # Still shown (e.g. for admin's own view of the real picture)...
    assert "mediator_trust" in graced.component_scores
    assert graced.component_scores["mediator_trust"].in_grace_period is True
    # ...but excluded from the customer-facing weighted score.
    assert "mediator_trust" in graced.omitted_components

    # An otherwise-identical unverified mediator past the grace window is
    # NOT protected and does drag the overall score down.
    ungraced_prop = _full_property()
    ungraced_prop.mediator = _mediator(is_verified=False, created_at=NOW - timedelta(days=400))
    ungraced = assess_property_trust(ungraced_prop, review_count=0, avg_rating=None, mediator_listing_count=1, now=NOW)

    assert "mediator_trust" not in ungraced.omitted_components
    assert ungraced.overall_score < graced.overall_score


def test_grace_period_ends_as_soon_as_verified_reviewed_or_second_listing_added():
    def _new_prop_with_mediator(**mediator_overrides) -> Property:
        prop = _full_property()
        prop.mediator = _mediator(created_at=NOW - timedelta(days=1), **mediator_overrides)
        return prop

    verified = assess_property_trust(
        _new_prop_with_mediator(is_verified=True), review_count=0, avg_rating=None,
        mediator_listing_count=1, now=NOW,
    )
    assert "mediator_trust" not in verified.omitted_components

    reviewed = assess_property_trust(
        _new_prop_with_mediator(is_verified=False), review_count=1, avg_rating=5.0,
        mediator_listing_count=1, now=NOW,
    )
    assert "mediator_trust" not in reviewed.omitted_components

    second_listing = assess_property_trust(
        _new_prop_with_mediator(is_verified=False), review_count=0, avg_rating=None,
        mediator_listing_count=2, now=NOW,
    )
    assert "mediator_trust" not in second_listing.omitted_components
