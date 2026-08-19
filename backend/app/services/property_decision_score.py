"""Property Intelligence — deterministic Property Decision Score. No LLM is
involved (see docs/implementation/mymakan-property-intelligence.md). Mirrors
`app.services.home_finder_scoring`'s pattern: a central `WEIGHTS` dict that
sums to 1.0, one scoring function per dimension, and missing-data dimensions
excluded with the remaining weights renormalized rather than defaulted to a
guessed value.

`price_value` and `location_fit` are intentionally placeholder-simple here —
Price Intelligence (Prompt 2) and Comparable Properties (Prompt 3) don't exist
yet. The function signature already accepts their richer inputs as optional
so a later prompt can wire them in without changing this signature: callers
that only have a `Property` row keep working unchanged.
"""
from dataclasses import dataclass, field

from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property

# Dimension weights — must sum to 1.0. Adjust here only.
WEIGHTS: dict[str, float] = {
    "price_value": 0.20,
    "location_fit": 0.15,
    "property_fit": 0.20,
    "amenities": 0.15,
    "area": 0.15,
    "listing_confidence": 0.15,
}

# Same verifiable amenity vocabulary AI Home Finder scores
# (app.services.home_finder_scoring.AMENITY_FIELD_MAP) plus `furnished`.
_AMENITY_FIELDS: tuple[str, ...] = (
    "has_kitchen",
    "has_water",
    "has_electricity",
    "has_private_roof",
    "has_elevator",
    "has_airconditioners",
    "in_villa",
    "has_two_entrances",
    "has_separate_electrical_meter",
)

_PRICE_CLASSIFICATION_SCORES: dict[str, float] = {
    "Excellent Value": 1.0,
    "Good Value": 0.85,
    "Fair": 0.6,
    "Above Market": 0.35,
    "Significantly Above Market": 0.15,
}


@dataclass
class DimResult:
    score: float | None = None
    reason: str | None = None
    omitted_reason: str | None = None


@dataclass
class DimensionScore:
    score: int
    reason: str


@dataclass
class PropertyDecisionScore:
    overall: int
    dimensions: dict[str, DimensionScore] = field(default_factory=dict)
    omitted_dimensions: list[str] = field(default_factory=list)


def _price_value(prop: Property, price_classification: str | None) -> DimResult:
    if price_classification is not None:
        score = _PRICE_CLASSIFICATION_SCORES.get(price_classification)
        if score is not None:
            return DimResult(score=score, reason=f"Priced as {price_classification} vs. comparable listings")
    price = prop.monthly_rent if prop.listing_type == "rent" else prop.sale_price
    if price is None:
        return DimResult(omitted_reason="no price recorded on this listing")
    return DimResult(score=0.6, reason="Price is on file; a fair-range comparison isn't available yet")


def _location_fit(prop: Property, area_intel: AreaIntelligence | None) -> DimResult:
    if area_intel is None:
        return DimResult(omitted_reason="no area intelligence data for this district")
    if area_intel.traffic_score is not None:
        score = max(0.0, min(1.0, (100 - area_intel.traffic_score) / 100))
        return DimResult(score=score, reason=f"{prop.area} traffic/connectivity score: {round(100 - area_intel.traffic_score)}/100")
    if area_intel.commute_minutes_to_center is not None:
        minutes = area_intel.commute_minutes_to_center
        score = 1.0 if minutes <= 20 else 0.6 if minutes <= 40 else 0.3
        return DimResult(score=score, reason=f"~{minutes} min to city center")
    return DimResult(omitted_reason="no connectivity data for this district")


def _property_fit(prop: Property) -> DimResult:
    fields = (prop.bedrooms, prop.bathrooms, prop.size_sq_m, prop.property_type, prop.living_rooms)
    present = sum(1 for f in fields if f is not None)
    score = present / len(fields)
    return DimResult(score=score, reason=f"{present}/{len(fields)} core specs on file (bedrooms, bathrooms, size, type, living rooms)")


def _amenities(prop: Property) -> DimResult:
    has_furnished_signal = prop.furnished is not None
    true_flags = [f for f in _AMENITY_FIELDS if getattr(prop, f, False)]
    if not has_furnished_signal and not true_flags:
        return DimResult(omitted_reason="no amenity data recorded for this listing")
    total = len(_AMENITY_FIELDS) + 1  # + furnished
    satisfied = len(true_flags) + (1 if prop.furnished == "Furnished" else 0)
    score = satisfied / total
    return DimResult(score=score, reason=f"{satisfied}/{total} tracked amenities present")


def _area(prop: Property, area_intel: AreaIntelligence | None) -> DimResult:
    if area_intel is None or area_intel.area_score is None:
        return DimResult(omitted_reason="no area intelligence score for this district")
    score = max(0.0, min(1.0, area_intel.area_score / 100))
    return DimResult(score=score, reason=f"{prop.area} has an overall area score of {round(area_intel.area_score)}/100")


def _listing_confidence(prop: Property, comparable_count: int) -> DimResult:
    signals = [
        bool(prop.listing_images),
        prop.latitude is not None and prop.longitude is not None,
        prop.mediator_is_verified,
        comparable_count > 0,
    ]
    score = sum(1 for s in signals if s) / len(signals)
    return DimResult(score=score, reason=f"{sum(1 for s in signals if s)}/{len(signals)} listing-quality signals present")


def score_property_decision(
    prop: Property,
    area_intel: AreaIntelligence | None = None,
    comparable_count: int = 0,
    price_classification: str | None = None,
) -> PropertyDecisionScore:
    dims: dict[str, DimResult] = {
        "price_value": _price_value(prop, price_classification),
        "location_fit": _location_fit(prop, area_intel),
        "property_fit": _property_fit(prop),
        "amenities": _amenities(prop),
        "area": _area(prop, area_intel),
        "listing_confidence": _listing_confidence(prop, comparable_count),
    }

    available = {k: v for k, v in dims.items() if v.score is not None}
    omitted = [f"{k}: {v.omitted_reason}" for k, v in dims.items() if v.score is None]

    weight_sum = sum(WEIGHTS[k] for k in available)
    if weight_sum > 0:
        fraction = sum(WEIGHTS[k] * available[k].score for k in available) / weight_sum
    else:
        fraction = 0.0
    overall = round(max(0.0, min(1.0, fraction)) * 100)

    dimension_scores = {
        k: DimensionScore(score=round(v.score * 100), reason=v.reason)
        for k, v in available.items()
    }

    return PropertyDecisionScore(overall=overall, dimensions=dimension_scores, omitted_dimensions=omitted)
