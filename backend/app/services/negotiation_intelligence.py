"""Property Intelligence — Negotiation Insight. Deterministic, no LLM. Only
ever computed on top of a `sufficient_data=True` Price Intelligence result
(`app.services.price_intelligence`) — with fewer than 3 comparables there is
no real market midpoint to negotiate against, so this returns `None` rather
than inventing a discussion range. Language is deliberately hedged
("consider", "may be worth") — this never claims a guaranteed outcome.
"""
from dataclasses import dataclass
from typing import Any

from app.models.property import Property

_ABOVE_MARKET_THRESHOLD = 5.0  # percent_difference
_BELOW_MARKET_THRESHOLD = -5.0


@dataclass
class NegotiationInsight:
    asking_price: float
    market_midpoint: float
    discussion_range_low: float
    discussion_range_high: float
    approach: str


def negotiation_insight(prop: Property, price_intelligence: Any) -> NegotiationInsight | None:
    if price_intelligence is None or not getattr(price_intelligence, "sufficient_data", False):
        return None

    asking = getattr(price_intelligence, "asking_rent", None) or getattr(price_intelligence, "asking_price", None)
    # Rent's midpoint is already a currency amount (`market_midpoint`); buy's
    # is a price-per-sqm figure that needs the subject's own size to become
    # a comparable currency amount.
    midpoint = getattr(price_intelligence, "market_midpoint", None)
    if midpoint is None:
        median_per_sqm = getattr(price_intelligence, "comparable_median_price_per_sqm", None)
        if median_per_sqm is not None and prop.size_sq_m:
            midpoint = median_per_sqm * prop.size_sq_m
    pct_diff = price_intelligence.percent_difference
    if asking is None or midpoint is None or pct_diff is None:
        return None

    if pct_diff > _ABOVE_MARKET_THRESHOLD:
        low, high = midpoint, asking * 0.97
        approach = (
            f"This listing is priced above comparable market data — consider opening the discussion closer to "
            f"SAR {midpoint:,.0f}, the market midpoint, and see how much room the other side is willing to give."
        )
    elif pct_diff < _BELOW_MARKET_THRESHOLD:
        low, high = asking, asking * 1.02
        approach = (
            "This listing is already priced below the market midpoint, so there may be limited room to negotiate "
            "on price — it could still be worth asking about flexibility on terms or timing."
        )
    else:
        low, high = asking * 0.97, asking
        approach = (
            "This listing is fairly priced against comparable data — a modest counter-offer within a few percent "
            "may still be worth trying, but don't expect a large concession."
        )

    return NegotiationInsight(
        asking_price=asking,
        market_midpoint=midpoint,
        discussion_range_low=round(min(low, high), 2),
        discussion_range_high=round(max(low, high), 2),
        approach=approach,
    )
