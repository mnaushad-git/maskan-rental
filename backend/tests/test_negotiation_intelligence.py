"""Negotiation Insight: omitted entirely when Price Intelligence has
insufficient comparables (or is absent), and the discussion range direction
matches whether the listing is priced above/below/at the market midpoint.
Never claims a guaranteed outcome.
"""
from dataclasses import dataclass

from app.models.property import Property
from app.services.negotiation_intelligence import negotiation_insight


@dataclass
class _FakePriceIntel:
    sufficient_data: bool
    asking_rent: float | None = None
    market_midpoint: float | None = None
    percent_difference: float | None = None


def _property(**overrides) -> Property:
    defaults = dict(title="T", area="A", city="C", listing_type="rent", status="Published")
    defaults.update(overrides)
    return Property(**defaults)


def test_negotiation_omitted_when_price_intelligence_none():
    assert negotiation_insight(_property(), None) is None


def test_negotiation_omitted_when_insufficient_data():
    insufficient = _FakePriceIntel(sufficient_data=False)
    assert negotiation_insight(_property(), insufficient) is None


def test_negotiation_present_when_above_market():
    intel = _FakePriceIntel(sufficient_data=True, asking_rent=11_000, market_midpoint=10_000, percent_difference=10.0)
    insight = negotiation_insight(_property(), intel)
    assert insight is not None
    assert insight.discussion_range_low == 10_000
    assert insight.asking_price == 11_000
    assert "guarantee" not in insight.approach.lower()


def test_negotiation_present_when_below_market():
    intel = _FakePriceIntel(sufficient_data=True, asking_rent=9_000, market_midpoint=10_000, percent_difference=-10.0)
    insight = negotiation_insight(_property(), intel)
    assert insight is not None
    assert insight.discussion_range_low == 9_000
    assert "guarantee" not in insight.approach.lower()
