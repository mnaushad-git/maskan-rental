"""Property Intelligence — Strengths / Considerations / Things to Verify.
Deterministic, no LLM. Every line is generated from a real, evidenced signal
on the property row or the Prompt 2/3 service outputs — "things to verify"
in particular only ever names a field that is genuinely missing/ambiguous on
this specific listing, never a claimed problem with no evidence behind it.
"""
from dataclasses import dataclass, field
from typing import Any

from app.models.area_intelligence import AreaIntelligence
from app.models.property import Property

_MAX_ITEMS_PER_SECTION = 6
_HIGH_AREA_SCORE = 75
_LOW_AREA_SCORE = 40
_NEW_PROPERTY_MAX_AGE = 3
_OLD_PROPERTY_MIN_AGE = 20
_MANY_PHOTOS = 5


@dataclass
class PropertyHighlights:
    strengths: list[str] = field(default_factory=list)
    considerations: list[str] = field(default_factory=list)
    things_to_verify: list[str] = field(default_factory=list)


def property_highlights(
    prop: Property,
    price_intelligence: Any = None,
    comparables: list | None = None,
    area_intel: AreaIntelligence | None = None,
) -> PropertyHighlights:
    strengths: list[str] = []
    considerations: list[str] = []
    verify: list[str] = []

    if price_intelligence is not None and getattr(price_intelligence, "sufficient_data", False):
        classification = price_intelligence.classification
        if classification in ("Excellent Value", "Good Value"):
            strengths.append(
                f"Priced as {classification} against {price_intelligence.comparable_count} comparable listings"
            )
        elif classification in ("Above Market", "Significantly Above Market"):
            considerations.append(f"Priced {classification.lower()} compared to comparable listings")

    if comparables:
        better_value_count = sum(1 for c in comparables if getattr(c, "value_label", None) == "Better Value")
        if better_value_count >= max(1, len(comparables) // 2):
            strengths.append(f"Priced better than {better_value_count} of {len(comparables)} comparable listings")

    if area_intel is not None and area_intel.area_score is not None:
        if area_intel.area_score >= _HIGH_AREA_SCORE:
            strengths.append(f"{prop.area} scores well overall ({round(area_intel.area_score)}/100)")
        elif area_intel.area_score < _LOW_AREA_SCORE:
            considerations.append(f"{prop.area}'s overall area score is on the lower side ({round(area_intel.area_score)}/100)")
    else:
        verify.append("No area intelligence data available yet for this district")

    if prop.mediator_is_verified:
        strengths.append("Listed by a verified mediator")

    image_count = len(prop.listing_images or [])
    if image_count >= _MANY_PHOTOS:
        strengths.append(f"{image_count} photos available")
    elif image_count == 0:
        considerations.append("No listing photos available yet")

    if prop.property_age_years is not None:
        if prop.property_age_years <= _NEW_PROPERTY_MAX_AGE:
            strengths.append(f"Newly built ({prop.property_age_years} year(s) old)")
        elif prop.property_age_years >= _OLD_PROPERTY_MIN_AGE:
            considerations.append(f"Older property ({prop.property_age_years} years) — may need more maintenance")
    else:
        verify.append("Verify the property's age")

    if prop.furnished is None:
        verify.append("Verify furnishing inventory")

    if prop.latitude is None or prop.longitude is None:
        verify.append("Verify the exact location/coordinates")

    if prop.listing_type == "sale" and prop.deed_area is None:
        verify.append("Verify deed area with the seller")

    return PropertyHighlights(
        strengths=strengths[:_MAX_ITEMS_PER_SECTION],
        considerations=considerations[:_MAX_ITEMS_PER_SECTION],
        things_to_verify=verify[:_MAX_ITEMS_PER_SECTION],
    )
