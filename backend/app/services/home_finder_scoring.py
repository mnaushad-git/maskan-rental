"""AI Home Finder — deterministic match scoring (Section 5). No LLM is
involved in computing a score; `app.services.home_finder_ai.explain_match`
may narrate a score afterward but never computes it, same separation of
concerns as `app.services.property_request_matcher`.

Candidate retrieval reuses `PropertyFilterCriteria`/`build_property_filters`
(`app.core.search.filters`) — the same filter vocabulary saved searches and
the Property Request matcher already share — so this never becomes a third,
parallel search implementation. Only `transaction_type`/`city` are applied
as hard DB filters; everything else (budget, district, bedrooms, property
type, amenities, lifestyle, commute) is a *scored* dimension evaluated in
Python over that pool, so a property that's close-but-not-perfect still
shows up in the shortlist, ranked lower — which is what lets Section 13's
"you're close" empty-result experience work without ever showing a literal
blank page.

Weights are centralized in `WEIGHTS` below (Section 5: "Keep weights
centralized and configurable"). A dimension a property/criteria pair has no
real data for is excluded entirely and the remaining weights are
renormalized (Section 5: "If commute data is unavailable, exclude that
dimension and normalize remaining weights" — generalized here to every
dimension, not just commute).

Investment-potential is deliberately NOT scored or exposed as a category
here (Section 8: "Do not fabricate rental yield or appreciation forecasts")
— the platform has no yield/appreciation data to ground it in.
"""
import math
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.geo import CITY_CENTERS, DISTRICT_COORDS, coords_for
from app.core.search.filters import PropertyFilterCriteria, build_property_filters
from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property
from app.schemas.home_finder import HomeFinderCriteria

POOL_LIMIT = 300
MIN_DISPLAY_SCORE = 0.30  # below this, a result is too weak to call a "match" at all

# Dimension weights — must sum to 1.0. Adjust here only; nothing else in the
# app hardcodes a weight for AI Home Finder scoring.
WEIGHTS: dict[str, float] = {
    "budget_fit": 0.22,
    "location_fit": 0.18,
    "bedrooms_fit": 0.15,
    "property_type_fit": 0.08,
    "required_amenities_fit": 0.15,
    "preferred_amenities_fit": 0.05,
    "lifestyle_fit": 0.09,
    "commute_fit": 0.08,
}
# The subset of dimensions that gate "exact match" (Section 13) — a property
# that fails one of these has a real trade-off against a criterion the user
# explicitly set. lifestyle/commute/preferred-amenities are nice-to-have only.
_HARD_DIMENSIONS = ("budget_fit", "location_fit", "bedrooms_fit", "property_type_fit", "required_amenities_fit")

# Only amenities the platform can actually verify from a real Property
# column — see app.schemas.home_finder.SUPPORTED_AMENITIES for the shared
# vocabulary the AI extractor/refiner are constrained to.
AMENITY_FIELD_MAP: dict[str, str] = {
    "elevator": "has_elevator",
    "air_conditioning": "has_airconditioners",
    "kitchen_equipped": "has_kitchen",
    "water_included": "has_water",
    "electricity_included": "has_electricity",
    "private_roof": "has_private_roof",
    "villa_style": "in_villa",
    "two_entrances": "has_two_entrances",
    "separate_electrical_meter": "has_separate_electrical_meter",
}
_AMENITY_LABELS: dict[str, str] = {
    "furnished": "furnished",
    "elevator": "an elevator",
    "air_conditioning": "air conditioning",
    "kitchen_equipped": "an equipped kitchen",
    "water_included": "water included",
    "electricity_included": "electricity included",
    "private_roof": "a private roof",
    "villa_style": "villa-style layout",
    "two_entrances": "two entrances",
    "separate_electrical_meter": "a separate electrical meter",
}

# Well-known named destinations that aren't districts (Section 3's KAFD
# example) — public, approximate landmark coordinates, same spirit as
# app.core.geo's hand-maintained district/city center table.
LANDMARK_COORDS: dict[str, tuple[float, float]] = {
    "kafd": (24.7746, 46.6388),
    "king abdullah financial district": (24.7746, 46.6388),
    "diplomatic quarter": (24.6817, 46.6242),
    "king khalid international airport": (24.9576, 46.6988),
    "riyadh airport": (24.9576, 46.6988),
}
_ASSUMED_CITY_SPEED_KMH = 30.0  # same coarse assumption as property_request_matcher._commute_fit


def _amenity_true(prop: Property, key: str) -> bool:
    if key == "furnished":
        return prop.furnished == "Furnished"
    attr = AMENITY_FIELD_MAP.get(key)
    return bool(getattr(prop, attr, False)) if attr else False


def _amenity_label(key: str) -> str:
    return _AMENITY_LABELS.get(key, key)


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def resolve_commute_target(destination: str | None, city: str | None) -> tuple[float, float] | None:
    """Resolves a free-text commute destination to coordinates using only
    known, real reference points — a landmark, or a district/city name we
    already have coordinates for. Returns None (never a guess) if the
    destination isn't recognized, so callers can honestly exclude the
    commute dimension instead of fabricating a distance."""
    if not destination:
        return None
    key = destination.strip().lower()
    if key in LANDMARK_COORDS:
        return LANDMARK_COORDS[key]
    if city:
        district_key = f"{destination.strip()}|{city.strip()}"
        for name, coords in DISTRICT_COORDS.items():
            if name.lower() == district_key.lower():
                return coords
    if key in {c.lower() for c in CITY_CENTERS}:
        for name, coords in CITY_CENTERS.items():
            if name.lower() == key:
                return coords
    return None


@dataclass
class DimResult:
    score: float | None = None
    reason: str | None = None
    trade_off: str | None = None


def _price_for_compare(criteria: HomeFinderCriteria, prop: Property) -> float | None:
    if criteria.transaction_type == "sale" or (criteria.transaction_type is None and prop.listing_type == "sale"):
        return prop.sale_price
    return prop.monthly_rent * 12 if prop.monthly_rent else None


def _budget_fit(criteria: HomeFinderCriteria, prop: Property) -> DimResult:
    if criteria.max_price is None and criteria.min_price is None:
        return DimResult()
    price = _price_for_compare(criteria, prop)
    if price is None:
        return DimResult()
    is_sale = prop.listing_type == "sale"
    price_label = f"SAR {price:,.0f}" if is_sale else f"SAR {prop.monthly_rent:,.0f}/mo"

    if criteria.max_price is not None:
        if price <= criteria.max_price:
            room = (criteria.max_price - price) / criteria.max_price if criteria.max_price else 0
            score = max(0.6, min(1.0, 1.0 - abs(room - 0.15)))
            reason = f"Within budget ({price_label})"
            trade_off = None
        else:
            overage = (price - criteria.max_price) / criteria.max_price
            score = max(0.0, 0.5 - overage)
            reason = None
            trade_off = f"{price_label} is above your budget"
    else:
        score, reason, trade_off = 0.7, None, None

    if criteria.min_price is not None and price < criteria.min_price:
        score = min(score, 0.4)
        if trade_off is None:
            trade_off = f"{price_label} is below your stated minimum"

    return DimResult(score=score, reason=reason, trade_off=trade_off)


def _location_fit(criteria: HomeFinderCriteria, prop: Property) -> DimResult:
    if not criteria.districts:
        return DimResult()
    preferred = {d.strip().lower() for d in criteria.districts}
    if (prop.area or "").strip().lower() in preferred:
        return DimResult(score=1.0, reason=f"In your preferred area ({prop.area})")
    return DimResult(score=0.25, trade_off=f"In {prop.area}, outside your preferred areas")


def _bedrooms_fit(criteria: HomeFinderCriteria, prop: Property) -> DimResult:
    if criteria.bedrooms is None:
        return DimResult()
    beds = prop.bedrooms or 0
    if beds >= criteria.bedrooms:
        score = 1.0 if beds == criteria.bedrooms else min(1.0, 0.92 + 0.02 * (beds - criteria.bedrooms))
        suffix = "" if beds == criteria.bedrooms else f" (you wanted {criteria.bedrooms}+)"
        return DimResult(score=score, reason=f"{beds} bedrooms{suffix}")
    if beds == criteria.bedrooms - 1:
        return DimResult(score=0.55, trade_off=f"{beds} bedroom{'s' if beds != 1 else ''} — one fewer than you wanted")
    return DimResult(score=0.2, trade_off=f"Only {beds} bedroom{'s' if beds != 1 else ''} vs your {criteria.bedrooms}+")


def _property_type_fit(criteria: HomeFinderCriteria, prop: Property) -> DimResult:
    if not criteria.property_type:
        return DimResult()
    if prop.property_type == criteria.property_type:
        return DimResult(score=1.0, reason=criteria.property_type)
    return DimResult(score=0.3, trade_off=f"{prop.property_type or 'Unspecified type'} instead of {criteria.property_type}")


def _required_amenities_fit(criteria: HomeFinderCriteria, prop: Property) -> DimResult:
    known = [a for a in criteria.required_amenities if a in AMENITY_FIELD_MAP or a == "furnished"]
    if not known:
        return DimResult()
    satisfied = [a for a in known if _amenity_true(prop, a)]
    score = len(satisfied) / len(known)
    if score == 1.0:
        return DimResult(score=score, reason="Has " + ", ".join(_amenity_label(a) for a in known))
    missing = [a for a in known if a not in satisfied]
    return DimResult(score=score, trade_off="Missing " + ", ".join(_amenity_label(a) for a in missing))


def _preferred_amenities_fit(criteria: HomeFinderCriteria, prop: Property) -> DimResult:
    known = [a for a in criteria.preferred_amenities if a in AMENITY_FIELD_MAP or a == "furnished"]
    if not known:
        return DimResult()
    satisfied = [a for a in known if _amenity_true(prop, a)]
    score = len(satisfied) / len(known)
    if satisfied:
        return DimResult(score=score, reason="Also has " + ", ".join(_amenity_label(a) for a in satisfied))
    return DimResult(score=score)


def _lifestyle_fit(criteria: HomeFinderCriteria, prop: Property, area_intel: dict[tuple[str, str], AreaIntelligence]) -> DimResult:
    row = area_intel.get(((prop.area or "").lower(), (prop.city or "").lower()))
    if row is None:
        return DimResult()
    prefs = set(criteria.preferences)
    primary: float | None
    label: str
    if "near_schools" in prefs and row.school_score is not None:
        primary, label = row.school_score, "schools"
    elif "near_healthcare" in prefs and row.healthcare_score is not None:
        primary, label = row.healthcare_score, "healthcare access"
    elif "family_friendly" in prefs and row.family_score is not None:
        primary, label = row.family_score, "family suitability"
    elif "quiet_area" in prefs and row.traffic_score is not None:
        primary, label = max(0.0, 100 - row.traffic_score), "quietness"
    elif row.area_score is not None:
        primary, label = row.area_score, "overall area quality"
    else:
        return DimResult()

    score = max(0.0, min(1.0, primary / 100))
    if score >= 0.7:
        return DimResult(score=score, reason=f"{prop.area} scores well for {label} ({round(primary)}/100)")
    if score < 0.4:
        return DimResult(score=score, trade_off=f"{prop.area}'s {label} score is on the lower side ({round(primary)}/100)")
    return DimResult(score=score)


def _commute_fit(criteria: HomeFinderCriteria, prop: Property) -> DimResult:
    target = resolve_commute_target(criteria.commute_destination, criteria.city or prop.city)
    if target is None:
        return DimResult()
    lat, lng = coords_for(prop.area, prop.city, prop.id)
    km = _haversine_km(lat, lng, target[0], target[1])
    minutes = round((km / _ASSUMED_CITY_SPEED_KMH) * 60)
    score = max(0.0, min(1.0, 1.0 - km / 40))
    label = f"~{minutes} min (approx., driving) from {criteria.commute_destination}"
    if minutes <= 20:
        return DimResult(score=score, reason=label)
    return DimResult(score=score, trade_off=label)


@dataclass
class ScoredProperty:
    property: Property
    match_score: int
    dimension_scores: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    trade_offs: list[str] = field(default_factory=list)
    exact_match: bool = False
    area_family_score: float | None = None


def score_property(
    criteria: HomeFinderCriteria, prop: Property, area_intel: dict[tuple[str, str], AreaIntelligence]
) -> ScoredProperty:
    dims: dict[str, DimResult] = {
        "budget_fit": _budget_fit(criteria, prop),
        "location_fit": _location_fit(criteria, prop),
        "bedrooms_fit": _bedrooms_fit(criteria, prop),
        "property_type_fit": _property_type_fit(criteria, prop),
        "required_amenities_fit": _required_amenities_fit(criteria, prop),
        "preferred_amenities_fit": _preferred_amenities_fit(criteria, prop),
        "lifestyle_fit": _lifestyle_fit(criteria, prop, area_intel),
        "commute_fit": _commute_fit(criteria, prop),
    }
    available = {k: v for k, v in dims.items() if v.score is not None}
    weight_sum = sum(WEIGHTS[k] for k in available)
    if weight_sum > 0:
        fraction = sum(WEIGHTS[k] * available[k].score for k in available) / weight_sum
    else:
        fraction = 0.7  # no criteria set beyond transaction type/city — neutral, still browsable
    match_score = round(max(0.0, min(1.0, fraction)) * 100)

    reasons = [v.reason for v in dims.values() if v.reason][:5]
    trade_offs = [v.trade_off for v in dims.values() if v.trade_off][:4]
    exact_match = all(dims[k].trade_off is None for k in _HARD_DIMENSIONS if dims[k].score is not None)

    row = area_intel.get(((prop.area or "").lower(), (prop.city or "").lower()))

    return ScoredProperty(
        property=prop,
        match_score=match_score,
        dimension_scores={k: round(v.score, 4) for k, v in available.items()},
        reasons=reasons,
        trade_offs=trade_offs,
        exact_match=exact_match,
        area_family_score=row.family_score if row else None,
    )


def _load_pool(db: Session, criteria: HomeFinderCriteria, *, limit: int = POOL_LIMIT) -> list[Property]:
    pf = PropertyFilterCriteria(transaction_type=criteria.transaction_type, city=criteria.city or "")
    filters = build_property_filters(pf)
    stmt = select(Property).where(*filters).order_by(Property.created_at.desc()).limit(limit)
    return list(db.scalars(stmt).all())


def load_area_intel(db: Session, pool: list[Property]) -> dict[tuple[str, str], AreaIntelligence]:
    cities = list({p.city for p in pool if p.city})
    if not cities:
        return {}
    rows = db.scalars(select(AreaIntelligence).where(AreaIntelligence.city.in_(cities))).all()
    return {(row.area_name.lower(), row.city.lower()): row for row in rows}


@dataclass
class RankResult:
    scored_pool: list[ScoredProperty]
    top: list[ScoredProperty]
    exact_match_count: int
    pool_count: int


def rank(db: Session, criteria: HomeFinderCriteria, *, top_n: int = 20) -> RankResult:
    pool = _load_pool(db, criteria)
    area_intel = load_area_intel(db, pool)
    scored = [score_property(criteria, p, area_intel) for p in pool]
    scored.sort(key=lambda r: r.match_score, reverse=True)
    displayable = [r for r in scored if r.match_score / 100 >= MIN_DISPLAY_SCORE]
    exact_match_count = sum(1 for r in scored if r.exact_match)
    return RankResult(scored_pool=scored, top=displayable[:top_n], exact_match_count=exact_match_count, pool_count=len(pool))


@dataclass
class Categories:
    best_overall: int | None = None
    best_value: int | None = None
    best_location: int | None = None
    best_family: int | None = None


def pick_categories(results: list[ScoredProperty], criteria: HomeFinderCriteria) -> Categories:
    if not results:
        return Categories()
    best_overall = max(results, key=lambda r: r.match_score).property.id

    value_candidates = [r for r in results if "budget_fit" in r.dimension_scores]
    best_value = (
        max(value_candidates, key=lambda r: r.dimension_scores["budget_fit"] * 0.6 + r.match_score / 100 * 0.4).property.id
        if value_candidates
        else None
    )

    location_candidates = [r for r in results if "location_fit" in r.dimension_scores]
    best_location = max(location_candidates, key=lambda r: r.dimension_scores["location_fit"]).property.id if location_candidates else None

    family_candidates = [r for r in results if r.area_family_score is not None]
    best_family = max(family_candidates, key=lambda r: r.area_family_score).property.id if family_candidates else None

    return Categories(best_overall=best_overall, best_value=best_value, best_location=best_location, best_family=best_family)


# ── Empty-result intelligence (Section 13) ─────────────────────────────────


def _restrictive_reasons(criteria: HomeFinderCriteria) -> list[str]:
    parts = []
    if criteria.bedrooms:
        parts.append(f"{criteria.bedrooms}+ bedrooms")
    if criteria.districts:
        parts.append(", ".join(criteria.districts))
    if criteria.max_price:
        unit = "" if criteria.transaction_type == "sale" else "/year"
        parts.append(f"maximum SAR {criteria.max_price:,.0f}{unit}")
    if criteria.property_type:
        parts.append(criteria.property_type)
    if criteria.required_amenities:
        parts.append(" + ".join(_amenity_label(a) for a in criteria.required_amenities))
    return parts


def _count_exact(scored_pool: list[ScoredProperty], patched: HomeFinderCriteria, area_intel: dict, pool: list[Property]) -> int:
    return sum(1 for p in pool if score_property(patched, p, area_intel).exact_match)


def empty_result_suggestions(db: Session, criteria: HomeFinderCriteria, rank_result: RankResult) -> tuple[str, list[str], list[dict]]:
    """Returns (message, restrictive_reasons, suggestions) — every count is
    computed by re-evaluating the SAME real candidate pool already fetched
    for this search (Section 13: "Only display counts calculated from actual
    searches"), never estimated or fabricated."""
    pool = [r.property for r in rank_result.scored_pool]
    area_intel = load_area_intel(db, pool)
    restrictive = _restrictive_reasons(criteria)
    message = (
        f"Your combination of {' + '.join(restrictive)} is currently restrictive."
        if restrictive
        else "This search is currently very restrictive for available inventory."
    )

    candidates: list[tuple[str, HomeFinderCriteria, int]] = []

    if criteria.max_price:
        for pct, label_pct in ((0.15, "15%"), (0.30, "30%")):
            patched = criteria.model_copy(update={"max_price": round(criteria.max_price * (1 + pct))})
            count = _count_exact(rank_result.scored_pool, patched, area_intel, pool)
            candidates.append((f"Try SAR {patched.max_price:,.0f} (+{label_pct})", patched, count))

    if criteria.bedrooms and criteria.bedrooms > 1:
        patched = criteria.model_copy(update={"bedrooms": criteria.bedrooms - 1})
        count = _count_exact(rank_result.scored_pool, patched, area_intel, pool)
        candidates.append((f"Reduce to {patched.bedrooms}+ bedrooms", patched, count))

    if criteria.districts:
        pool_districts = {p.area for p in pool if p.area and p.area not in criteria.districts}
        for extra in list(pool_districts)[:5]:
            patched = criteria.model_copy(update={"districts": [*criteria.districts, extra]})
            count = _count_exact(rank_result.scored_pool, patched, area_intel, pool)
            candidates.append((f"Add {extra}", patched, count))

    if criteria.required_amenities:
        for amenity in criteria.required_amenities:
            remaining = [a for a in criteria.required_amenities if a != amenity]
            patched = criteria.model_copy(update={"required_amenities": remaining})
            count = _count_exact(rank_result.scored_pool, patched, area_intel, pool)
            candidates.append((f"Drop '{_amenity_label(amenity)}' requirement", patched, count))

    improving = [c for c in candidates if c[2] > rank_result.exact_match_count]
    improving.sort(key=lambda c: c[2], reverse=True)
    suggestions = [
        {"label": label, "criteria_patch": patched.model_dump(exclude_defaults=False), "estimated_count": count}
        for label, patched, count in improving[:4]
    ]
    return message, restrictive, suggestions
