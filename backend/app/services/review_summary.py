"""Review Summary (Prompt 4 — Property Verification & Trust Center, spec
section 12) — mediator profile "Trust & Activity" add-on. Summarizes an
existing mediator's APPROVED reviews into short positive themes +
considerations for prospective customers.

This is pure text summarization, allowed under the feature's global "AI may
explain/summarize/improve wording from facts it's given — never invent
facts" constraint. It is NOT a scoring/trust calculation: `avg_rating` /
`review_count` are always the plain deterministic aggregate (the same shape
`reviews.py`'s existing `GET /mediator/{id}/summary` already returns),
regardless of whether an AI summary ran.

Mirrors `partner_listing_ai.py`'s pattern exactly: gateway call + prompt
registry + a deterministic fallback (rating + count only, no AI text) when
there aren't enough reviews with actual comment text, `ANTHROPIC_API_KEY` is
unset, the gateway call raises, or the reply doesn't parse into usable
themes — never a fabricated theme standing in for a real one.

Grounding is enforced structurally, not by a prompt instruction alone: the
prompt is built ONLY from the comment text of the `Review` rows the caller
passes in. The caller is responsible for pre-filtering to
`status == "approved"` (the same visibility rule the public review
list/summary endpoints already enforce) before calling this module — a
pending or rejected review's text has no code path into the prompt. This
module never writes to `Review` rows; it only reads text already submitted
by real customers, and never modifies the original reviews.
"""
import json
import logging
from dataclasses import dataclass, field

from app.core.ai import gateway
from app.core.ai.prompts import MEDIATOR_REVIEW_SUMMARIZER
from app.core.config import settings
from app.models.review import Review

logger = logging.getLogger("app.services.review_summary")

_LANGUAGE_NAMES = {"en": "English", "ar": "Arabic"}

# Minimum number of approved reviews required before an AI summary is even
# attempted — below this, only the deterministic {avg_rating, review_count}
# is shown (spec section 12's "minimum review count" gate). Kept local to
# this service rather than `trust_config.py`: it only gates whether an *AI
# text summary* is generated, a different kind of judgment call than the
# Trust Model's weighted deterministic component thresholds that module
# centralizes for `trust_assessment.py`.
MIN_REVIEW_COUNT_FOR_AI_SUMMARY = 5

# Bound how many review comments are sent to the AI in one call — a popular
# mediator could accumulate hundreds of reviews; the summary only needs a
# representative, recent sample, not the entire history on every call.
MAX_REVIEWS_FOR_AI_SUMMARY = 30


@dataclass
class ReviewSummaryResult:
    avg_rating: float | None
    review_count: int
    positive_themes: list[str] = field(default_factory=list)
    considerations: list[str] = field(default_factory=list)
    generated_by: str = "fallback"  # "ai" | "fallback"
    note: str | None = None


def _reviews_facts_block(reviews: list[Review]) -> str:
    """Only rating + comment text from the approved reviews given — no other
    field of `Review`/`Mediator`/`User` is ever included, so nothing outside
    the reviewer's own words can reach the prompt."""
    lines: list[str] = []
    for r in reviews[:MAX_REVIEWS_FOR_AI_SUMMARY]:
        comment = (r.comment or "").strip()
        if not comment:
            continue
        lines.append(f"- Rating {r.rating}/5: {comment}")
    return "\n".join(lines)


def summarize_reviews(
    reviews: list[Review],
    *,
    avg_rating: float | None,
    review_count: int,
    language: str = "en",
    user_id: int | None = None,
) -> ReviewSummaryResult:
    """`reviews` must already be filtered to APPROVED reviews for one
    mediator (caller's responsibility, same pre-filter-before-calling
    pattern `partner_listing_ai.py` uses for property facts). `review_count`
    is the mediator's full approved-review count (may exceed `len(reviews)`
    if the caller already capped the query) — always reported as-is, even on
    the fallback path, since it's a plain deterministic count, never gated
    by whether an AI summary ran."""
    fallback_note = (
        "Not enough reviews yet for an AI summary — showing rating and review count only."
        if review_count < MIN_REVIEW_COUNT_FOR_AI_SUMMARY
        else "Reviews don't include enough written detail yet for an AI summary — showing rating and review count only."
    )

    facts = _reviews_facts_block(reviews)
    if review_count < MIN_REVIEW_COUNT_FOR_AI_SUMMARY or not facts or not settings.ANTHROPIC_API_KEY:
        return ReviewSummaryResult(
            avg_rating=avg_rating, review_count=review_count, generated_by="fallback", note=fallback_note
        )

    language_name = _LANGUAGE_NAMES.get(language, "English")
    call_status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=MEDIATOR_REVIEW_SUMMARIZER.template,
            tools=[],
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Language: {language_name}\n\n"
                        f"Approved customer reviews (use ONLY these — do not add anything not written here):\n{facts}"
                    ),
                }
            ],
            max_tokens=500,
        )
        call_status = "ok"
        parsed = json.loads(result.reply.strip())
        positive_themes = [str(t).strip() for t in parsed.get("positive_themes", []) if str(t).strip()]
        considerations = [str(t).strip() for t in parsed.get("considerations", []) if str(t).strip()]

        if not positive_themes and not considerations:
            raise ValueError("AI returned no usable themes")
        return ReviewSummaryResult(
            avg_rating=avg_rating,
            review_count=review_count,
            positive_themes=positive_themes,
            considerations=considerations,
            generated_by="ai",
        )
    except Exception as exc:  # noqa: BLE001 — must degrade to the deterministic fallback, never 500
        logger.warning("summarize_reviews: AI call failed, using deterministic fallback: %s", exc)
        call_status = "error"
        return ReviewSummaryResult(
            avg_rating=avg_rating, review_count=review_count, generated_by="fallback", note=fallback_note
        )
    finally:
        gateway.log_ai_call(
            feature="mediator_review_summary",
            model=gateway.DEFAULT_MODEL,
            prompt=MEDIATOR_REVIEW_SUMMARIZER,
            latency_ms=result.latency_ms if result else 0.0,
            status=call_status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
