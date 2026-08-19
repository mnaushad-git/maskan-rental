"""Trust Center — Listing Completeness: required/important/optional field
weighting and the weighted-percent score. Pure deterministic logic — no DB
session needed, `Property` is a plain transient ORM object (same pattern as
test_property_decision_score.py / test_data_confidence.py).
"""
from app.models.listing_image import ListingImage
from app.models.property import Property
from app.services.listing_completeness import compute_listing_completeness


def _full_property(**overrides) -> Property:
    defaults = dict(
        title="Test Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, bathrooms=2, size_sq_m=150, living_rooms=1,
        property_type="Apartment", furnished="Furnished", description="A lovely apartment near the park.",
        latitude=24.7, longitude=46.6, contact_phone="0500000000", whatsapp_phone="0500000000",
        property_age_years=5, deed_area=160, license_number="LIC-123",
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    prop.listing_images = [
        ListingImage(url="https://example.com/1.jpg", display_order=0),
        ListingImage(url="https://example.com/2.jpg", display_order=1),
        ListingImage(url="https://example.com/3.jpg", display_order=2),
    ]
    return prop


def test_fully_complete_listing_scores_100():
    prop = _full_property()
    result = compute_listing_completeness(prop)
    assert result.score == 100
    assert result.missing_fields == []
    assert result.missing_required == []


def test_empty_listing_scores_low_and_lists_all_required_as_missing():
    prop = Property(title="", area="", city="", listing_type="rent")
    result = compute_listing_completeness(prop)
    assert result.score < 30
    assert "Title" in result.missing_required
    assert "Price" in result.missing_required
    assert "Bedrooms" in result.missing_required


def test_missing_only_important_and_optional_fields_scores_above_missing_required():
    # All required fields present, important/optional missing — should score
    # meaningfully higher than a listing missing required fields too.
    prop = _full_property(
        latitude=None, longitude=None, furnished=None, living_rooms=None,
        contact_phone=None, whatsapp_phone=None, property_age_years=None,
        deed_area=None, license_number=None,
    )
    prop.listing_images = [ListingImage(url="https://example.com/1.jpg", display_order=0)]
    result = compute_listing_completeness(prop)
    assert result.missing_required == []
    assert 0 < result.score < 100
    empty_result = compute_listing_completeness(Property(title="", area="", city="", listing_type="rent"))
    assert result.score > empty_result.score


def test_required_field_missing_is_weighted_more_than_optional():
    # Same total count of missing fields, but one case misses a required
    # field and the other only misses an optional field — required should
    # cost more (score lower).
    missing_required_case = _full_property(title="")
    missing_optional_case = _full_property(license_number=None)
    result_required = compute_listing_completeness(missing_required_case)
    result_optional = compute_listing_completeness(missing_optional_case)
    assert result_required.score < result_optional.score


def test_tier_breakdown_counts_present_fields_per_tier():
    prop = _full_property()
    result = compute_listing_completeness(prop)
    assert result.tier_breakdown["required"]["present"] == result.tier_breakdown["required"]["total"]
    assert result.tier_breakdown["important"]["present"] == result.tier_breakdown["important"]["total"]
    assert result.tier_breakdown["optional"]["present"] == result.tier_breakdown["optional"]["total"]


def test_sale_listing_checks_sale_price_not_monthly_rent():
    prop = _full_property(listing_type="sale", monthly_rent=None, sale_price=1_500_000.0)
    result = compute_listing_completeness(prop)
    assert "Price" not in result.missing_fields
