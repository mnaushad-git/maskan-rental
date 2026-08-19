"""Partner Listing Quality — "Improve with AI" (spec section 8). Rewrites a
partner's own title/description for clarity using ONLY the structured facts
already saved on their property row (the exact same field set
`PartnerPropertyCreate`/`PartnerPropertyUpdate` accept) — never invents an
amenity, dimension, location, price, verification, or availability claim.

Mirrors `property_intelligence_ai.py`'s pattern: gateway call + prompt
registry + a deterministic fallback (the original title/description, passed
through unchanged) when `ANTHROPIC_API_KEY` is unset, the call fails, or the
reply doesn't parse into a usable suggestion — "Improve with AI" must never
break the listing-edit flow, and echoing the original wording is the only
safe fallback (never a fabricated rewrite).

The route handler (`POST /partner/properties/{id}/improve-with-ai`) never
auto-saves this result — the partner must explicitly approve it before it's
applied to the form, per this feature's global "AI may improve wording,
never invent facts, and always needs human approval" constraint.
"""
import json
import logging

from app.core.ai import gateway
from app.core.ai.prompts import PARTNER_LISTING_IMPROVER
from app.core.config import settings
from app.models.property import Property

logger = logging.getLogger("app.services.partner_listing_ai")

_LANGUAGE_NAMES = {"en": "English", "ar": "Arabic"}

# Every amenity boolean column safe to surface as a fact — a fixed, explicit
# allowlist rather than iterating the model's own attributes, so a future
# unrelated column can never leak into the AI prompt by accident.
_AMENITY_FIELDS: list[tuple[str, str]] = [
    ("has_kitchen", "Equipped kitchen"),
    ("has_water", "Water included"),
    ("has_electricity", "Electricity included"),
    ("has_private_roof", "Private roof"),
    ("in_villa", "Villa-style"),
    ("has_two_entrances", "Two entrances"),
    ("has_separate_electrical_meter", "Separate electrical meter"),
    ("has_elevator", "Elevator"),
    ("has_airconditioners", "Air conditioning"),
]


def _facts_block(prop: Property) -> str:
    """Only fields the mediator themselves supplied when creating/editing
    this listing. Deliberately excludes anything trust/verification-related
    (`mediator.is_verified`, `availability_confirmed_at`, review data, etc.)
    so the AI has no way to reference or imply them — grounding is enforced
    by simply never including those fields in the facts block at all."""
    lines = [
        f"Current title: {prop.title or '(none yet)'}",
        f"Current description: {prop.description or '(none yet)'}",
        f"Transaction type: {'For sale' if prop.listing_type == 'sale' else 'For rent'}",
        f"District/area: {prop.area}",
        f"City: {prop.city}",
    ]
    if prop.property_type:
        lines.append(f"Property type: {prop.property_type}")
    if prop.bedrooms is not None:
        lines.append(f"Bedrooms: {prop.bedrooms}")
    if prop.bathrooms is not None:
        lines.append(f"Bathrooms: {prop.bathrooms}")
    if prop.living_rooms is not None:
        lines.append(f"Living rooms: {prop.living_rooms}")
    if prop.size_sq_m is not None:
        lines.append(f"Size: {prop.size_sq_m} sqm")
    if prop.furnished:
        lines.append(f"Furnishing: {prop.furnished}")
    if prop.property_age_years is not None:
        lines.append(f"Property age: {prop.property_age_years} years")
    amenities = [label for field_name, label in _AMENITY_FIELDS if getattr(prop, field_name, False)]
    if amenities:
        lines.append("Amenities: " + ", ".join(amenities))
    return "\n".join(lines)


def improve_listing_wording(
    prop: Property,
    *,
    focus: str = "both",
    language: str = "en",
    user_id: int | None = None,
) -> tuple[str | None, str | None, str]:
    """Returns (suggested_title, suggested_description, generated_by).
    `generated_by` is "ai" or "fallback"; on fallback the suggestion is
    simply the property's current title/description unchanged — never a
    fabricated rewrite. Fields outside `focus` are always None."""
    fallback_title = prop.title if focus in ("title", "both") else None
    fallback_description = prop.description if focus in ("description", "both") else None

    if not settings.ANTHROPIC_API_KEY:
        return fallback_title, fallback_description, "fallback"

    facts = _facts_block(prop)
    language_name = _LANGUAGE_NAMES.get(language, "English")

    call_status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=PARTNER_LISTING_IMPROVER.template,
            tools=[],
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Language: {language_name}\nFocus: {focus}\n\n"
                        f"Facts (use ONLY these — do not add anything not listed here):\n{facts}"
                    ),
                }
            ],
            max_tokens=500,
        )
        call_status = "ok"
        parsed = json.loads(result.reply.strip())

        title = fallback_title
        description = fallback_description
        if focus in ("title", "both") and parsed.get("title"):
            title = str(parsed["title"]).strip()
        if focus in ("description", "both") and parsed.get("description"):
            description = str(parsed["description"]).strip()

        if title == fallback_title and description == fallback_description:
            raise ValueError("AI returned no usable suggestion")
        return title, description, "ai"
    except Exception as exc:  # noqa: BLE001 — must degrade to the original wording, never 500
        logger.warning("improve_listing_wording: AI call failed, using original wording as fallback: %s", exc)
        call_status = "error"
        return fallback_title, fallback_description, "fallback"
    finally:
        gateway.log_ai_call(
            feature="partner_listing_improve",
            model=gateway.DEFAULT_MODEL,
            prompt=PARTNER_LISTING_IMPROVER,
            latency_ms=result.latency_ms if result else 0.0,
            status=call_status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
