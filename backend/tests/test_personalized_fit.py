"""Personalized Fit: no-criteria case (never fabricates personalization),
full-match vs. partial-match row status, reusing home_finder_scoring's
dimension functions rather than duplicating criteria-matching rules.
"""
from app.models.property import Property
from app.schemas.home_finder import HomeFinderCriteria
from app.services.personalized_fit import personalized_fit


def _property(**overrides) -> Property:
    defaults = dict(
        title="Test", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, property_type="Apartment", status="Published",
    )
    defaults.update(overrides)
    return Property(**defaults)


def test_no_criteria_returns_none():
    prop = _property()
    assert personalized_fit(prop, None) is None


def test_empty_criteria_returns_none():
    prop = _property()
    assert personalized_fit(prop, HomeFinderCriteria()) is None


def test_full_match_all_rows_match():
    prop = _property(bedrooms=3, area="Al Yasmin", property_type="Apartment", monthly_rent=6000.0)
    criteria = HomeFinderCriteria(
        max_price=75_000, districts=["Al Yasmin"], bedrooms=3, property_type="Apartment", transaction_type="rent",
    )
    fit = personalized_fit(prop, criteria)
    assert fit is not None
    assert fit.priorities_matched == fit.priorities_total
    assert fit.summary == f"{fit.priorities_total}/{fit.priorities_total} priorities matched"
    assert all(row.status == "match" for row in fit.rows)


def test_partial_match_has_mixed_statuses():
    prop = _property(bedrooms=1, area="Outside District", property_type="Apartment", monthly_rent=6000.0)
    criteria = HomeFinderCriteria(
        max_price=75_000, districts=["Al Yasmin"], bedrooms=4, property_type="Apartment", transaction_type="rent",
    )
    fit = personalized_fit(prop, criteria)
    assert fit is not None
    assert fit.priorities_matched < fit.priorities_total
    statuses = {row.status for row in fit.rows}
    assert "miss" in statuses or "moderate" in statuses
