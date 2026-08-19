"""Price Intelligence (Rent + Buy): fair-range calc (median + IQR-style
spread), classification across all 5 deviation buckets, insufficient-data
fallback (never fabricates a range with <3 comparables), and the
factors-used list only reporting fields the subject property actually has
data for. Runs against the real dev Postgres DB (see conftest.py) —
isolated per test with a unique city so seeded data never interferes.
"""
import uuid

import pytest

from app.models.property import Property
from app.services.price_intelligence import (
    MIN_COMPARABLES,
    buy_price_intelligence,
    rent_price_intelligence,
)


def _city() -> str:
    return f"TestCity-{uuid.uuid4().hex[:8]}"


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Test Property", area="Test District", city="TestCity", listing_type="rent",
        status="Published", bedrooms=2,
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def test_rent_classification_across_all_five_buckets(db_session):
    cases = {
        2500: "Excellent Value",
        2800: "Good Value",
        3000: "Fair",
        3300: "Above Market",
        4000: "Significantly Above Market",
    }
    for asking, expected in cases.items():
        # Fresh city per case so each subject's own listing never pollutes
        # another case's comparable pool.
        city = _city()
        for rent in (1000, 2000, 3000, 4000, 5000):
            _make_property(db_session, city=city, monthly_rent=rent, listing_type="rent")
        subject = _make_property(db_session, city=city, monthly_rent=asking, listing_type="rent")
        result = rent_price_intelligence(db_session, subject)
        assert result.sufficient_data is True
        assert result.classification == expected, f"asking={asking} expected={expected} got={result.classification}"
        assert result.market_midpoint == pytest.approx(3000)
        assert result.fair_range_low == pytest.approx(2000)
        assert result.fair_range_high == pytest.approx(4000)


def test_rent_insufficient_data_never_fabricates_range(db_session):
    city = _city()
    _make_property(db_session, city=city, monthly_rent=5000, listing_type="rent")
    subject = _make_property(db_session, city=city, monthly_rent=6000, listing_type="rent")

    result = rent_price_intelligence(db_session, subject)
    assert result.sufficient_data is False
    assert result.fair_range_low is None
    assert result.fair_range_high is None
    assert result.classification is None
    assert result.explanation is not None
    assert result.comparable_count < MIN_COMPARABLES


def test_buy_price_per_sqm_and_range_calc(db_session):
    city = _city()
    # price/sqm: 1000, 2000, 3000, 4000, 5000 -> median 3000, Q1 2000, Q3 4000
    for price_per_sqm in (1000, 2000, 3000, 4000, 5000):
        _make_property(
            db_session, city=city, listing_type="sale", sale_price=price_per_sqm * 100, size_sq_m=100,
        )
    subject = _make_property(db_session, city=city, listing_type="sale", sale_price=300_000, size_sq_m=100)

    result = buy_price_intelligence(db_session, subject)
    assert result.sufficient_data is True
    assert result.price_per_sqm == pytest.approx(3000)
    assert result.comparable_median_price_per_sqm == pytest.approx(3000)
    assert result.estimated_value_low == pytest.approx(2000 * 100)
    assert result.estimated_value_high == pytest.approx(4000 * 100)
    assert result.classification == "Fair"


def test_buy_insufficient_data_never_fabricates_range(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, listing_type="sale", sale_price=500_000, size_sq_m=120)

    result = buy_price_intelligence(db_session, subject)
    assert result.sufficient_data is False
    assert result.estimated_value_low is None
    assert result.estimated_value_high is None
    assert result.explanation is not None


def test_buy_missing_size_is_insufficient():
    subject = Property(title="No size", area="X", city="Y", listing_type="sale", sale_price=500_000, size_sq_m=None)
    # No DB needed — short-circuits before any query.
    from unittest.mock import MagicMock
    result = buy_price_intelligence(MagicMock(), subject)
    assert result.sufficient_data is False


def test_factors_used_only_lists_fields_with_real_data(db_session):
    city = _city()
    for rent in (4000, 5000, 6000):
        _make_property(db_session, city=city, monthly_rent=rent, listing_type="rent", property_type="Apartment", bedrooms=2)
    subject = _make_property(
        db_session, city=city, monthly_rent=5500, listing_type="rent",
        property_type="Apartment", bedrooms=2, bathrooms=None, furnished=None, size_sq_m=None,
    )

    result = rent_price_intelligence(db_session, subject)
    assert result.sufficient_data is True
    assert set(result.factors_used) == {"district", "type", "bedrooms"}
    assert "bathrooms" not in result.factors_used
    assert "furnishing" not in result.factors_used
    assert "size" not in result.factors_used
