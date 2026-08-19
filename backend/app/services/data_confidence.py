"""Property Intelligence — Data Confidence. Deterministic, no LLM. Answers
"how much should the user trust this data?" from real listing-completeness
signals — never implies government/regulatory verification, only that the
listing's own data (specs, images, coordinates) and mediator account are on
file, and that the platform has comparable/area data to ground the rest of
Property Intelligence in.
"""
from dataclasses import dataclass

from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property

_SIGNAL_LABELS: dict[str, str] = {
    "specs": "core specs on file",
    "images": "listing photos",
    "coordinates": "map coordinates",
    "mediator_verified": "a verified mediator account",
    "comparables": "enough comparable listings",
    "area_intelligence": "area intelligence for this district",
}
HIGH_CONFIDENCE_MIN_SIGNALS = 5


@dataclass
class DataConfidence:
    level: str  # "High" | "Moderate"
    reason: str
    signals_present: int
    signals_total: int


def _signals(prop: Property, area_intel: AreaIntelligence | None, comparable_count: int) -> dict[str, bool]:
    specs_complete = all(
        v is not None for v in (prop.bedrooms, prop.bathrooms, prop.size_sq_m, prop.property_type)
    )
    return {
        "specs": specs_complete,
        "images": bool(prop.listing_images),
        "coordinates": prop.latitude is not None and prop.longitude is not None,
        "mediator_verified": bool(prop.mediator_is_verified),
        "comparables": comparable_count >= 3,
        "area_intelligence": area_intel is not None,
    }


def compute_data_confidence(prop: Property, area_intel: AreaIntelligence | None, comparable_count: int) -> DataConfidence:
    signals = _signals(prop, area_intel, comparable_count)
    present = [name for name, ok in signals.items() if ok]
    missing = [name for name, ok in signals.items() if not ok]
    total = len(signals)

    level = "High" if len(present) >= HIGH_CONFIDENCE_MIN_SIGNALS else "Moderate"

    if level == "High":
        reason = "High confidence — " + ", ".join(_SIGNAL_LABELS[n] for n in present) + " are all on file."
    else:
        reason = "Moderate confidence — missing " + ", ".join(_SIGNAL_LABELS[n] for n in missing) + "."

    return DataConfidence(level=level, reason=reason, signals_present=len(present), signals_total=total)
