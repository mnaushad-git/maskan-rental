"""Data Confidence: High vs Moderate classification from real listing-
completeness signals, and reason-string content — must never imply
government/regulatory verification, only platform-observed signals.
"""
from app.models.area_intelligence import AreaIntelligence
from app.models.listing_image import ListingImage
from app.models.property import Property
from app.services.data_confidence import compute_data_confidence


def _complete_property(**overrides) -> Property:
    defaults = dict(
        title="Test", area="Al Yasmin", city="Riyadh", listing_type="rent",
        bedrooms=3, bathrooms=2, size_sq_m=150, property_type="Apartment",
        latitude=24.7, longitude=46.6,
    )
    defaults.update(overrides)
    return Property(**defaults)


def _area_intel(**overrides) -> AreaIntelligence:
    defaults = dict(area_name="Al Yasmin", city="Riyadh", area_score=80)
    defaults.update(overrides)
    return AreaIntelligence(**defaults)


def test_high_confidence_when_all_signals_present(monkeypatch):
    prop = _complete_property()
    prop.listing_images = [ListingImage(url="https://example.com/1.jpg", display_order=0)]
    monkeypatch.setattr(Property, "mediator_is_verified", True, raising=False)

    result = compute_data_confidence(prop, area_intel=_area_intel(), comparable_count=5)
    assert result.level == "High"
    assert result.signals_present == result.signals_total
    assert "government" not in result.reason.lower()


def test_moderate_confidence_when_signals_missing():
    prop = _complete_property(bedrooms=None, bathrooms=None, latitude=None, longitude=None)
    result = compute_data_confidence(prop, area_intel=None, comparable_count=0)
    assert result.level == "Moderate"
    assert result.signals_present < result.signals_total
    assert "missing" in result.reason.lower()
    assert "government" not in result.reason.lower()


def test_reason_string_never_implies_government_verification():
    prop = _complete_property()
    for area_intel, count in [(None, 0), (_area_intel(), 10)]:
        result = compute_data_confidence(prop, area_intel=area_intel, comparable_count=count)
        assert "government" not in result.reason.lower()
        assert "official" not in result.reason.lower()
