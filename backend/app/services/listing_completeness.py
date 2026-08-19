"""Trust Center — Listing Completeness. Deterministic, no LLM. Weighted
required/important/optional field-presence check, mirroring the tiered
weighting pattern `property_decision_score.py` uses for its dimensions, but
applied to raw field presence rather than a scored dimension. Always
computable (never omitted from the overall Trust Assessment) — a listing
with almost nothing filled in still gets a low, honest completeness score
rather than being excluded.
"""
from dataclasses import dataclass, field

from app.core.trust_config import COMPLETENESS_FIELDS, COMPLETENESS_TIER_WEIGHTS
from app.models.property import Property


@dataclass
class CompletenessResult:
    score: int  # 0-100, weighted percent of fields present
    present_fields: list[str] = field(default_factory=list)
    missing_fields: list[str] = field(default_factory=list)
    missing_required: list[str] = field(default_factory=list)
    tier_breakdown: dict[str, dict[str, int]] = field(default_factory=dict)


def compute_listing_completeness(prop: Property) -> CompletenessResult:
    present_weight = 0
    total_weight = 0
    present_fields: list[str] = []
    missing_fields: list[str] = []
    missing_required: list[str] = []
    tier_breakdown: dict[str, dict[str, int]] = {}

    for tier, fields in COMPLETENESS_FIELDS.items():
        weight = COMPLETENESS_TIER_WEIGHTS[tier]
        tier_present = 0
        for _key, label, check in fields:
            total_weight += weight
            is_present = bool(check(prop))
            if is_present:
                present_weight += weight
                present_fields.append(label)
                tier_present += 1
            else:
                missing_fields.append(label)
                if tier == "required":
                    missing_required.append(label)
        tier_breakdown[tier] = {"present": tier_present, "total": len(fields)}

    score = round(present_weight / total_weight * 100) if total_weight else 0

    return CompletenessResult(
        score=score,
        present_fields=present_fields,
        missing_fields=missing_fields,
        missing_required=missing_required,
        tier_breakdown=tier_breakdown,
    )
