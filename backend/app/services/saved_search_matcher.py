"""SavedSearchMatcher: deterministic "does this property change matter to
this saved search" engine. Pure, side-effect-free, and unit-testable in
isolation — it never writes to the database itself; callers (the Celery
tasks in app.tasks.notifications) decide what to persist/send.

Design notes:
- `candidate_saved_searches()` narrows the search space with cheap, indexed
  SQL (status, alert_enabled, transaction_type, city) before any per-row
  filter evaluation happens, so a single property event never has to
  deserialize/evaluate every saved search in the system — only the ones
  that could plausibly match by city/transaction type.
- Fine-grained filter matching then runs in Python via
  `property_matches_criteria()` (app.core.search.filters), the same
  predicate logic a SQL-based search would use, kept in one place so the
  "does X match Y" semantics can never drift between the matcher and a
  future search-driven preview/matches endpoint.
- Every result carries a deterministic `change_hash`; the caller uses it for
  idempotent persistence (a DB unique constraint + a Redis pre-check) so a
  retried job never produces a second alert for the same logical change.
"""
import hashlib
from dataclasses import dataclass, field

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.search.filters import PropertyFilterCriteria, property_matches_criteria
from app.models.property import Property
from app.models.saved_search import SavedSearch


@dataclass
class MatchCandidate:
    saved_search: SavedSearch
    change_type: str
    match_reasons: list[dict] = field(default_factory=list)
    change_hash: str = ""
    match_score: float = 0.0
    change_context: dict = field(default_factory=dict)


def _hash(*parts) -> str:
    return hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()


def candidate_saved_searches(db: Session, prop: Property) -> list[SavedSearch]:
    """Indexed narrowing: active, alert-enabled searches whose top-level
    transaction_type/city (NULL = "any") could plausibly match this
    property. Everything finer-grained is checked in Python afterward."""
    stmt = select(SavedSearch).where(SavedSearch.status == "active", SavedSearch.alert_enabled == True)  # noqa: E712
    stmt = stmt.where(or_(SavedSearch.transaction_type.is_(None), SavedSearch.transaction_type == prop.listing_type))
    if prop.city:
        stmt = stmt.where(or_(SavedSearch.city.is_(None), SavedSearch.city.ilike(prop.city)))
    return list(db.scalars(stmt).all())


def _reasons_for_match(criteria: PropertyFilterCriteria, prop: Property) -> list[dict]:
    """Structured, localizable reason codes (not pre-rendered English text) —
    frontend/mobile own the copy via i18n, same convention as the rest of
    this backend (see Phase 1 research: backend never localizes strings)."""
    reasons: list[dict] = []
    price = prop.sale_price if criteria.transaction_type == "sale" else prop.monthly_rent
    if (criteria.min_price is not None or criteria.max_price is not None) and price is not None:
        reasons.append({"code": "within_budget", "price": price})
    if criteria.bedrooms is not None and prop.bedrooms is not None:
        reasons.append({"code": "bedrooms_match", "bedrooms": prop.bedrooms})
    if criteria.districts and prop.area:
        reasons.append({"code": "district_match", "district": prop.area})
    elif criteria.city and prop.city:
        reasons.append({"code": "city_match", "city": prop.city})
    if criteria.verified_only and prop.mediator_is_verified:
        reasons.append({"code": "verified_mediator"})
    if criteria.furnishing and prop.furnished:
        reasons.append({"code": "furnishing_match", "furnishing": prop.furnished})
    if not reasons:
        reasons.append({"code": "matches_search"})
    return reasons


def _score(reasons: list[dict]) -> float:
    # Deterministic, simple: more distinct match reasons = stronger match.
    # Not an ML ranking model — a transparent, explainable heuristic, matching
    # the platform plan's "core match must be deterministic" requirement.
    return min(1.0, 0.4 + 0.15 * len(reasons))


def evaluate_property_change(
    db: Session,
    prop: Property,
    *,
    change_type: str,
    change_context: dict | None = None,
) -> list[MatchCandidate]:
    """Given a property and a specific kind of change that just happened to
    it, return every active saved search this change is meaningful for,
    with match reasons and a dedup hash already computed."""
    change_context = change_context or {}
    results: list[MatchCandidate] = []

    for saved_search in candidate_saved_searches(db, prop):
        criteria = PropertyFilterCriteria.from_dict(saved_search.filters)
        if not property_matches_criteria(criteria, prop):
            continue

        reasons = _reasons_for_match(criteria, prop)
        if change_type == "price_drop":
            reasons = [{"code": "price_drop", "old_price": change_context.get("old_price"), "new_price": change_context.get("new_price")}] + reasons
            hash_key = _hash(saved_search.id, prop.id, change_type, change_context.get("new_price"))
        elif change_type == "price_increase":
            reasons = [{"code": "price_increase", "old_price": change_context.get("old_price"), "new_price": change_context.get("new_price")}] + reasons
            hash_key = _hash(saved_search.id, prop.id, change_type, change_context.get("new_price"))
        elif change_type == "back_on_market":
            reasons = [{"code": "back_on_market"}] + reasons
            hash_key = _hash(saved_search.id, prop.id, change_type, change_context.get("event_id", ""))
        elif change_type == "verified":
            reasons = [{"code": "now_verified"}] + reasons
            hash_key = _hash(saved_search.id, prop.id, change_type)
        elif change_type == "detail_updated":
            reasons = [{"code": "detail_updated", "changed": change_context.get("changed_fields", [])}] + reasons
            hash_key = _hash(saved_search.id, prop.id, change_type, sorted(change_context.get("changed_fields", [])))
        else:  # new_listing (default)
            hash_key = _hash(saved_search.id, prop.id, "new_listing")

        results.append(
            MatchCandidate(
                saved_search=saved_search,
                change_type=change_type,
                match_reasons=reasons,
                change_hash=hash_key,
                match_score=_score(reasons),
                change_context=change_context,
            )
        )

    return results


def preview_match_count(db: Session, criteria: PropertyFilterCriteria, *, limit: int = 500) -> int:
    """Cheap estimated count for the "N properties currently match" UI
    affordance shown while saving a search. Bounded scan (LIMIT) so this can
    never become an expensive full table scan — see Phase 3 requirement
    "Do not run expensive full scans synchronously"."""
    from app.core.search.filters import build_property_filters

    filters = build_property_filters(criteria)
    stmt = select(Property.id).where(*filters).limit(limit)
    return len(db.scalars(stmt).all())
