"""Negotiation Signals (Prompt 5) — deterministic, no LLM. All 6 signal
values reachable with correct thresholds; `limited_comparable_data` returned
whenever `sufficient_data` is False, never fabricated from insufficient data.
See docs/implementation/mymakan-negotiations.md "AI behavior".
"""
from app.services import price_intelligence
from app.services.negotiation_signals import NEGOTIATION_SIGNALS, compute_negotiation_signal
from app.services.price_intelligence import BuyPriceIntelligence, RentPriceIntelligence


def _rent(**overrides) -> RentPriceIntelligence:
    defaults = dict(
        sufficient_data=True,
        asking_rent=10_000.0,
        fair_range_low=9_300.0,
        fair_range_high=9_400.0,
        market_midpoint=9_350.0,
        percent_difference=6.4,
        classification="Above Market",
        comparable_count=5,
    )
    defaults.update(overrides)
    return RentPriceIntelligence(**defaults)


def test_reuses_price_intelligence_thresholds_not_a_second_copy():
    """Brief's explicit requirement: don't hardcode a second copy of the
    same percentage bands — import price_intelligence's constants directly."""
    from app.services import negotiation_signals

    assert negotiation_signals._EXCELLENT_VALUE_MAX is price_intelligence._EXCELLENT_VALUE_MAX
    assert negotiation_signals._GOOD_VALUE_MAX is price_intelligence._GOOD_VALUE_MAX


def test_within_market_range():
    pi = _rent()
    signal = compute_negotiation_signal(9_350, pi)  # diff -6.5% (in band), within [9300, 9400]
    assert signal.signal == "within_market_range"
    assert "9,350" in signal.label
    assert "9,300" in signal.label and "9,400" in signal.label


def test_below_market_range():
    pi = _rent()
    signal = compute_negotiation_signal(9_200, pi)  # diff -8% (in band), below fair_low 9300
    assert signal.signal == "below_market_range"
    assert "9,200" in signal.label


def test_above_market_range():
    pi = _rent()
    signal = compute_negotiation_signal(9_450, pi)  # diff -5.5% (in band), above fair_high 9400
    assert signal.signal == "above_market_range"
    assert "9,450" in signal.label


def test_close_to_asking_price():
    pi = _rent()
    signal = compute_negotiation_signal(9_600, pi)  # diff -4% (>= -5%)
    assert signal.signal == "close_to_asking_price"
    assert "9,600" in signal.label and "10,000" in signal.label


def test_close_to_asking_price_when_offer_at_or_above_asking():
    pi = _rent()
    signal = compute_negotiation_signal(10_200, pi)  # offer above asking entirely
    assert signal.signal == "close_to_asking_price"


def test_significant_discount_requested():
    pi = _rent()
    signal = compute_negotiation_signal(8_000, pi)  # diff -20% (<= -15%)
    assert signal.signal == "significant_discount_requested"
    assert "8,000" in signal.label and "20%" in signal.label


def test_limited_comparable_data_when_insufficient():
    pi = RentPriceIntelligence(sufficient_data=False, asking_rent=10_000.0, comparable_count=1)
    signal = compute_negotiation_signal(9_000, pi)
    assert signal.signal == "limited_comparable_data"


def test_limited_comparable_data_when_price_intelligence_is_none():
    signal = compute_negotiation_signal(9_000, None)
    assert signal.signal == "limited_comparable_data"


def test_never_fabricates_a_market_signal_from_missing_fields():
    """Even with sufficient_data=True, missing fair-range fields must not be
    silently treated as a market-range signal."""
    pi = RentPriceIntelligence(sufficient_data=True, asking_rent=10_000.0, comparable_count=5)
    signal = compute_negotiation_signal(9_000, pi)
    assert signal.signal == "limited_comparable_data"


def test_all_six_signal_values_reachable():
    pi = _rent()
    seen = {
        compute_negotiation_signal(9_350, pi).signal,
        compute_negotiation_signal(9_200, pi).signal,
        compute_negotiation_signal(9_450, pi).signal,
        compute_negotiation_signal(9_600, pi).signal,
        compute_negotiation_signal(8_000, pi).signal,
        compute_negotiation_signal(9_000, RentPriceIntelligence(sufficient_data=False)).signal,
    }
    assert seen == set(NEGOTIATION_SIGNALS)


# ── Buy variant (estimated_value_low/high instead of fair_range_low/high) ──


def _buy(**overrides) -> BuyPriceIntelligence:
    defaults = dict(
        sufficient_data=True,
        asking_price=1_000_000.0,
        price_per_sqm=5_000.0,
        comparable_median_price_per_sqm=4_800.0,
        estimated_value_low=930_000.0,
        estimated_value_high=940_000.0,
        percent_difference=4.2,
        classification="Fair",
        comparable_count=5,
    )
    defaults.update(overrides)
    return BuyPriceIntelligence(**defaults)


def test_buy_variant_within_market_range():
    pi = _buy()
    signal = compute_negotiation_signal(935_000, pi)  # diff -6.5%, within [930k, 940k]
    assert signal.signal == "within_market_range"


def test_buy_variant_significant_discount_requested():
    pi = _buy()
    signal = compute_negotiation_signal(800_000, pi)  # diff -20%
    assert signal.signal == "significant_discount_requested"


def test_buy_variant_limited_comparable_data():
    pi = BuyPriceIntelligence(sufficient_data=False, asking_price=1_000_000.0, comparable_count=1)
    signal = compute_negotiation_signal(900_000, pi)
    assert signal.signal == "limited_comparable_data"
