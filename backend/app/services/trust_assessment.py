"""Property Verification & Trust Center — Trust Model core service.
Deterministic, no LLM anywhere in this module or any component calculator it
composes (Listing Completeness, Listing Consistency, Mediator Trust, Listing
Freshness, Marketplace Confidence). See
docs/implementation/mymakan-trust-center.md ("Trust Methodology") for the
full write-up.

`assess_property_trust` is the single entry point a future API route
(Prompt 2) will call. It takes a `Property` row plus a handful of
already-computed inputs the caller is expected to fetch once per request
(review aggregate, mediator listing count, `DataConfidence`) — this module
never re-queries the database itself, matching the "reuse existing services,
don't recalculate" global constraint.

Missing-component handling: any of the five components that can't be
calculated for a given listing (no mediator on record → Mediator Trust
omitted; no `DataConfidence` supplied → Marketplace Confidence omitted) is
dropped from the overall weighted average and the remaining weights
renormalize — Listing Completeness, Listing Consistency, and Listing
Freshness are always computable (every `Property` row has enough data —
even if mostly empty — to score them) and are never omitted. Mediator
Trust is also dropped (renormalized, not scored) while the mediator is
within their new-partner grace period — see
`mediator_trust.MEDIATOR_TRUST_GRACE_PERIOD_DAYS` — even though a mediator
is on record; the real component score is still returned in
`component_scores` for admin/internal use, it just doesn't count against
the customer-facing overall score yet.
"""
from dataclasses import dataclass, field
from datetime import datetime

from app.core.trust_config import (
    MAX_MISSING_INFORMATION,
    MAX_POSITIVE_SIGNALS,
    MAX_THINGS_TO_VERIFY,
    TRUST_COMPONENT_WEIGHTS,
    TRUST_LEVEL_THRESHOLDS,
)
from app.models.property import Property
from app.services.data_confidence import DataConfidence
from app.services.listing_completeness import CompletenessResult, compute_listing_completeness
from app.services.listing_consistency import ConsistencyResult, check_listing_consistency
from app.services.listing_freshness import FreshnessResult, compute_listing_freshness
from app.services.marketplace_confidence import MarketplaceConfidenceResult, compute_marketplace_confidence
from app.services.mediator_trust import MediatorTrustResult, compute_mediator_trust

TrustComponentResult = CompletenessResult | ConsistencyResult | MediatorTrustResult | FreshnessResult | MarketplaceConfidenceResult


@dataclass
class TrustAssessment:
    overall_score: int  # 0-100
    trust_level: str  # "High" | "Good" | "Moderate" | "Limited Confidence"
    component_scores: dict[str, TrustComponentResult] = field(default_factory=dict)
    omitted_components: list[str] = field(default_factory=list)
    positive_signals: list[str] = field(default_factory=list)
    missing_information: list[str] = field(default_factory=list)
    things_to_verify: list[str] = field(default_factory=list)
    data_confidence: DataConfidence | None = None


def _trust_level(score: int) -> str:
    for threshold, label in TRUST_LEVEL_THRESHOLDS:
        if score >= threshold:
            return label
    return TRUST_LEVEL_THRESHOLDS[-1][1]


def _positive_signals(
    completeness: CompletenessResult,
    consistency: ConsistencyResult,
    mediator_trust: MediatorTrustResult | None,
    freshness: FreshnessResult,
    marketplace: MarketplaceConfidenceResult | None,
) -> list[str]:
    signals: list[str] = []

    # Only allowed verification wording anywhere in this feature — see the
    # global "Verification wording" constraint.
    if mediator_trust is not None and mediator_trust.is_verified:
        signals.append("✓ Verified by myMakan")

    if completeness.score >= 90:
        signals.append(f"{completeness.score}% of listing details are complete")

    if consistency.score == 100:
        signals.append("No data inconsistencies found in this listing")

    if freshness.category in ("Recently Confirmed", "Recently Updated"):
        signals.append(freshness.category)

    if mediator_trust is not None and mediator_trust.review_count >= 3 and mediator_trust.avg_rating is not None:
        signals.append(f"{mediator_trust.avg_rating:.1f}★ average from {mediator_trust.review_count} reviews")

    if marketplace is not None and marketplace.level == "High":
        signals.append("Backed by strong marketplace data (comparable listings + area intelligence)")

    return signals[:MAX_POSITIVE_SIGNALS]


def _missing_information(completeness: CompletenessResult) -> list[str]:
    ordered = list(completeness.missing_required)
    for label in completeness.missing_fields:
        if label not in ordered:
            ordered.append(label)
    return ordered[:MAX_MISSING_INFORMATION]


def _things_to_verify(
    consistency: ConsistencyResult,
    mediator_trust: MediatorTrustResult | None,
    freshness: FreshnessResult,
    completeness: CompletenessResult,
) -> list[str]:
    items: list[str] = []

    for issue in consistency.issues:
        if issue.severity in ("warning", "blocking"):
            items.append(issue.message)

    if freshness.category in ("Needs Reconfirmation", "Potentially Stale"):
        items.append("Confirm this listing is still available with the mediator before visiting.")

    if mediator_trust is None:
        items.append("No mediator is on record for this listing — verify details directly.")
    elif not mediator_trust.is_verified:
        items.append("This mediator is not yet verified by myMakan.")

    for label in completeness.missing_required[:3]:
        items.append(f"Confirm '{label}' directly with the mediator — not listed.")

    seen: set[str] = set()
    deduped: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped[:MAX_THINGS_TO_VERIFY]


def assess_property_trust(
    prop: Property,
    *,
    review_count: int = 0,
    avg_rating: float | None = None,
    mediator_listing_count: int = 0,
    data_confidence: DataConfidence | None = None,
    now: datetime | None = None,
) -> TrustAssessment:
    completeness = compute_listing_completeness(prop)
    consistency = check_listing_consistency(prop)
    mediator_trust = compute_mediator_trust(
        prop.mediator,
        review_count=review_count,
        avg_rating=avg_rating,
        listing_count=mediator_listing_count,
        now=now,
    )
    freshness = compute_listing_freshness(
        prop.created_at,
        prop.updated_at,
        getattr(prop, "availability_confirmed_at", None),
        now=now,
    )
    marketplace = compute_marketplace_confidence(data_confidence)

    raw_components: dict[str, TrustComponentResult | None] = {
        "completeness": completeness,
        "consistency": consistency,
        "mediator_trust": mediator_trust,
        "freshness": freshness,
        "marketplace_confidence": marketplace,
    }

    component_scores: dict[str, TrustComponentResult] = {}
    omitted_components: list[str] = []
    weighted_sum = 0.0
    weight_total = 0.0
    for name, result in raw_components.items():
        weight = TRUST_COMPONENT_WEIGHTS[name]
        if result is None:
            omitted_components.append(name)
            continue
        component_scores[name] = result
        if getattr(result, "in_grace_period", False):
            # New-partner protection: still shown (e.g. to admins), just not
            # weighted into the customer-facing overall score.
            omitted_components.append(name)
            continue
        weighted_sum += weight * result.score
        weight_total += weight

    overall_score = round(weighted_sum / weight_total) if weight_total else 0
    overall_score = max(0, min(100, overall_score))
    trust_level = _trust_level(overall_score)

    return TrustAssessment(
        overall_score=overall_score,
        trust_level=trust_level,
        component_scores=component_scores,
        omitted_components=omitted_components,
        positive_signals=_positive_signals(completeness, consistency, mediator_trust, freshness, marketplace),
        missing_information=_missing_information(completeness),
        things_to_verify=_things_to_verify(consistency, mediator_trust, freshness, completeness),
        data_confidence=data_confidence,
    )
