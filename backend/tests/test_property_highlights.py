"""Property Highlights: strengths/considerations/things-to-verify are only
ever generated from real, evidenced signals — missing area intelligence and
missing furnishing data must surface as "things to verify," never as a
fabricated claim.
"""
from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property
from app.services.property_highlights import property_highlights


def _property(**overrides) -> Property:
    defaults = dict(
        title="Test", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, status="Published", latitude=24.7, longitude=46.6,
        property_age_years=2, furnished="Furnished",
    )
    defaults.update(overrides)
    return Property(**defaults)


def test_missing_area_intel_lands_in_things_to_verify():
    prop = _property()
    highlights = property_highlights(prop, area_intel=None)
    assert any("area intelligence" in v.lower() for v in highlights.things_to_verify)


def test_missing_furnishing_lands_in_things_to_verify():
    prop = _property(furnished=None)
    highlights = property_highlights(prop, area_intel=AreaIntelligence(area_name="Al Yasmin", city="Riyadh", area_score=80))
    assert any("furnishing" in v.lower() for v in highlights.things_to_verify)


def test_high_area_score_is_a_strength_not_fabricated_elsewhere():
    prop = _property()
    area_intel = AreaIntelligence(area_name="Al Yasmin", city="Riyadh", area_score=90)
    highlights = property_highlights(prop, area_intel=area_intel)
    assert any("Al Yasmin" in s for s in highlights.strengths)
    assert not any("area intelligence" in v.lower() for v in highlights.things_to_verify)


def test_above_market_price_classification_is_a_consideration():
    class _FakePriceIntel:
        sufficient_data = True
        classification = "Above Market"
        comparable_count = 5

    prop = _property()
    highlights = property_highlights(prop, price_intelligence=_FakePriceIntel())
    assert any("above market" in c.lower() for c in highlights.considerations)
