"""Property Decision Score: dimension weighting, missing-data exclusion +
renormalization (mirrors home_finder_scoring's approach), and the WEIGHTS
invariant. Pure deterministic logic — no DB session needed, `Property`/
`AreaIntelligence` are plain transient ORM objects.
"""
from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property
from app.services.property_decision_score import WEIGHTS, score_property_decision


def _make_property(**overrides) -> Property:
    defaults = dict(
        title="Test Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, bathrooms=2, size_sq_m=150, living_rooms=1,
        property_type="Apartment", furnished="Furnished",
        has_kitchen=True, has_water=True, has_electricity=True, has_elevator=True,
        latitude=24.7, longitude=46.6,
    )
    defaults.update(overrides)
    return Property(**defaults)


def _make_area_intel(**overrides) -> AreaIntelligence:
    defaults = dict(area_name="Al Yasmin", city="Riyadh", area_score=80, traffic_score=40)
    defaults.update(overrides)
    return AreaIntelligence(**defaults)


def test_weights_sum_to_one():
    assert sum(WEIGHTS.values()) == 1.0


def test_full_data_case_scores_all_dimensions():
    prop = _make_property()
    area_intel = _make_area_intel()
    result = score_property_decision(prop, area_intel=area_intel, comparable_count=3)
    assert set(result.dimensions.keys()) == set(WEIGHTS.keys())
    assert result.omitted_dimensions == []
    assert 0 <= result.overall <= 100
    for dim in result.dimensions.values():
        assert dim.reason


def test_missing_amenities_excludes_dimension_and_renormalizes():
    prop = _make_property(
        furnished=None, has_kitchen=False, has_water=False, has_electricity=False,
        has_private_roof=False, has_elevator=False, has_airconditioners=False,
        in_villa=False, has_two_entrances=False, has_separate_electrical_meter=False,
    )
    area_intel = _make_area_intel()
    result = score_property_decision(prop, area_intel=area_intel, comparable_count=1)
    assert "amenities" not in result.dimensions
    assert any(o.startswith("amenities:") for o in result.omitted_dimensions)
    # remaining weights still describe a full 0-100 overall score
    assert 0 <= result.overall <= 100


def test_missing_area_intel_excludes_location_and_area_dimensions():
    prop = _make_property()
    result = score_property_decision(prop, area_intel=None, comparable_count=0)
    assert "location_fit" not in result.dimensions
    assert "area" not in result.dimensions
    assert any(o.startswith("location_fit:") for o in result.omitted_dimensions)
    assert any(o.startswith("area:") for o in result.omitted_dimensions)
    # property_fit, amenities, price_value, listing_confidence should remain
    assert "property_fit" in result.dimensions
    assert "amenities" in result.dimensions


def test_no_price_excludes_price_value_dimension():
    prop = _make_property(monthly_rent=None, sale_price=None)
    result = score_property_decision(prop, area_intel=_make_area_intel())
    assert "price_value" not in result.dimensions
    assert any(o.startswith("price_value:") for o in result.omitted_dimensions)
