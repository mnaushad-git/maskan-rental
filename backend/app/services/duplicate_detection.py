"""Trust Center — Duplicate Awareness (spec section 17). Deterministic, no
LLM, no auto-merge/delete: flags *possible* duplicate listings for a human
(mediator at publish time — Prompt 8's UI, or admin during moderation —
Prompt 6) to review. Runs a handful of independent, additive signals
against other Published listings of the same transaction type/city and
combines the strongest candidate's match score into a confidence band.

Judgment call (no fuller feature spec present in this repo — see
docs/implementation/mymakan-trust-center.md "Prompt 2" section): the spec
text references "same building+beds+size+similar price", but `Property` has
no building/complex identifier column. That signal is implemented as "same
area/city + same bedroom count + similar size + similar price" instead —
the closest equivalent from fields that actually exist (matches the
codebase's existing `Property.area`-as-district convention used elsewhere
in this feature, e.g. `listing_completeness.py`).
"""
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.trust_config import (
    DUPLICATE_CONFIDENCE_THRESHOLDS,
    DUPLICATE_MIN_DESCRIPTION_LENGTH,
    DUPLICATE_PRICE_BAND,
    DUPLICATE_SIGNAL_WEIGHTS,
    DUPLICATE_SIZE_BAND,
)
from app.models.property import Property

MAX_DUPLICATE_MATCHES = 5


@dataclass
class DuplicateMatch:
    property_id: int
    title: str
    reasons: list[str] = field(default_factory=list)
    match_score: int = 0  # 0-100, sum of this candidate's matched-signal weights


@dataclass
class DuplicateAwarenessResult:
    is_possible_duplicate: bool
    confidence: str  # "none" | "low" | "medium" | "high"
    matches: list[DuplicateMatch] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)  # top match's reasons, for a one-line summary


def _normalize_text(text: str | None) -> str:
    if not text:
        return ""
    return " ".join(text.strip().lower().split())


def _within_band(a: float | None, b: float | None, band: float) -> bool:
    if a is None or b is None or a <= 0 or b <= 0:
        return False
    return abs(a - b) / max(a, b) <= band


def _price_for(prop: Property) -> float | None:
    return prop.sale_price if prop.listing_type == "sale" else prop.monthly_rent


def _image_urls(prop: Property) -> set[str]:
    urls = {img.url for img in (prop.listing_images or []) if img.url}
    if prop.image_url:
        urls.add(prop.image_url)
    return urls


def _candidate_signals(subject: Property, candidate: Property) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    same_location = _normalize_text(subject.area) == _normalize_text(candidate.area) and _normalize_text(
        subject.city
    ) == _normalize_text(candidate.city)

    same_mediator = subject.mediator_id is not None and subject.mediator_id == candidate.mediator_id
    same_characteristics = (
        subject.bedrooms is not None
        and subject.bedrooms == candidate.bedrooms
        and subject.bathrooms == candidate.bathrooms
        and subject.property_type == candidate.property_type
    )
    if same_mediator and same_location and same_characteristics:
        score += DUPLICATE_SIGNAL_WEIGHTS["same_mediator_location_characteristics"]
        reasons.append("Same mediator, location, and property characteristics as another listing")

    shared_images = _image_urls(subject) & _image_urls(candidate)
    if shared_images:
        score += DUPLICATE_SIGNAL_WEIGHTS["shared_image"]
        reasons.append("Shares an identical listing photo with another listing")

    if (
        same_location
        and subject.bedrooms is not None
        and subject.bedrooms == candidate.bedrooms
        and _within_band(subject.size_sq_m, candidate.size_sq_m, DUPLICATE_SIZE_BAND)
        and _within_band(_price_for(subject), _price_for(candidate), DUPLICATE_PRICE_BAND)
    ):
        score += DUPLICATE_SIGNAL_WEIGHTS["same_location_beds_size_price"]
        reasons.append("Same area, bedroom count, size, and a similar price to another listing")

    subject_desc = _normalize_text(subject.description)
    candidate_desc = _normalize_text(candidate.description)
    if (
        subject_desc
        and candidate_desc
        and len(subject_desc) >= DUPLICATE_MIN_DESCRIPTION_LENGTH
        and subject_desc == candidate_desc
    ):
        score += DUPLICATE_SIGNAL_WEIGHTS["similar_description"]
        reasons.append("Nearly identical description to another listing")

    return min(score, 100), reasons


def _confidence_for(score: int) -> str:
    for threshold, label in DUPLICATE_CONFIDENCE_THRESHOLDS:
        if score >= threshold:
            return label
    return DUPLICATE_CONFIDENCE_THRESHOLDS[-1][1]


def find_possible_duplicates(db: Session, prop: Property, *, limit: int = MAX_DUPLICATE_MATCHES) -> DuplicateAwarenessResult:
    """Compares `prop` against other Published listings of the same
    transaction type in the same city (same coarse pre-filter
    `get_similar_properties`/`find_comparable_properties` already use) and
    scores each candidate on independent, additive signals. Never
    auto-merges, hides, or deletes anything — only surfaces matches +
    reasons for a human to review."""
    candidates = db.scalars(
        select(Property)
        .options(selectinload(Property.listing_images))
        .where(
            Property.id != prop.id,
            Property.city.ilike(prop.city or ""),
            Property.listing_type == prop.listing_type,
            Property.status == "Published",
        )
    ).all()

    matches: list[DuplicateMatch] = []
    for candidate in candidates:
        score, reasons = _candidate_signals(prop, candidate)
        if score > 0:
            matches.append(DuplicateMatch(property_id=candidate.id, title=candidate.title, reasons=reasons, match_score=score))

    matches.sort(key=lambda m: m.match_score, reverse=True)
    matches = matches[:limit]

    top_score = matches[0].match_score if matches else 0
    confidence = _confidence_for(top_score)

    return DuplicateAwarenessResult(
        is_possible_duplicate=confidence in ("medium", "high"),
        confidence=confidence,
        matches=matches,
        reasons=matches[0].reasons if matches else [],
    )
