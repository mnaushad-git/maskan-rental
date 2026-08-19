"""Property Intelligence — Price Intelligence (Rent + Buy). Deterministic,
no LLM (see docs/implementation/mymakan-property-intelligence.md). This is a
distinct, additive capability from the existing AI `rental_score` endpoint
(`app.api.routes.ai.rental_score` / `_deterministic_rental_score`), which is
a 0-100 quality/value badge derived from a single district *average*. This
module instead builds a fair *range* from the actual comparable-listing
*distribution*, using an interquartile-style spread (25th/75th percentile)
around the median — simple, explainable, and doesn't assume a normal
distribution the way a mean+stddev approach would.

Comparable retrieval reuses `PropertyFilterCriteria`/`build_property_filters`
(`app.core.search.filters`) for the base filters (transaction type, city,
district, property type), the same filter vocabulary the rest of the search
surface shares, plus additional band filters (bedrooms/size/bathrooms) and an
exact furnishing match layered on top only when the subject property has real
data for that field. If the strict (district-scoped) query doesn't return
enough comparables, the district constraint is dropped and the query is
retried city-wide before giving up — bounded to `_COMPARABLE_QUERY_LIMIT`
rows either way, no N+1.
"""
import math
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.search.filters import PropertyFilterCriteria, build_property_filters
from app.models.property import Property

MIN_COMPARABLES = 3
_COMPARABLE_QUERY_LIMIT = 50

# Central deviation thresholds — % difference of asking price/price-per-sqm
# vs. the comparable-set median. Adjust here only.
_EXCELLENT_VALUE_MAX = -0.15
_GOOD_VALUE_MAX = -0.05
_FAIR_MAX = 0.05
_ABOVE_MARKET_MAX = 0.15


def _classify(percent_diff_fraction: float) -> str:
    if percent_diff_fraction <= _EXCELLENT_VALUE_MAX:
        return "Excellent Value"
    if percent_diff_fraction <= _GOOD_VALUE_MAX:
        return "Good Value"
    if percent_diff_fraction < _FAIR_MAX:
        return "Fair"
    if percent_diff_fraction < _ABOVE_MARKET_MAX:
        return "Above Market"
    return "Significantly Above Market"


def _median(sorted_values: list[float]) -> float:
    return _percentile(sorted_values, 0.5)


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    idx = (len(sorted_values) - 1) * pct
    lower, upper = math.floor(idx), math.ceil(idx)
    if lower == upper:
        return sorted_values[int(idx)]
    frac = idx - lower
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * frac


def _factors_used(prop: Property) -> list[str]:
    factors = []
    if prop.area:
        factors.append("district")
    if prop.property_type:
        factors.append("type")
    if prop.bedrooms is not None:
        factors.append("bedrooms")
    if prop.bathrooms is not None:
        factors.append("bathrooms")
    if prop.size_sq_m is not None:
        factors.append("size")
    if prop.furnished:
        factors.append("furnishing")
    return factors


def _base_filters(prop: Property, transaction_type: str, *, include_district: bool) -> list:
    pf = PropertyFilterCriteria(
        transaction_type=transaction_type,
        city=prop.city,
        districts=[prop.area] if include_district and prop.area else [],
        property_type=prop.property_type,
        furnishing=prop.furnished if include_district else None,
    )
    filters = build_property_filters(pf)
    filters.append(Property.id != prop.id)
    if prop.bedrooms is not None:
        filters.append(Property.bedrooms.between(max(0, prop.bedrooms - 1), prop.bedrooms + 1))
    if include_district and prop.bathrooms is not None:
        filters.append(Property.bathrooms.between(max(0, prop.bathrooms - 1), prop.bathrooms + 1))
    if prop.size_sq_m:
        filters.append(Property.size_sq_m.between(prop.size_sq_m * 0.75, prop.size_sq_m * 1.25))
    return filters


def _fetch_comparables(db: Session, prop: Property, transaction_type: str) -> list[Property]:
    stmt = select(Property).where(*_base_filters(prop, transaction_type, include_district=True)).limit(_COMPARABLE_QUERY_LIMIT)
    rows = list(db.scalars(stmt).all())
    if len(rows) >= MIN_COMPARABLES:
        return rows
    stmt_broad = select(Property).where(*_base_filters(prop, transaction_type, include_district=False)).limit(_COMPARABLE_QUERY_LIMIT)
    return list(db.scalars(stmt_broad).all())


@dataclass
class RentPriceIntelligence:
    sufficient_data: bool
    asking_rent: float | None = None
    fair_range_low: float | None = None
    fair_range_high: float | None = None
    market_midpoint: float | None = None
    percent_difference: float | None = None
    classification: str | None = None
    factors_used: list[str] = field(default_factory=list)
    comparable_count: int = 0
    explanation: str | None = None


@dataclass
class BuyPriceIntelligence:
    sufficient_data: bool
    asking_price: float | None = None
    price_per_sqm: float | None = None
    comparable_median_price_per_sqm: float | None = None
    estimated_value_low: float | None = None
    estimated_value_high: float | None = None
    percent_difference: float | None = None
    classification: str | None = None
    factors_used: list[str] = field(default_factory=list)
    comparable_count: int = 0
    explanation: str | None = None


def rent_price_intelligence(db: Session, prop: Property) -> RentPriceIntelligence:
    if not prop.monthly_rent:
        return RentPriceIntelligence(sufficient_data=False, explanation="No asking rent recorded for this listing.")

    comparables = _fetch_comparables(db, prop, "rent")
    prices = sorted(c.monthly_rent for c in comparables if c.monthly_rent)
    if len(prices) < MIN_COMPARABLES:
        return RentPriceIntelligence(
            sufficient_data=False,
            asking_rent=prop.monthly_rent,
            comparable_count=len(prices),
            explanation=f"Only {len(prices)} comparable rent listing(s) found — not enough to estimate a fair range.",
        )

    median = _median(prices)
    q1, q3 = _percentile(prices, 0.25), _percentile(prices, 0.75)
    pct_diff = (prop.monthly_rent - median) / median if median else 0.0

    return RentPriceIntelligence(
        sufficient_data=True,
        asking_rent=prop.monthly_rent,
        fair_range_low=round(q1, 2),
        fair_range_high=round(q3, 2),
        market_midpoint=round(median, 2),
        percent_difference=round(pct_diff * 100, 1),
        classification=_classify(pct_diff),
        factors_used=_factors_used(prop),
        comparable_count=len(prices),
    )


def buy_price_intelligence(db: Session, prop: Property) -> BuyPriceIntelligence:
    if not prop.sale_price or not prop.size_sq_m:
        return BuyPriceIntelligence(sufficient_data=False, explanation="Sale price or size (sqm) not recorded for this listing.")

    comparables = _fetch_comparables(db, prop, "sale")
    per_sqm = sorted(c.sale_price / c.size_sq_m for c in comparables if c.sale_price and c.size_sq_m)
    if len(per_sqm) < MIN_COMPARABLES:
        return BuyPriceIntelligence(
            sufficient_data=False,
            asking_price=prop.sale_price,
            price_per_sqm=round(prop.sale_price / prop.size_sq_m, 2),
            comparable_count=len(per_sqm),
            explanation=f"Only {len(per_sqm)} comparable sale listing(s) found — not enough to estimate a fair range.",
        )

    subject_per_sqm = prop.sale_price / prop.size_sq_m
    median = _median(per_sqm)
    q1, q3 = _percentile(per_sqm, 0.25), _percentile(per_sqm, 0.75)
    pct_diff = (subject_per_sqm - median) / median if median else 0.0

    return BuyPriceIntelligence(
        sufficient_data=True,
        asking_price=prop.sale_price,
        price_per_sqm=round(subject_per_sqm, 2),
        comparable_median_price_per_sqm=round(median, 2),
        estimated_value_low=round(q1 * prop.size_sq_m, 2),
        estimated_value_high=round(q3 * prop.size_sq_m, 2),
        percent_difference=round(pct_diff * 100, 1),
        classification=_classify(pct_diff),
        factors_used=_factors_used(prop),
        comparable_count=len(per_sqm),
    )
