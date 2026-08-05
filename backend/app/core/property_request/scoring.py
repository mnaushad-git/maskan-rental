"""Centralized, versioned match-scoring weights (Phase 6). Weights are never
hardcoded at call sites — every score computation goes through
`get_active_weights()`, which reads the published `PropertyRequestScoringConfig`
row (falling back to the in-code default below if none has been published
yet, e.g. a fresh environment before any admin action). A user's own
`PropertyRequest.priority_weighting` can further bias their personal matches
via `apply_priority_override()` — the global config is never mutated by that.
"""
from dataclasses import dataclass, fields
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.property_request_scoring_config import PropertyRequestScoringConfig

DEFAULT_SCORING_VERSION = 1


@dataclass
class ScoringWeights:
    """Suggested-by-spec defaults, sum to 1.0. Field names double as the
    dict keys stored in PropertyRequestScoringConfig.weights and as the
    keys a request's `priority_weighting` override may contain."""

    hard_fit: float = 0.30
    location_commute: float = 0.20
    budget_fit: float = 0.15
    property_specs: float = 0.15
    lifestyle_area: float = 0.10
    listing_quality: float = 0.05
    user_behavior: float = 0.05

    def to_dict(self) -> dict[str, float]:
        return {f.name: getattr(self, f.name) for f in fields(self)}

    def normalized(self) -> "ScoringWeights":
        total = sum(self.to_dict().values()) or 1.0
        return ScoringWeights(**{k: v / total for k, v in self.to_dict().items()})


DEFAULT_WEIGHTS = ScoringWeights()


def get_active_weights(db: Session) -> tuple[str, ScoringWeights]:
    """Returns (match_version, weights) for the currently-published config,
    or ("1", DEFAULT_WEIGHTS) if nothing has been published yet."""
    row = db.scalar(
        select(PropertyRequestScoringConfig)
        .where(PropertyRequestScoringConfig.is_active.is_(True))
        .order_by(PropertyRequestScoringConfig.version.desc())
    )
    if row is None:
        return str(DEFAULT_SCORING_VERSION), DEFAULT_WEIGHTS
    known = {k: v for k, v in (row.weights or {}).items() if k in ScoringWeights.__dataclass_fields__}
    return str(row.version), ScoringWeights(**{**DEFAULT_WEIGHTS.to_dict(), **known}).normalized()


def apply_priority_override(weights: ScoringWeights, override: dict | None) -> ScoringWeights:
    """A request's `priority_weighting` is a *partial* override (e.g. a
    customer who cares most about budget might set {"budget_fit": 0.35}) —
    unspecified categories keep the base weight, then everything is
    renormalized so the result still sums to 1.0."""
    if not override:
        return weights
    known = {k: v for k, v in override.items() if k in ScoringWeights.__dataclass_fields__ and isinstance(v, (int, float)) and v >= 0}
    if not known:
        return weights
    merged = {**weights.to_dict(), **known}
    return ScoringWeights(**merged).normalized()
