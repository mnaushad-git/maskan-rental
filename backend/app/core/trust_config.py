"""Property Verification & Trust Center — centralized, deterministic config.

Every weight/threshold the Trust Model (`app.services.trust_assessment` and
its component calculators) uses lives here, in one place, so the model can be
tuned without hunting through five service files. No LLM involvement anywhere
in this file or the calculators that read it — see
`docs/implementation/mymakan-trust-center.md` ("Trust Methodology") for the
full write-up of the choices encoded below.

Mirrors the existing `app.services.property_decision_score.WEIGHTS` /
`app.services.home_finder_scoring` pattern used elsewhere in this codebase:
a central weights dict that sums to 1.0, missing-data components excluded and
the remaining weights renormalized — never a guessed/fabricated value.
"""
from __future__ import annotations

from typing import Callable

from app.models.property import Property

# ─────────────────────────────────────────────────────────────────────────
# Top-level component weights (must sum to 1.0). Any component that can't be
# calculated for a given listing (e.g. no mediator on record, or the caller
# didn't supply a Data Confidence result) is omitted and the remaining
# weights renormalize — see `trust_assessment.assess_property_trust`.
# ─────────────────────────────────────────────────────────────────────────
TRUST_COMPONENT_WEIGHTS: dict[str, float] = {
    "completeness": 0.25,
    "consistency": 0.20,
    "mediator_trust": 0.20,
    "freshness": 0.15,
    "marketplace_confidence": 0.20,
}

# Overall score -> trust level label. Checked high-to-low, first match wins.
TRUST_LEVEL_THRESHOLDS: list[tuple[int, str]] = [
    (85, "High"),
    (70, "Good"),
    (50, "Moderate"),
    (0, "Limited Confidence"),
]

# ─────────────────────────────────────────────────────────────────────────
# Listing Completeness — required/important/optional field weighting,
# mirroring the required/important/optional tiering pattern used by
# `property_decision_score.py`'s dimension config. Each tier carries a
# weight-per-field; the score is the weighted fraction of present fields.
# ─────────────────────────────────────────────────────────────────────────
COMPLETENESS_TIER_WEIGHTS: dict[str, int] = {
    "required": 3,
    "important": 2,
    "optional": 1,
}


def _has_price(prop: Property) -> bool:
    return (prop.monthly_rent is not None) if prop.listing_type != "sale" else (prop.sale_price is not None)


def _has_description(prop: Property) -> bool:
    return bool(prop.description and prop.description.strip())


def _has_multiple_images(prop: Property) -> bool:
    return len(prop.listing_images or []) >= 3


# (field_key, display_label, presence_check) per tier.
CompletenessField = tuple[str, str, Callable[[Property], bool]]

COMPLETENESS_FIELDS: dict[str, list[CompletenessField]] = {
    "required": [
        ("title", "Title", lambda p: bool(p.title and p.title.strip())),
        ("district", "District / area", lambda p: bool(p.area and p.area.strip())),
        ("city", "City", lambda p: bool(p.city and p.city.strip())),
        ("price", "Price", _has_price),
        ("property_type", "Property type", lambda p: bool(p.property_type)),
        ("bedrooms", "Bedrooms", lambda p: p.bedrooms is not None),
        ("bathrooms", "Bathrooms", lambda p: p.bathrooms is not None),
        ("size_sq_m", "Size (sqm)", lambda p: p.size_sq_m is not None),
        ("images", "Photos", lambda p: bool(p.listing_images)),
        ("description", "Description", _has_description),
    ],
    "important": [
        ("coordinates", "Map location", lambda p: p.latitude is not None and p.longitude is not None),
        ("furnished", "Furnishing status", lambda p: bool(p.furnished)),
        ("living_rooms", "Living rooms", lambda p: p.living_rooms is not None),
        ("contact_phone", "Contact number", lambda p: bool(p.contact_phone or p.mediator_phone)),
        ("multiple_images", "Multiple photos (3+)", _has_multiple_images),
    ],
    "optional": [
        ("property_age", "Property age", lambda p: p.property_age_years is not None),
        ("deed_area", "Deed area", lambda p: p.deed_area is not None),
        ("whatsapp", "WhatsApp number", lambda p: bool(p.whatsapp_phone)),
        ("license_number", "License number", lambda p: bool(p.license_number)),
    ],
}

# ─────────────────────────────────────────────────────────────────────────
# Listing Consistency — info/warning/blocking severities and the score
# penalty each severity subtracts from a 100-point baseline.
# ─────────────────────────────────────────────────────────────────────────
CONSISTENCY_SEVERITY_PENALTY: dict[str, int] = {
    "blocking": 35,
    "warning": 15,
    "info": 5,
}
MAX_REASONABLE_BEDROOMS = 20
MAX_REASONABLE_BATHROOMS = 20

# ─────────────────────────────────────────────────────────────────────────
# Mediator Trust — sub-signal weights (must sum to 1.0). `rating` is only
# included when the mediator has at least one approved review; otherwise it
# is omitted and the remaining sub-signals renormalize, same pattern as the
# top-level components.
# ─────────────────────────────────────────────────────────────────────────
MEDIATOR_TRUST_SIGNAL_WEIGHTS: dict[str, float] = {
    "verified": 0.40,
    "rating": 0.20,
    "review_count": 0.20,
    "listing_history": 0.20,
}
# Review-count / listing-count values at which that sub-signal reaches full
# (1.0) credit — a simple linear ramp capped at 1.0, not a hard cutoff.
MEDIATOR_REVIEW_COUNT_TARGET = 10
MEDIATOR_LISTING_COUNT_TARGET = 5

# New-partner protection: a brand-new, not-yet-verified mediator with no
# track record yet (no reviews, no more than their first listing) would
# otherwise score close to 0 on Mediator Trust simply for having just
# joined — that's not a trust signal, it's an absence of one, and it would
# unfairly tank an otherwise-strong listing's overall score right at launch
# when we most need new partners willing to list. For this many days after
# the mediator's account was created, Mediator Trust is OMITTED from the
# overall Trust Assessment (renormalized, same as any other missing
# component) instead of being scored against signals they haven't had time
# to earn. Ends immediately — even within the window — the moment they get
# verified, pick up a review, or add a second listing. See
# `mediator_trust._is_new_partner_grace_period`.
MEDIATOR_TRUST_GRACE_PERIOD_DAYS = 30

# ─────────────────────────────────────────────────────────────────────────
# Listing Freshness — thresholds in days, checked in this order:
# availability-confirmation first (once that field exists — see Prompt 2's
# `Property.availability_confirmed_at`; today it is always None so this path
# is inert but ready), then last-updated, then a "needs reconfirmation"
# ceiling before falling through to "potentially stale".
# ─────────────────────────────────────────────────────────────────────────
FRESHNESS_RECENTLY_CONFIRMED_DAYS = 30
FRESHNESS_RECENTLY_UPDATED_DAYS = 14
FRESHNESS_NEEDS_RECONFIRMATION_DAYS = 60

FRESHNESS_CATEGORY_SCORES: dict[str, int] = {
    "Recently Confirmed": 100,
    "Recently Updated": 80,
    "Needs Reconfirmation": 50,
    "Potentially Stale": 20,
}

# ─────────────────────────────────────────────────────────────────────────
# Display / list-length caps for the deterministic narrative lists
# (`positive_signals`, `missing_information`, `things_to_verify`) so the
# Trust Center UI (a later prompt) never has to truncate a huge list itself.
# ─────────────────────────────────────────────────────────────────────────
MAX_POSITIVE_SIGNALS = 6
MAX_MISSING_INFORMATION = 6
MAX_THINGS_TO_VERIFY = 6

# ─────────────────────────────────────────────────────────────────────────
# Duplicate Awareness (spec section 17) — lightweight, deterministic,
# no auto-merge/delete. Each independent signal contributes an additive
# weight to a candidate's match score (0-100, capped); the top score maps
# to a confidence band via DUPLICATE_CONFIDENCE_THRESHOLDS (checked
# high-to-low, first match wins — same pattern as TRUST_LEVEL_THRESHOLDS).
# `size`/`price` "similar" bands are +/- the given fraction.
# ─────────────────────────────────────────────────────────────────────────
DUPLICATE_SIGNAL_WEIGHTS: dict[str, int] = {
    "same_mediator_location_characteristics": 40,
    "shared_image": 30,
    "same_location_beds_size_price": 20,
    "similar_description": 20,
}
DUPLICATE_SIZE_BAND = 0.10  # +/-10%
DUPLICATE_PRICE_BAND = 0.10  # +/-10%
DUPLICATE_MIN_DESCRIPTION_LENGTH = 40  # avoid false positives on short/blank descriptions

DUPLICATE_CONFIDENCE_THRESHOLDS: list[tuple[int, str]] = [
    (60, "high"),
    (40, "medium"),
    (20, "low"),
    (0, "none"),
]

# ─────────────────────────────────────────────────────────────────────────
# Partner Listing Quality (Prompt 3) — deterministic image-quality signal
# thresholds (spec section 9). No computer vision anywhere here or in
# `app.services.image_quality` — every signal is a plain presence/format
# check. `IMAGE_QUALITY_MIN_IMAGES` intentionally mirrors the same "3" used
# by `COMPLETENESS_FIELDS`'s "multiple_images" tier above, but is kept as its
# own named constant (rather than importing that one) since the two are
# conceptually independent consumers — completeness scoring vs. a standalone
# partner-facing image-quality signal — that happen to agree on the same
# number today.
# ─────────────────────────────────────────────────────────────────────────
IMAGE_QUALITY_MIN_IMAGES = 3
# `ListingImage` has no width/height columns today (see
# `app/models/listing_image.py`) — the low-resolution check in
# `image_quality.py` reads these via `getattr(img, "width"/"height", None)`
# and is always inert until a future migration adds them, the same
# forward-compatible pattern Prompt 1 used for `availability_confirmed_at`
# before Prompt 2 added that column.
IMAGE_QUALITY_MIN_WIDTH_PX = 800
IMAGE_QUALITY_MIN_HEIGHT_PX = 600
