"""Trust Center — Mediator Trust. Deterministic, no LLM. Built from
`Mediator.is_verified` (`app.models.mediator`), review aggregates sourced
from `app.models.review`/`reviews.py`'s existing approved-review query
pattern (average rating + count — this module does not recompute the
aggregate itself, callers pass it in, same "reuse, don't recompute" rule
Property Intelligence's `data_confidence.py` already follows), and a
listing-history count (how many listings this mediator has on the
platform). Omitted from the overall Trust Assessment entirely when a
listing has no mediator on record — never a fabricated trust score for an
unknown party.

New-partner grace period: a brand-new, unverified mediator with no track
record yet also has this component OMITTED from the overall score (not
scored as a punishing near-0) for `MEDIATOR_TRUST_GRACE_PERIOD_DAYS` after
their account is created — see `_is_new_partner_grace_period` and the
constant's docstring in `trust_config.py`. The raw `score` is still
computed and returned (useful for admin's own view of the real picture);
only the top-level `trust_assessment` orchestrator excludes it from the
customer-facing weighted average while `in_grace_period` is True.

Verification wording note: this module only ever produces the phrase
"Verified by myMakan" (never "Government Verified" / "REGA Verified" /
"Ejar Verified" / "Nafath Verified") per the Trust Center's global wording
constraint — see docs/implementation/mymakan-trust-center.md.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.core.trust_config import (
    MEDIATOR_LISTING_COUNT_TARGET,
    MEDIATOR_REVIEW_COUNT_TARGET,
    MEDIATOR_TRUST_GRACE_PERIOD_DAYS,
    MEDIATOR_TRUST_SIGNAL_WEIGHTS,
)
from app.models.mediator import Mediator


@dataclass
class MediatorTrustResult:
    score: int  # 0-100
    is_verified: bool
    review_count: int
    avg_rating: float | None
    listing_count: int
    reason: str
    in_grace_period: bool = False


def _is_new_partner_grace_period(
    mediator: Mediator,
    review_count: int,
    listing_count: int,
    now: datetime | None,
) -> bool:
    """True while a mediator still qualifies for new-partner protection: not
    yet verified, no reviews, no more than their first listing, and still
    within `MEDIATOR_TRUST_GRACE_PERIOD_DAYS` of account creation. A
    mediator constructed without `created_at` set (e.g. not yet persisted)
    never qualifies — fails safe to the ungraced score rather than guessing."""
    if mediator.is_verified or review_count > 0 or listing_count > 1:
        return False
    if mediator.created_at is None:
        return False

    reference_now = now or datetime.now(timezone.utc)
    created_at = mediator.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    if reference_now.tzinfo is None:
        reference_now = reference_now.replace(tzinfo=timezone.utc)
    return reference_now - created_at <= timedelta(days=MEDIATOR_TRUST_GRACE_PERIOD_DAYS)


def compute_mediator_trust(
    mediator: Mediator | None,
    *,
    review_count: int = 0,
    avg_rating: float | None = None,
    listing_count: int = 0,
    now: datetime | None = None,
) -> MediatorTrustResult | None:
    if mediator is None:
        return None

    signals: dict[str, tuple[float, float]] = {
        "verified": (1.0 if mediator.is_verified else 0.0, MEDIATOR_TRUST_SIGNAL_WEIGHTS["verified"]),
        "review_count": (min(review_count / MEDIATOR_REVIEW_COUNT_TARGET, 1.0), MEDIATOR_TRUST_SIGNAL_WEIGHTS["review_count"]),
        "listing_history": (min(listing_count / MEDIATOR_LISTING_COUNT_TARGET, 1.0), MEDIATOR_TRUST_SIGNAL_WEIGHTS["listing_history"]),
    }
    # Rating only makes sense once there's at least one approved review —
    # otherwise it's omitted (not scored as 0), and the remaining signals
    # renormalize, same missing-data-exclusion rule as every other
    # component in this feature.
    if review_count > 0 and avg_rating is not None:
        signals["rating"] = (max(0.0, min(1.0, avg_rating / 5.0)), MEDIATOR_TRUST_SIGNAL_WEIGHTS["rating"])

    weight_sum = sum(w for _, w in signals.values())
    fraction = sum(v * w for v, w in signals.values()) / weight_sum if weight_sum else 0.0
    score = round(max(0.0, min(1.0, fraction)) * 100)

    in_grace_period = _is_new_partner_grace_period(mediator, review_count, listing_count, now)

    reason_parts = []
    reason_parts.append("Verified by myMakan" if mediator.is_verified else "Not yet verified by myMakan")
    if review_count > 0 and avg_rating is not None:
        reason_parts.append(f"{avg_rating:.1f}★ average from {review_count} review{'s' if review_count != 1 else ''}")
    else:
        reason_parts.append("no reviews yet")
    reason_parts.append(f"{listing_count} listing{'s' if listing_count != 1 else ''} on myMakan")
    if in_grace_period:
        reason_parts.append("new myMakan partner — trust history still building, not counted against the overall score yet")
    reason = "; ".join(reason_parts) + "."

    return MediatorTrustResult(
        score=score,
        is_verified=bool(mediator.is_verified),
        review_count=review_count,
        avg_rating=avg_rating,
        listing_count=listing_count,
        reason=reason,
        in_grace_period=in_grace_period,
    )
