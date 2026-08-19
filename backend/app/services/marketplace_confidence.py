"""Trust Center — Marketplace Confidence. Deterministic, no LLM. This
component deliberately does **not** recompute anything: it reuses the
already-built `app.services.data_confidence.compute_data_confidence` result
(itself built from `app.services.comparable_properties.find_comparable_properties`
plus real listing/mediator/area signals) as-is. Callers (the Property
Intelligence endpoint today, the Trust endpoint in a later prompt) already
compute a `DataConfidence` once per request — this module just folds that
existing result into the Trust Model's 0-100 scale instead of adding a
second, competing calculation of the same thing.

Omitted from the overall Trust Assessment when no `DataConfidence` is
supplied (e.g. a caller that hasn't wired comparable/area lookups yet) —
never a fabricated marketplace-confidence score.
"""
from dataclasses import dataclass

from app.services.data_confidence import DataConfidence


@dataclass
class MarketplaceConfidenceResult:
    score: int  # 0-100, mirrors DataConfidence's signal ratio
    level: str  # "High" | "Moderate", passed through from DataConfidence
    reason: str  # passed through from DataConfidence, unmodified


def compute_marketplace_confidence(data_confidence: DataConfidence | None) -> MarketplaceConfidenceResult | None:
    if data_confidence is None:
        return None
    if data_confidence.signals_total <= 0:
        score = 0
    else:
        score = round(data_confidence.signals_present / data_confidence.signals_total * 100)
    return MarketplaceConfidenceResult(score=score, level=data_confidence.level, reason=data_confidence.reason)
