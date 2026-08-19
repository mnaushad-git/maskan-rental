"""Property Intelligence — Personalized Fit. Deterministic, no LLM. Reuses
`app.services.home_finder_scoring`'s per-dimension matching functions
directly (budget/location/bedrooms/property-type/required-amenities) rather
than reimplementing criteria-matching rules — this module only adds the
match/moderate/miss labeling and human-readable row labels Property
Intelligence's "How it fits your needs" section needs on top of that
existing scoring logic.
"""
from dataclasses import dataclass, field

from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property
from app.schemas.home_finder import HomeFinderCriteria
from app.services import home_finder_scoring
from app.services.home_finder_scoring import DimResult


def _status(dim: DimResult) -> str:
    if dim.trade_off is None:
        return "match"
    return "moderate" if dim.score is not None and dim.score >= 0.5 else "miss"


def _budget_label(criteria: HomeFinderCriteria) -> str:
    if criteria.max_price is not None:
        return f"Under SAR {criteria.max_price:,.0f}"
    return f"At least SAR {criteria.min_price:,.0f}"


@dataclass
class FitRow:
    label: str
    status: str  # "match" | "moderate" | "miss"
    detail: str


@dataclass
class PersonalizedFit:
    rows: list[FitRow] = field(default_factory=list)
    priorities_matched: int = 0
    priorities_total: int = 0
    summary: str = ""


def personalized_fit(
    prop: Property,
    criteria: HomeFinderCriteria | None,
    area_intel: dict[tuple[str, str], AreaIntelligence] | None = None,
) -> PersonalizedFit | None:
    """Returns `None` when no criteria were supplied (or the supplied
    criteria set no scorable field) — the caller must never fabricate a
    personalized-fit section when the user arrived with no stated
    preferences."""
    if criteria is None:
        return None

    candidates: list[tuple[str, DimResult]] = []

    budget = home_finder_scoring._budget_fit(criteria, prop)
    if budget.score is not None:
        candidates.append((_budget_label(criteria), budget))

    location = home_finder_scoring._location_fit(criteria, prop)
    if location.score is not None:
        candidates.append((f"In {', '.join(criteria.districts)}", location))

    bedrooms = home_finder_scoring._bedrooms_fit(criteria, prop)
    if bedrooms.score is not None:
        candidates.append((f"{criteria.bedrooms}+ Bedrooms", bedrooms))

    prop_type = home_finder_scoring._property_type_fit(criteria, prop)
    if prop_type.score is not None:
        candidates.append((criteria.property_type or "Property type", prop_type))

    amenities = home_finder_scoring._required_amenities_fit(criteria, prop)
    if amenities.score is not None:
        candidates.append(("Must-have amenities", amenities))

    if not candidates:
        return None

    rows = [FitRow(label=label, status=_status(dim), detail=(dim.reason or dim.trade_off or "")) for label, dim in candidates]
    matched = sum(1 for r in rows if r.status == "match")
    total = len(rows)
    return PersonalizedFit(rows=rows, priorities_matched=matched, priorities_total=total, summary=f"{matched}/{total} priorities matched")
