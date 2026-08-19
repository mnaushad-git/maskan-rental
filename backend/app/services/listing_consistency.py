"""Trust Center — Listing Consistency. Deterministic, no LLM. Flags data that
contradicts itself or looks physically implausible (zero/negative price,
zero/negative size, an unreasonable bed/bath count, a rent listing with only
a sale price on file and vice versa, a missing district). Each issue carries
a severity — `info` / `warning` / `blocking` — and a fixed penalty against a
100-point baseline (see `app.core.trust_config.CONSISTENCY_SEVERITY_PENALTY`).
Always computable (never omitted from the overall Trust Assessment): a
listing with no issues simply scores 100.
"""
from dataclasses import dataclass, field

from app.core.trust_config import (
    CONSISTENCY_SEVERITY_PENALTY,
    MAX_REASONABLE_BATHROOMS,
    MAX_REASONABLE_BEDROOMS,
)
from app.models.property import Property


@dataclass
class ConsistencyIssue:
    code: str
    severity: str  # "info" | "warning" | "blocking"
    message: str


@dataclass
class ConsistencyResult:
    score: int  # 0-100
    issues: list[ConsistencyIssue] = field(default_factory=list)
    has_blocking_issues: bool = False


def _price_for(prop: Property) -> float | None:
    return prop.sale_price if prop.listing_type == "sale" else prop.monthly_rent


def check_listing_consistency(prop: Property) -> ConsistencyResult:
    issues: list[ConsistencyIssue] = []

    price = _price_for(prop)
    if price is not None and price <= 0:
        issues.append(ConsistencyIssue("invalid_price", "blocking", "Listed price is zero or negative."))

    if prop.size_sq_m is not None and prop.size_sq_m <= 0:
        issues.append(ConsistencyIssue("invalid_size", "blocking", "Listed size (sqm) is zero or negative."))

    if prop.bedrooms is not None and (prop.bedrooms < 0 or prop.bedrooms > MAX_REASONABLE_BEDROOMS):
        issues.append(ConsistencyIssue("unreasonable_bedrooms", "warning", "Bedroom count looks unreasonable for a residential listing."))

    if prop.bathrooms is not None and (prop.bathrooms < 0 or prop.bathrooms > MAX_REASONABLE_BATHROOMS):
        issues.append(ConsistencyIssue("unreasonable_bathrooms", "warning", "Bathroom count looks unreasonable for a residential listing."))

    if prop.listing_type == "rent" and prop.monthly_rent is None and prop.sale_price is not None:
        issues.append(ConsistencyIssue("rent_sale_mismatch", "warning", "Listed as Rent, but only a sale price is on file."))
    elif prop.listing_type == "sale" and prop.sale_price is None and prop.monthly_rent is not None:
        issues.append(ConsistencyIssue("rent_sale_mismatch", "warning", "Listed as Sale, but only a monthly rent is on file."))

    if not (prop.area and prop.area.strip()):
        issues.append(ConsistencyIssue("missing_district", "info", "District / area is not specified."))

    score = 100
    for issue in issues:
        score -= CONSISTENCY_SEVERITY_PENALTY[issue.severity]
    score = max(0, score)

    return ConsistencyResult(
        score=score,
        issues=issues,
        has_blocking_issues=any(i.severity == "blocking" for i in issues),
    )
