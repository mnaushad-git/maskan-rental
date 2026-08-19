"""Trust Center — Listing Freshness. Deterministic, no LLM. Classifies a
listing into one of four categories based on how recently it was confirmed
available / updated / created:

- "Recently Confirmed"    — a mediator explicitly confirmed availability
                             within `FRESHNESS_RECENTLY_CONFIRMED_DAYS`.
                             `Property.availability_confirmed_at` doesn't
                             exist yet (it's added in a later prompt); this
                             path is future-proofed but currently inert
                             (always falls through) since callers today pass
                             `availability_confirmed_at=None`.
- "Recently Updated"      — updated within `FRESHNESS_RECENTLY_UPDATED_DAYS`.
- "Needs Reconfirmation"  — updated within `FRESHNESS_NEEDS_RECONFIRMATION_DAYS`.
- "Potentially Stale"     — older than that.

Always computable (never omitted): `Property.created_at` is a NOT NULL
column, so there is always a reference timestamp to classify from.
"""
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.trust_config import (
    FRESHNESS_CATEGORY_SCORES,
    FRESHNESS_NEEDS_RECONFIRMATION_DAYS,
    FRESHNESS_RECENTLY_CONFIRMED_DAYS,
    FRESHNESS_RECENTLY_UPDATED_DAYS,
)


@dataclass
class FreshnessResult:
    score: int  # 0-100
    category: str
    days_since_reference: int
    reason: str


def _days_since(reference: datetime, now: datetime) -> int:
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return max(0, (now - reference).days)


def compute_listing_freshness(
    created_at: datetime,
    updated_at: datetime | None = None,
    availability_confirmed_at: datetime | None = None,
    *,
    now: datetime | None = None,
) -> FreshnessResult:
    now = now or datetime.now(timezone.utc)

    if availability_confirmed_at is not None:
        days_confirmed = _days_since(availability_confirmed_at, now)
        if days_confirmed <= FRESHNESS_RECENTLY_CONFIRMED_DAYS:
            category = "Recently Confirmed"
            return FreshnessResult(
                score=FRESHNESS_CATEGORY_SCORES[category],
                category=category,
                days_since_reference=days_confirmed,
                reason=f"Availability confirmed by the mediator {days_confirmed} day(s) ago.",
            )

    reference = updated_at or created_at
    days_since = _days_since(reference, now)

    if days_since <= FRESHNESS_RECENTLY_UPDATED_DAYS:
        category = "Recently Updated"
        reason = f"Listing was last updated {days_since} day(s) ago."
    elif days_since <= FRESHNESS_NEEDS_RECONFIRMATION_DAYS:
        category = "Needs Reconfirmation"
        reason = f"Listing hasn't been updated in {days_since} days — worth confirming it's still available."
    else:
        category = "Potentially Stale"
        reason = f"Listing hasn't been updated in {days_since} days — availability should be reconfirmed before relying on it."

    return FreshnessResult(
        score=FRESHNESS_CATEGORY_SCORES[category],
        category=category,
        days_since_reference=days_since,
        reason=reason,
    )
