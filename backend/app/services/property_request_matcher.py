"""PropertyRequestMatcher: deterministic "how well does this property satisfy
this Property Request" engine (Phase 6). Pure and side-effect-free like
`app.services.saved_search_matcher` — callers (Celery tasks, API preview
endpoints) decide what to persist. No LLM is involved in scoring; the AI
Property Agent (app.services.property_request_ai) may *explain* a score
afterward but never computes it.

Candidate narrowing reuses `PropertyFilterCriteria`/`build_property_filters`
(app.core.search.filters) for the fields it covers (city, transaction type,
price, bedrooms/bathrooms floor, area, furnishing, verified-only, districts)
so a single request/property event never needs a full table scan. Fields
`PropertyFilterCriteria` doesn't model (bedrooms/bathrooms ceiling, excluded
districts, commute, area intelligence, listing quality) are evaluated in
Python against the narrowed candidate set only.
"""
import hashlib
import math
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.property_request.criteria import build_canonical_filters
from app.core.property_request.scoring import DEFAULT_WEIGHTS, ScoringWeights, apply_priority_override, get_active_weights
from app.core.search.filters import build_property_filters
from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property
from app.models.property_request import PropertyRequest

CANDIDATE_SCAN_LIMIT = 500

# Fields that are hard (must-pass) by default unless the customer explicitly
# moved them to `flexible_fields`/`nice_to_have_fields`; `must_have_fields`
# always adds to this set regardless of default membership.
DEFAULT_HARD_FIELDS = {"transaction_type", "city", "max_price", "bedrooms_min"}

# Fields evaluated as "property specs" for the property_specs score component.
_SPEC_FIELDS = {"bedrooms_max", "bathrooms_min", "bathrooms_max", "min_area_sq_m", "max_area_sq_m", "furnishing", "property_category"}
# Fields evaluated as general preference coverage (nice-to-have/flexible pool).
_PREFERENCE_FIELDS = {"preferred_districts", "verified_only", "property_age_preference", "pet_preference"} | _SPEC_FIELDS


@dataclass
class MatchResult:
    property: Property
    match_score: float
    hard_pass: bool
    must_have_failures: list[dict] = field(default_factory=list)
    flexible_coverage: float = 0.0
    preference_score: float = 0.0
    price_fit_score: float = 0.0
    area_fit_score: float = 0.0
    commute_fit_score: float = 0.0
    listing_quality_score: float = 0.0
    confidence: float = 0.0
    match_reasons: list[dict] = field(default_factory=list)
    trade_offs: list[dict] = field(default_factory=list)
    rejection_reasons: list[dict] = field(default_factory=list)
    match_version: str = "1"


def _hash(*parts) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()


def effective_hard_fields(pr: PropertyRequest) -> set[str]:
    return (DEFAULT_HARD_FIELDS | set(pr.must_have_fields or [])) - set(pr.flexible_fields or []) - set(pr.nice_to_have_fields or [])


def _price_of(pr: PropertyRequest, prop: Property) -> float | None:
    return prop.sale_price if pr.transaction_type == "sale" else prop.monthly_rent


def _field_checks(pr: PropertyRequest, prop: Property) -> dict[str, tuple[bool, dict | None]]:
    """One (passed, reason_or_none) tuple per optionally-evaluated field.
    Only fields the request actually set are included — an unset field is
    neither a pass nor a failure, it simply isn't evaluated."""
    checks: dict[str, tuple[bool, dict | None]] = {}
    price = _price_of(pr, prop)

    if pr.transaction_type:
        ok = prop.listing_type == pr.transaction_type
        checks["transaction_type"] = (ok, None if ok else {"code": "transaction_type_mismatch"})
    if pr.city:
        ok = (prop.city or "").lower() == pr.city.lower()
        checks["city"] = (ok, None if ok else {"code": "city_mismatch", "city": prop.city})
    if pr.max_price is not None:
        ok = price is not None and price <= pr.max_price
        checks["max_price"] = (ok, None if ok else {"code": "over_budget", "price": price, "max_price": pr.max_price})
    if pr.min_price is not None:
        ok = price is not None and price >= pr.min_price
        checks["min_price"] = (ok, None if ok else {"code": "under_min_price", "price": price})
    if pr.bedrooms_min is not None:
        ok = (prop.bedrooms or 0) >= pr.bedrooms_min
        checks["bedrooms_min"] = (ok, None if ok else {"code": "too_few_bedrooms", "bedrooms": prop.bedrooms})
    if pr.bedrooms_max is not None:
        ok = (prop.bedrooms or 0) <= pr.bedrooms_max
        checks["bedrooms_max"] = (ok, None if ok else {"code": "too_many_bedrooms", "bedrooms": prop.bedrooms})
    if pr.bathrooms_min is not None:
        ok = (prop.bathrooms or 0) >= pr.bathrooms_min
        checks["bathrooms_min"] = (ok, None if ok else {"code": "too_few_bathrooms"})
    if pr.bathrooms_max is not None:
        ok = (prop.bathrooms or 0) <= pr.bathrooms_max
        checks["bathrooms_max"] = (ok, None if ok else {"code": "too_many_bathrooms"})
    if pr.min_area_sq_m is not None:
        ok = (prop.size_sq_m or 0) >= pr.min_area_sq_m
        checks["min_area_sq_m"] = (ok, None if ok else {"code": "too_small"})
    if pr.max_area_sq_m is not None:
        ok = (prop.size_sq_m or 0) <= pr.max_area_sq_m
        checks["max_area_sq_m"] = (ok, None if ok else {"code": "too_large"})
    if pr.furnishing:
        ok = prop.furnished == pr.furnishing
        checks["furnishing"] = (ok, None if ok else {"code": "furnishing_mismatch", "furnished": prop.furnished})
    if pr.property_category:
        ok = prop.property_type == pr.property_category
        checks["property_category"] = (ok, None if ok else {"code": "property_type_mismatch", "property_type": prop.property_type})
    if pr.verified_only:
        ok = bool(prop.mediator_is_verified)
        checks["verified_only"] = (ok, None if ok else {"code": "not_verified"})
    if pr.preferred_districts:
        ok = (prop.area or "").lower() in {d.lower() for d in pr.preferred_districts}
        checks["preferred_districts"] = (ok, None if ok else {"code": "outside_preferred_district", "area": prop.area})
    # Exclusions are always absolute regardless of must-have/flexible classification.
    if pr.excluded_districts and (prop.area or "").lower() in {d.lower() for d in pr.excluded_districts}:
        checks["excluded_districts"] = (False, {"code": "excluded_district", "area": prop.area})

    return checks


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# Coarse average-city-speed assumption used only to turn straight-line
# distance into an approximate commute-time estimate when no routing/traffic
# API is integrated. Documented as an approximation everywhere it surfaces.
_ASSUMED_CITY_SPEED_KMH = 30.0


def _commute_fit(pr: PropertyRequest, prop: Property) -> tuple[float, dict | None, bool]:
    """Returns (score, reason_or_none, data_available)."""
    if not pr.max_commute_minutes or pr.commute_destination_lat is None or pr.commute_destination_lng is None:
        return 0.5, None, False
    if prop.latitude is None or prop.longitude is None:
        return 0.5, None, False
    km = _haversine_km(prop.latitude, prop.longitude, pr.commute_destination_lat, pr.commute_destination_lng)
    est_minutes = (km / _ASSUMED_CITY_SPEED_KMH) * 60
    if est_minutes <= pr.max_commute_minutes:
        score = 1.0 - 0.3 * (est_minutes / pr.max_commute_minutes)
        return max(0.7, score), {"code": "within_commute", "estimated_minutes": round(est_minutes)}, True
    overage = (est_minutes - pr.max_commute_minutes) / pr.max_commute_minutes
    return max(0.0, 0.5 - overage), {"code": "commute_over_limit", "estimated_minutes": round(est_minutes), "max_minutes": pr.max_commute_minutes}, True


def _area_fit(db: Session, pr: PropertyRequest, prop: Property) -> tuple[float, dict | None, bool]:
    if not prop.area or not prop.city:
        return 0.5, None, False
    row = db.scalar(select(AreaIntelligence).where(AreaIntelligence.area_name.ilike(prop.area), AreaIntelligence.city.ilike(prop.city)))
    if row is None:
        return 0.5, None, False
    if pr.school_preference and row.school_score is not None:
        primary = row.school_score
    elif pr.hospital_preference and row.healthcare_score is not None:
        primary = row.healthcare_score
    elif pr.family_size and row.family_score is not None:
        primary = row.family_score
    else:
        primary = row.area_score
    if primary is None:
        return 0.5, None, False
    score = max(0.0, min(1.0, primary / 100))
    reason = {"code": "strong_area_fit", "area_score": round(primary)} if score >= 0.7 else None
    return score, reason, True


def _listing_quality(prop: Property) -> float:
    score = 0.4
    if prop.description:
        score += 0.2
    if prop.image_url or getattr(prop, "listing_images", None):
        score += 0.2
    if prop.mediator_is_verified:
        score += 0.2
    return min(1.0, score)


def evaluate(db: Session, pr: PropertyRequest, prop: Property, *, weights: ScoringWeights, match_version: str) -> MatchResult:
    checks = _field_checks(pr, prop)
    hard_fields = effective_hard_fields(pr)

    must_have_failures: list[dict] = []
    hard_pass = True
    for field_name in hard_fields | {"excluded_districts"}:
        result = checks.get(field_name)
        if result is None:
            continue
        ok, reason = result
        if not ok:
            hard_pass = False
            if reason:
                must_have_failures.append(reason)

    soft_fields = [f for f in checks if f not in hard_fields and f != "excluded_districts"]
    soft_passed = [f for f in soft_fields if checks[f][0]]
    flexible_coverage = (len(soft_passed) / len(soft_fields)) if soft_fields else 1.0

    match_reasons: list[dict] = []
    trade_offs: list[dict] = []
    for f in soft_fields:
        ok, reason = checks[f]
        if ok:
            match_reasons.append({"code": f"{f}_match"})
        elif reason:
            trade_offs.append(reason)
    for f in hard_fields:
        ok, _reason = checks.get(f, (True, None))
        if ok and f in checks:
            match_reasons.append({"code": f"{f}_match"})

    price = _price_of(pr, prop)
    if pr.max_price is not None and price is not None:
        room = (pr.max_price - price) / pr.max_price if pr.max_price else 0
        price_fit_score = max(0.5, min(1.0, 1.0 - abs(room - 0.15)))
        if room >= 0:
            match_reasons.append({"code": "within_budget", "price": price})
    else:
        price_fit_score = 0.6

    area_fit_score, area_reason, area_known = _area_fit(db, pr, prop)
    if area_reason:
        match_reasons.append(area_reason)
    commute_fit_score, commute_reason, commute_known = _commute_fit(pr, prop)
    if commute_reason:
        (match_reasons if commute_reason["code"] == "within_commute" else trade_offs).append(commute_reason)

    spec_fields = [f for f in soft_fields if f in _SPEC_FIELDS]
    spec_passed = [f for f in spec_fields if checks[f][0]]
    property_specs_score = (len(spec_passed) / len(spec_fields)) if spec_fields else 1.0

    listing_quality_score = _listing_quality(prop)
    lifestyle_area_score = area_fit_score
    user_behavior_score = 0.5  # no behavioral feedback loop yet — documented placeholder, see Phase 6 notes

    hard_fit_component = 1.0 if hard_pass else max(0.0, 1.0 - len(must_have_failures) / max(1, len(hard_fields)))
    location_commute_component = (area_fit_score + commute_fit_score) / 2

    weights = apply_priority_override(weights, pr.priority_weighting)
    match_score = round(
        weights.hard_fit * hard_fit_component
        + weights.location_commute * location_commute_component
        + weights.budget_fit * price_fit_score
        + weights.property_specs * property_specs_score
        + weights.lifestyle_area * lifestyle_area_score
        + weights.listing_quality * listing_quality_score
        + weights.user_behavior * user_behavior_score,
        4,
    )

    confidence = round(sum([1.0, 1.0, area_known, commute_known if pr.max_commute_minutes else 1.0]) / 4, 2)

    return MatchResult(
        property=prop,
        match_score=match_score,
        hard_pass=hard_pass,
        must_have_failures=must_have_failures,
        flexible_coverage=round(flexible_coverage, 4),
        preference_score=round(flexible_coverage, 4),
        price_fit_score=round(price_fit_score, 4),
        area_fit_score=round(area_fit_score, 4),
        commute_fit_score=round(commute_fit_score, 4),
        listing_quality_score=round(listing_quality_score, 4),
        confidence=confidence,
        match_reasons=match_reasons,
        trade_offs=trade_offs,
        rejection_reasons=must_have_failures if not hard_pass else [],
        match_version=match_version,
    )


def candidate_properties_for_request(db: Session, pr: PropertyRequest, *, limit: int = CANDIDATE_SCAN_LIMIT) -> list[Property]:
    criteria = build_canonical_filters(pr)
    filters = build_property_filters(criteria)
    stmt = select(Property).where(*filters).order_by(Property.created_at.desc()).limit(limit)
    return list(db.scalars(stmt).all())


def candidate_requests_for_property(db: Session, prop: Property, *, limit: int = CANDIDATE_SCAN_LIMIT) -> list[PropertyRequest]:
    stmt = select(PropertyRequest).where(PropertyRequest.status == "active", PropertyRequest.matching_enabled.is_(True))
    stmt = stmt.where(or_(PropertyRequest.transaction_type.is_(None), PropertyRequest.transaction_type == prop.listing_type))
    if prop.city:
        stmt = stmt.where(or_(PropertyRequest.city.is_(None), PropertyRequest.city.ilike(prop.city)))
    price = prop.sale_price if prop.listing_type == "sale" else prop.monthly_rent
    if price is not None:
        stmt = stmt.where(or_(PropertyRequest.max_price.is_(None), PropertyRequest.max_price >= price))
    return list(db.scalars(stmt.limit(limit)).all())


def match_requests_for_property(db: Session, prop: Property) -> list[tuple[PropertyRequest, MatchResult]]:
    match_version, weights = get_active_weights(db)
    results = []
    for pr in candidate_requests_for_property(db, prop):
        result = evaluate(db, pr, prop, weights=weights, match_version=match_version)
        if result.hard_pass:
            results.append((pr, result))
    return results


def match_properties_for_request(db: Session, pr: PropertyRequest) -> list[MatchResult]:
    match_version, weights = get_active_weights(db)
    results = []
    for prop in candidate_properties_for_request(db, pr):
        result = evaluate(db, pr, prop, weights=weights, match_version=match_version)
        if result.hard_pass:
            results.append(result)
    results.sort(key=lambda r: r.match_score, reverse=True)
    return results


def preview_match_count(db: Session, pr: PropertyRequest) -> int:
    return len(match_properties_for_request(db, pr))


def restrictive_criteria_report(db: Session, pr: PropertyRequest, *, sample_limit: int = 300) -> list[dict]:
    """Deterministic "why so few/no matches" diagnostic (Phase 8/10D): for
    each hard field currently set, count how many additional candidates
    would pass if that single field were relaxed, holding everything else
    fixed. Backs the AI Property Agent's explanation and the no-match UI —
    the ranking of restrictiveness itself is computed here, not by the LLM."""
    hard_fields = effective_hard_fields(pr)
    base_candidates = candidate_properties_for_request(db, pr, limit=sample_limit)
    base_pass = sum(1 for p in base_candidates if evaluate(db, pr, p, weights=DEFAULT_WEIGHTS, match_version="diag").hard_pass)

    report = []
    for field_name in sorted(hard_fields):
        checks_present = any(field_name in _field_checks(pr, p) for p in base_candidates[:20])
        if not checks_present:
            continue
        relaxed_pass = 0
        for p in base_candidates:
            checks = _field_checks(pr, p)
            checks.pop(field_name, None)
            other_hard = hard_fields - {field_name}
            ok = all(checks.get(f, (True, None))[0] for f in other_hard if f in checks) and checks.get("excluded_districts", (True, None))[0]
            if ok:
                relaxed_pass += 1
        if relaxed_pass > base_pass:
            report.append({"field": field_name, "candidates_with_field": base_pass, "candidates_if_relaxed": relaxed_pass})
    report.sort(key=lambda r: r["candidates_if_relaxed"] - r["candidates_with_field"], reverse=True)
    return report
