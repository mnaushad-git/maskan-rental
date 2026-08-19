"""AI Negotiation & Offer Management — Negotiation Signals. Deterministic, no
LLM (see docs/implementation/mymakan-negotiations.md "AI behavior"). Classifies
a single offer amount against Price Intelligence's fair-range data, so
`negotiation_ai.py`'s AI guidance is grounded in a stable, testable
classification rather than asking the model to eyeball the numbers itself.

Deliberately reuses `price_intelligence.py`'s existing deviation thresholds
(imported directly, not copied) so a negotiation signal and the Price
Intelligence "Excellent Value"/"Above Market"/etc. classification badge never
disagree about where the percentage boundaries sit.
"""
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.services.price_intelligence import _EXCELLENT_VALUE_MAX, _GOOD_VALUE_MAX

# Exact names from brief §14 — do not rename without updating the brief.
NEGOTIATION_SIGNALS = (
    "within_market_range",
    "below_market_range",
    "above_market_range",
    "close_to_asking_price",
    "significant_discount_requested",
    "limited_comparable_data",
)


@dataclass
class NegotiationSignal:
    signal: str
    # One-line deterministic label that already includes the numeric basis
    # (e.g. "SAR 68,000 is within the estimated SAR 64,000-71,000 market
    # range") — this is what negotiation_ai.py grounds its AI/fallback text
    # in, so the label itself must never be vague.
    label: str


def _fair_range(price_intelligence: Any) -> tuple[float | None, float | None]:
    """RentPriceIntelligence uses fair_range_low/high; BuyPriceIntelligence
    uses estimated_value_low/high (a currency-amount range, already
    multiplied by the subject's size — see price_intelligence.py). Try both
    rather than branching on a transaction-type string the caller would have
    to pass in separately."""
    low = getattr(price_intelligence, "fair_range_low", None)
    high = getattr(price_intelligence, "fair_range_high", None)
    if low is not None and high is not None:
        return low, high
    return getattr(price_intelligence, "estimated_value_low", None), getattr(price_intelligence, "estimated_value_high", None)


def _asking_price(price_intelligence: Any) -> float | None:
    return getattr(price_intelligence, "asking_rent", None) or getattr(price_intelligence, "asking_price", None)


def compute_negotiation_signal(offer_amount: Decimal | float, price_intelligence: Any) -> NegotiationSignal:
    """Returns exactly one of the six `NEGOTIATION_SIGNALS` values. Never
    fabricates a market-relative signal from insufficient data — returns
    `limited_comparable_data` whenever `price_intelligence.sufficient_data`
    is False (or the fields a signal needs aren't actually present).

    Decision order (offer vs. asking price first, then offer vs. the fair
    market range — using price_intelligence.py's own fractional deviation
    thresholds `_EXCELLENT_VALUE_MAX` (-15%) and `_GOOD_VALUE_MAX` (-5%) so
    "close to asking" / "significant discount" read naturally against the
    same bands the price-fairness classification already uses):

    1. offer <= asking * (1 + _EXCELLENT_VALUE_MAX)  -> significant_discount_requested
       (offer is 15%+ below asking)
    2. offer >= asking * (1 + _GOOD_VALUE_MAX)        -> close_to_asking_price
       (offer is within 5% of (or above) asking)
    3. otherwise (offer is 5%-15% below asking), classify against the fair
       market range: within / below / above.
    """
    if price_intelligence is None or not getattr(price_intelligence, "sufficient_data", False):
        return NegotiationSignal(
            signal="limited_comparable_data",
            label="Not enough comparable listings are available to assess this offer against market data.",
        )

    asking = _asking_price(price_intelligence)
    fair_low, fair_high = _fair_range(price_intelligence)
    if asking is None or not asking or fair_low is None or fair_high is None:
        return NegotiationSignal(
            signal="limited_comparable_data",
            label="Not enough comparable listings are available to assess this offer against market data.",
        )

    offer = float(offer_amount)
    diff_from_asking = (offer - asking) / asking

    if diff_from_asking <= _EXCELLENT_VALUE_MAX:
        pct = abs(diff_from_asking) * 100
        return NegotiationSignal(
            signal="significant_discount_requested",
            label=f"SAR {offer:,.0f} is {pct:.0f}% below the SAR {asking:,.0f} asking price - a significant discount request.",
        )

    if diff_from_asking >= _GOOD_VALUE_MAX:
        return NegotiationSignal(
            signal="close_to_asking_price",
            label=f"SAR {offer:,.0f} is close to the SAR {asking:,.0f} asking price, leaving little room to negotiate.",
        )

    if fair_low <= offer <= fair_high:
        return NegotiationSignal(
            signal="within_market_range",
            label=f"SAR {offer:,.0f} is within the estimated SAR {fair_low:,.0f}-{fair_high:,.0f} market range.",
        )
    if offer < fair_low:
        return NegotiationSignal(
            signal="below_market_range",
            label=f"SAR {offer:,.0f} is below the estimated SAR {fair_low:,.0f}-{fair_high:,.0f} market range.",
        )
    return NegotiationSignal(
        signal="above_market_range",
        label=f"SAR {offer:,.0f} is above the estimated SAR {fair_low:,.0f}-{fair_high:,.0f} market range.",
    )
