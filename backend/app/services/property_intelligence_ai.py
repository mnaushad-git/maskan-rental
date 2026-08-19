"""Property Intelligence — AI Summary + negotiation-message draft. Mirrors
`app.services.home_finder_ai.explain_match`'s pattern: a grounded narration
over already-computed deterministic data (never a fresh calculation), the
same gateway/prompt-registry call, and a deterministic template fallback
(both languages) when `ANTHROPIC_API_KEY` is unset or the call fails —
Property Intelligence must never depend on the AI call succeeding.

Two variants share one entry point (`summarize_property_intelligence`,
`variant=`) rather than a second AI endpoint (Prompt 9's negotiation
"Draft Message" action reuses the Prompt 6 `/ai-summary` route with an
optional `variant` field): `"summary"` (the original 2-4 sentence
narration) and `"negotiation_message"` (a short draft message the user can
send to the agent, grounded in `negotiation_intelligence` only — the caller
is responsible for not requesting this variant when that field is `None`).

**Extended in Prompt 6 (AI Negotiation & Offer Management, see
docs/implementation/mymakan-negotiations.md "AI behavior — message
drafting"):** `summarize_property_intelligence(..., negotiation=,
offer_history=)` takes two additional OPTIONAL keyword-only arguments, used
only when `variant="negotiation_message"`. When a `negotiation` (a real
`PropertyNegotiation` row, plus its `offer_history`) is supplied, the draft
is grounded in THAT negotiation's actual numbers (asking price / current
offer / the counterparty's latest counter, if one exists) instead of the
generic pre-negotiation discussion range — e.g. "I'd like to offer SAR
68,500" for a fresh negotiation vs. "Following your counter of SAR 70,000,
I'd like to propose SAR 69,500" once the mediator has countered. This is
still the SAME endpoint/entry point (no second AI route) — the caller
(`POST /properties/{id}/ai-summary`, see `app/api/routes/properties.py`)
is responsible for loading the negotiation, verifying it belongs to the
requesting customer, and passing it in; this function trusts whatever it's
given. The pre-existing no-negotiation call path (used directly from
Property Detail, before any negotiation exists) is completely unchanged
when `negotiation` is omitted (`None` by default).

**Hard requirement for the frontend prompts that consume this (Prompts
7-9):** the drafted message returned here — from EITHER call path — must
always land in an EDITABLE text field the customer can review and change
before sending. It is NEVER auto-sent on the customer's behalf. This
service has no notion of "sending" at all (it only returns text); the
requirement is enforced entirely at the frontend layer, but is written
down explicitly here so the prompts that build that UI don't skip it.

Known limitation (see tracking doc "AI usage"): unlike the sanitizers in
`home_finder_ai.py` (which constrain structured JSON fields to a fixed
vocabulary before they reach the scoring engine), this module's output is
free-form narration and there's no structured field to validate against —
the AI reply is trusted as-is once returned, matching the same trust level
`home_finder_ai.explain_match` already operates at for its narration. Adding
a numeric-hallucination validator here would be new infra beyond this
prompt's scope.
"""
import logging
from typing import Literal

from app.core.ai import gateway
from app.core.ai.prompts import PROPERTY_INTELLIGENCE_SUMMARY, PROPERTY_NEGOTIATION_MESSAGE
from app.core.config import settings
from app.models.property_negotiation import NegotiationOffer, PropertyNegotiation
from app.schemas.property_intelligence import PropertyIntelligenceOut

logger = logging.getLogger("app.services.property_intelligence_ai")

_LANGUAGE_NAMES = {"en": "English", "ar": "Arabic"}
Variant = Literal["summary", "negotiation_message"]


def _facts_block(intelligence: PropertyIntelligenceOut) -> str:
    lines = [
        f"Decision score: {intelligence.decision_score}/100",
        "Price classification: "
        + (intelligence.price_intelligence.classification or "not available (insufficient market data)"),
        "Top strengths: " + ("; ".join(intelligence.strengths[:3]) if intelligence.strengths else "none recorded"),
        "Top considerations: "
        + ("; ".join(intelligence.considerations[:3]) if intelligence.considerations else "none recorded"),
    ]
    if intelligence.personalized_fit is not None:
        lines.append(f"Personalized fit: {intelligence.personalized_fit.summary}")
    return "\n".join(lines)


def _negotiation_facts_block(intelligence: PropertyIntelligenceOut) -> str | None:
    neg = intelligence.negotiation_intelligence
    if neg is None:
        return None
    return "\n".join([
        f"Asking price: SAR {neg.asking_price:,.0f}",
        f"Market midpoint: SAR {neg.market_midpoint:,.0f}",
        f"Discussion range: SAR {neg.discussion_range_low:,.0f} - SAR {neg.discussion_range_high:,.0f}",
        f"Suggested approach: {neg.approach}",
    ])


def _deterministic_summary(intelligence: PropertyIntelligenceOut, language: str) -> str:
    score = intelligence.decision_score
    classification = intelligence.price_intelligence.classification
    top_strength = intelligence.strengths[0] if intelligence.strengths else None

    if language == "ar":
        parts = [f"يبلغ مؤشر القرار لهذا العقار {score} من 100."]
        if classification:
            parts.append(f'من حيث السعر، يُصنَّف هذا العقار كـ "{classification}" مقارنة بعقارات مشابهة.')
        if top_strength:
            parts.append(top_strength)
        return " ".join(parts)

    parts = [f"This property has a Decision Score of {score}/100."]
    if classification:
        parts.append(f'On price, it\'s classified as "{classification}" compared to similar listings.')
    if top_strength:
        parts.append(top_strength)
    return " ".join(parts)


def _grounded_negotiation_facts_block(
    intelligence: PropertyIntelligenceOut,
    negotiation: PropertyNegotiation,
    offer_history: list[NegotiationOffer],
) -> str:
    """Prompt 6: grounds the "Draft Message" action in an IN-PROGRESS
    negotiation's actual numbers rather than the generic pre-negotiation
    discussion range `_negotiation_facts_block` above builds. Called only
    when the caller supplies a real `negotiation` (and its offer history) —
    the property's own `negotiation_intelligence` (market midpoint /
    discussion range) is still included as supporting context, never a
    fresh calculation, same "no fabricated number" rule as every other
    AI-grounding facts block in this codebase."""
    lines = [
        f"Asking price: SAR {float(negotiation.original_listing_amount):,.0f}",
        f"Current offer on the table: SAR {float(negotiation.current_offer_amount):,.0f} "
        f"(negotiation status: {negotiation.status})",
    ]
    latest = offer_history[-1] if offer_history else None
    if latest is not None:
        if latest.offer_type == "mediator_counter":
            lines.append(
                f"The mediator's latest counter: SAR {float(latest.amount):,.0f} — this draft message is a REPLY "
                "to that counter, not a first-contact message."
            )
        elif len(offer_history) == 1:
            lines.append("This is the customer's first offer on this property — no counter has been made yet.")
        else:
            lines.append(
                "The customer's own offer/counter is the latest on the table — awaiting the mediator's reply."
            )
    neg = intelligence.negotiation_intelligence
    if neg is not None:
        lines.append(f"Market midpoint (Property Intelligence): SAR {neg.market_midpoint:,.0f}")
        lines.append(f"Discussion range: SAR {neg.discussion_range_low:,.0f} - SAR {neg.discussion_range_high:,.0f}")
    if len(offer_history) > 1:
        lines.append("Offer history (oldest to newest):")
        for o in offer_history:
            lines.append(f"- SAR {float(o.amount):,.0f} ({o.offer_type}, status: {o.status})")
    return "\n".join(lines)


def _deterministic_negotiation_message_grounded(
    negotiation: PropertyNegotiation, offer_history: list[NegotiationOffer], language: str
) -> str:
    """Deterministic fallback for the negotiation-grounded draft (used when
    the AI call fails/is unavailable). Never invents a number out of thin
    air: when replying to a mediator counter it proposes the midpoint
    between the customer's own last offer and that counter — a transparent
    average of two REAL numbers already in the offer history, not a
    fabricated one — otherwise it references the customer's own actual
    current offer amount."""
    asking = float(negotiation.original_listing_amount)
    current = float(negotiation.current_offer_amount)
    latest = offer_history[-1] if offer_history else None

    if latest is not None and latest.offer_type == "mediator_counter":
        previous_customer = next(
            (o for o in reversed(offer_history[:-1]) if o.offer_type in ("customer_offer", "customer_counter")),
            None,
        )
        propose = (float(previous_customer.amount) + current) / 2 if previous_customer else current
        if language == "ar":
            return (
                f"شكرًا على عرضكم المضاد بقيمة {current:,.0f} ريال. أود أن أقترح {propose:,.0f} ريال مقابل سعر "
                f"الطلب البالغ {asking:,.0f} ريال. أتطلع لسماع رأيكم."
            )
        return (
            f"Following your counter of SAR {current:,.0f}, I'd like to propose SAR {propose:,.0f} against the "
            f"asking price of SAR {asking:,.0f}. I'd appreciate hearing your thoughts."
        )

    if language == "ar":
        return (
            f"مرحبًا، أود تقديم عرض بقيمة {current:,.0f} ريال لهذا العقار المعروض بسعر {asking:,.0f} ريال. "
            "أتطلع لمناقشة هذا الأمر معكم."
        )
    return (
        f"Hi, I'd like to offer SAR {current:,.0f} for this property listed at SAR {asking:,.0f}. "
        "I look forward to discussing this with you."
    )


def _deterministic_negotiation_message(intelligence: PropertyIntelligenceOut, language: str) -> str:
    neg = intelligence.negotiation_intelligence
    if neg is None:
        return _deterministic_summary(intelligence, language)

    if language == "ar":
        return (
            f"مرحبًا، أنا مهتم بهذا العقار المعروض بسعر {neg.asking_price:,.0f} ريال. "
            f"بناءً على بيانات السوق المتاحة، هل يمكن مناقشة سعر أقرب إلى نطاق "
            f"{neg.discussion_range_low:,.0f} - {neg.discussion_range_high:,.0f} ريال؟ "
            "أتطلع لسماع رأيكم."
        )

    return (
        f"Hi, I'm interested in this property listed at SAR {neg.asking_price:,.0f}. "
        f"Based on available market data, would you be open to discussing a price closer to "
        f"SAR {neg.discussion_range_low:,.0f} - SAR {neg.discussion_range_high:,.0f}? "
        "I'd appreciate hearing your thoughts."
    )


def summarize_property_intelligence(
    intelligence: PropertyIntelligenceOut,
    *,
    language: str,
    variant: Variant = "summary",
    user_id: int | None = None,
    negotiation: PropertyNegotiation | None = None,
    offer_history: list[NegotiationOffer] | None = None,
) -> tuple[str, str]:
    """Returns (text, generated_by).

    `negotiation`/`offer_history` (Prompt 6, keyword-only, optional,
    `variant="negotiation_message"` only): when supplied, grounds the draft
    in an IN-PROGRESS negotiation's actual numbers instead of the generic
    pre-negotiation discussion range — see
    `_grounded_negotiation_facts_block`'s docstring. Ignored entirely for
    `variant="summary"` and when `negotiation` is `None` (the pre-existing
    no-negotiation call path, unchanged)."""
    is_negotiation = variant == "negotiation_message"
    prompt = PROPERTY_NEGOTIATION_MESSAGE if is_negotiation else PROPERTY_INTELLIGENCE_SUMMARY
    feature = "property_negotiation_message" if is_negotiation else "property_intelligence_summary"

    grounded_in_negotiation = is_negotiation and negotiation is not None
    if grounded_in_negotiation:
        facts = _grounded_negotiation_facts_block(intelligence, negotiation, offer_history or [])
    elif is_negotiation:
        facts = _negotiation_facts_block(intelligence)
    else:
        facts = _facts_block(intelligence)

    if facts is None:
        # No negotiation_intelligence to ground a draft in — never fabricate one.
        return _deterministic_summary(intelligence, language), "fallback"

    def _fallback_text() -> str:
        if grounded_in_negotiation:
            return _deterministic_negotiation_message_grounded(negotiation, offer_history or [], language)
        if is_negotiation:
            return _deterministic_negotiation_message(intelligence, language)
        return _deterministic_summary(intelligence, language)

    if not settings.ANTHROPIC_API_KEY:
        return _fallback_text(), "fallback"

    language_name = _LANGUAGE_NAMES.get(language, "English")

    status = "error"
    result = None
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=prompt.template,
            tools=[],
            messages=[{
                "role": "user",
                "content": f"Language: {language_name}\n\nFacts:\n{facts}",
            }],
            max_tokens=300,
        )
        status = "ok"
        text = result.reply.strip()[:800]
        if not text:
            raise ValueError("AI returned an empty response")
        return text, "ai"
    except Exception as exc:  # noqa: BLE001 — must degrade to deterministic text, never 500
        logger.warning("summarize_property_intelligence(variant=%s): AI call failed, using deterministic fallback: %s", variant, exc)
        status = "error"
        return _fallback_text(), "fallback"
    finally:
        gateway.log_ai_call(
            feature=feature,
            model=gateway.DEFAULT_MODEL,
            prompt=prompt,
            latency_ms=result.latency_ms if result else 0.0,
            status=status,
            user_id=user_id,
            input_tokens=result.input_tokens if result else None,
            output_tokens=result.output_tokens if result else None,
        )
