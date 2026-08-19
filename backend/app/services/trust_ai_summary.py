"""Property Verification & Trust Center — AI Trust Summary (Prompt 5, spec
section 18). Writes a short natural-language explanation of a SINGLE
property's already-computed, deterministic `TrustAssessment` (Prompt 1) —
this module never scores or recalculates trust itself, it only explains a
score that already exists. Per the feature's global "Trust/completeness/
consistency scores are 100% deterministic — never LLM-calculated"
constraint, `overall_score`/`trust_level`/every component score always come
from `trust_assessment.assess_property_trust` regardless of whether this
module's AI call succeeds.

Mirrors `review_summary.py`'s pattern exactly: gateway call + prompt
registry + a deterministic fallback (assembled from the assessment's own
`positive_signals`/`things_to_verify` text, no AI) when `ANTHROPIC_API_KEY`
is unset, the gateway call raises, or the reply doesn't parse into usable
text — "AI Trust Summary" must never block or break Property Detail, and a
deterministic paragraph built from real signals is the only safe fallback
(never a fabricated explanation).

Grounding is enforced structurally, not by a prompt instruction alone: the
prompt content is built from exactly four inputs the caller passes in —
`assessment` (Prompt 1's `TrustAssessment`), `prop` (a fixed, explicit
allowlist of property identity fields — title/type/location only, no price,
no amenities, no owner/mediator identity), `mediator_trust` (Prompt 1's own
`MediatorTrustResult`, the same object `assessment.component_scores` may
already carry — passed explicitly so this module never reaches back into
`assessment.component_scores` or the database itself for anything else),
and `review_summary` (Prompt 4's `ReviewSummaryResult`). No other `Property`/
`Mediator`/`Review` field, and nothing from the database, has any code path
into the prompt.
"""
import logging
from dataclasses import dataclass

from app.core.ai import gateway
from app.core.ai.prompts import TRUST_SUMMARY_EXPLAINER
from app.core.config import settings
from app.models.property import Property
from app.services.mediator_trust import MediatorTrustResult
from app.services.review_summary import ReviewSummaryResult
from app.services.trust_assessment import TrustAssessment

logger = logging.getLogger("app.services.trust_ai_summary")

_LANGUAGE_NAMES = {"en": "English", "ar": "Arabic"}

# How many of each deterministic list to surface in the prompt/fallback —
# mirrors `trust_assessment.py`'s own MAX_* caps, kept local here since this
# is a presentation choice for the explanation, not a Trust Model input.
_MAX_SIGNALS_IN_SUMMARY = 4


@dataclass
class TrustSummaryResult:
    summary: str
    generated_by: str = "fallback"  # "ai" | "fallback"


def _trust_assessment_facts_block(assessment: TrustAssessment) -> str:
    """ONLY the deterministic assessment's own already-computed fields —
    never recomputed, never augmented with anything outside this object."""
    lines = [
        f"Overall trust score: {assessment.overall_score}/100",
        f"Trust level: {assessment.trust_level}",
    ]
    if assessment.positive_signals:
        lines.append("Positive signals: " + "; ".join(assessment.positive_signals[:_MAX_SIGNALS_IN_SUMMARY]))
    if assessment.missing_information:
        lines.append("Missing information: " + "; ".join(assessment.missing_information[:_MAX_SIGNALS_IN_SUMMARY]))
    if assessment.things_to_verify:
        lines.append("Things to verify: " + "; ".join(assessment.things_to_verify[:_MAX_SIGNALS_IN_SUMMARY]))
    return "\n".join(lines)


def _property_facts_block(prop: Property) -> str:
    """Basic identity/context only — title, transaction type, property type,
    district/city. Deliberately excludes price, amenities, mediator
    identity, and anything else — this summary explains TRUST, not value or
    features, so nothing beyond "what/where" belongs in its grounding."""
    lines = [
        f"Title: {prop.title}",
        f"Transaction type: {'For sale' if prop.listing_type == 'sale' else 'For rent'}",
        f"District/area: {prop.area}",
        f"City: {prop.city}",
    ]
    if prop.property_type:
        lines.append(f"Property type: {prop.property_type}")
    return "\n".join(lines)


def _mediator_trust_facts_block(mediator_trust: MediatorTrustResult | None) -> str:
    if mediator_trust is None:
        return "No mediator is on record for this listing."
    lines = [
        f"Mediator verification: {'Verified by myMakan' if mediator_trust.is_verified else 'Not yet verified by myMakan'}",
        f"Mediator listing count on myMakan: {mediator_trust.listing_count}",
    ]
    if mediator_trust.review_count > 0 and mediator_trust.avg_rating is not None:
        lines.append(f"Mediator rating: {mediator_trust.avg_rating:.1f}/5 from {mediator_trust.review_count} review(s)")
    else:
        lines.append("Mediator rating: no reviews yet")
    return "\n".join(lines)


def _review_summary_facts_block(review_summary: ReviewSummaryResult | None) -> str:
    if review_summary is None or review_summary.review_count == 0:
        return "No customer reviews yet for this mediator."
    lines = [f"Review count: {review_summary.review_count}"]
    if review_summary.avg_rating is not None:
        lines.append(f"Average rating: {review_summary.avg_rating:.1f}/5")
    if review_summary.positive_themes:
        lines.append("Review positive themes: " + "; ".join(review_summary.positive_themes))
    if review_summary.considerations:
        lines.append("Review considerations: " + "; ".join(review_summary.considerations))
    return "\n".join(lines)


def _deterministic_fallback_summary(assessment: TrustAssessment, prop: Property) -> str:
    """Never calls the AI — assembled entirely from the assessment's own
    already-computed, deterministic text. This is the "no error state shown
    to the user" contract: a real, useful explanation, just not AI-written."""
    sentences = [f"{prop.title} has a {assessment.trust_level.lower()} trust score of {assessment.overall_score}/100."]
    if assessment.positive_signals:
        sentences.append("Positive signals: " + "; ".join(assessment.positive_signals[:3]) + ".")
    if assessment.things_to_verify:
        sentences.append("Before proceeding, verify: " + "; ".join(assessment.things_to_verify[:3]) + ".")
    elif assessment.missing_information:
        sentences.append("Some listing details are still missing: " + "; ".join(assessment.missing_information[:3]) + ".")
    return " ".join(sentences)


def summarize_trust_assessment(
    assessment: TrustAssessment,
    prop: Property,
    mediator_trust: MediatorTrustResult | None,
    review_summary: ReviewSummaryResult | None,
    *,
    language: str = "en",
    user_id: int | None = None,
) -> TrustSummaryResult:
    """Callable independently of `GET /properties/{id}/trust` — this
    function (and the separate `GET /properties/{id}/trust-summary` route
    that calls it) is never invoked from `get_property_trust`'s synchronous
    path, so Property Detail's deterministic trust render is never blocked
    by or coupled to this AI call. On any failure, falls back to a
    deterministic paragraph built from the assessment's own signals — never
    an error state."""
    fallback = _deterministic_fallback_summary(assessment, prop)

    if not settings.ANTHROPIC_API_KEY:
        return TrustSummaryResult(summary=fallback, generated_by="fallback")

    facts = (
        f"Trust assessment:\n{_trust_assessment_facts_block(assessment)}\n\n"
        f"Property:\n{_property_facts_block(prop)}\n\n"
        f"Mediator trust:\n{_mediator_trust_facts_block(mediator_trust)}\n\n"
        f"Review summary:\n{_review_summary_facts_block(review_summary)}"
    )
    language_name = _LANGUAGE_NAMES.get(language, "English")

    call_status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=TRUST_SUMMARY_EXPLAINER.template,
            tools=[],
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Language: {language_name}\n\n"
                        f"Facts (use ONLY these — do not add anything not listed here):\n{facts}"
                    ),
                }
            ],
            max_tokens=400,
        )
        call_status = "ok"
        text = result.reply.strip()
        if not text:
            raise ValueError("AI returned an empty summary")
        return TrustSummaryResult(summary=text, generated_by="ai")
    except Exception as exc:  # noqa: BLE001 — must degrade to the deterministic fallback, never 500
        logger.warning("summarize_trust_assessment: AI call failed, using deterministic fallback: %s", exc)
        call_status = "error"
        return TrustSummaryResult(summary=fallback, generated_by="fallback")
    finally:
        gateway.log_ai_call(
            feature="property_trust_summary",
            model=gateway.DEFAULT_MODEL,
            prompt=TRUST_SUMMARY_EXPLAINER,
            latency_ms=result.latency_ms if result else 0.0,
            status=call_status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
