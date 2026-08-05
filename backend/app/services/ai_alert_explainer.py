"""AI-enhanced alert explanations (Phase 12).

The core alert (match → notification → delivery) is fully deterministic and
never waits on an LLM — `rule_based_explanation()` runs synchronously,
in-process, and is what actually ships in the notification body via
app.core.notification_templates. This module's async piece,
`enrich_notification_with_ai()`, is a pure enhancement: it runs afterward on
the `ai` Celery queue, and on any failure (rate limit, no API key, timeout)
the notification simply keeps its rule-based text — nothing about delivery
depends on it succeeding.
"""
import logging
import time

from sqlalchemy.orm import Session

from app.core.ai import gateway
from app.core.ai.prompts import PromptDefinition
from app.core.config import settings
from app.models.notification import Notification
from app.models.property import Property
from app.models.saved_search import SavedSearch

logger = logging.getLogger("app.services.ai_alert_explainer")

_ALERT_EXPLAINER_PROMPT = PromptDefinition(
    name="alert_explainer",
    version=1,
    template=(
        "You write ONE short, factual sentence (max 22 words) explaining why a property alert "
        "is relevant to a Saudi rental-platform user, based only on the structured facts given. "
        "No greetings, no markdown, no emoji. Reply in the requested language only."
    ),
)

# Only enrich change types where a short qualitative explanation adds real
# value beyond the deterministic reason codes — keeps AI spend bounded.
_ENRICHABLE_CHANGE_TYPES = {"new_listing", "price_drop", "back_on_market"}


def rule_based_explanation(*, match_reasons: list[dict], locale: str) -> str:
    """Deterministic, zero-latency, zero-cost explanation built straight from
    match reason codes — always available, always ships with the alert."""
    codes = [r.get("code") for r in match_reasons]
    count = len([c for c in codes if c not in ("matches_search",)])
    if locale == "ar":
        return f"يطابق هذا العقار {count} من معايير بحثك." if count else "يطابق هذا العقار بحثك المحفوظ."
    return f"This property matches {count} of your saved search criteria." if count else "This property matches your saved search."


def should_enrich(change_type: str) -> bool:
    return settings.FEATURE_AI_ALERT_EXPLANATIONS and bool(settings.ANTHROPIC_API_KEY) and change_type in _ENRICHABLE_CHANGE_TYPES


def enrich_notification_with_ai(db: Session, notification: Notification) -> None:
    """Best-effort. Never raises — a Celery task calling this can safely
    treat any exception as "skip enrichment for this one notification"."""
    if not should_enrich(notification.type.replace("saved_search_", "") if notification.type else ""):
        return

    prop = db.get(Property, notification.property_id) if notification.property_id else None
    saved_search = db.get(SavedSearch, notification.saved_search_id) if notification.saved_search_id else None
    if prop is None or saved_search is None:
        return

    locale = notification.locale if notification.locale in ("en", "ar") else "en"
    facts = (
        f"district={prop.area}, city={prop.city}, price={prop.monthly_rent or prop.sale_price}, "
        f"bedrooms={prop.bedrooms}, reasons={[r.get('code') for r in (notification.match_reasons or [])]}, "
        f"saved_search_name={saved_search.name}"
    )
    lang_instruction = "Reply in Arabic." if locale == "ar" else "Reply in English."

    started = time.monotonic()
    status = "ok"
    try:
        result = gateway.run_chat(
            model=gateway.DEFAULT_MODEL,
            system=_ALERT_EXPLAINER_PROMPT.template,
            tools=[],
            messages=[{"role": "user", "content": f"{lang_instruction}\nFacts: {facts}"}],
            max_tokens=80,
        )
        explanation = result.reply.strip().strip('"')
        if explanation:
            notification.meta = {**(notification.meta or {}), "ai_explanation": explanation, "ai_prompt_version": _ALERT_EXPLAINER_PROMPT.version}
            notification.ai_generated = True
        gateway.log_ai_call(
            feature="alert_explainer",
            model=gateway.DEFAULT_MODEL,
            prompt=_ALERT_EXPLAINER_PROMPT,
            latency_ms=(time.monotonic() - started) * 1000,
            status=status,
            user_id=notification.user_id,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
        )
    except Exception as exc:  # noqa: BLE001 — enrichment is strictly best-effort
        status = "error"
        logger.warning("enrich_notification_with_ai(%s): failed, keeping rule-based text: %s", notification.id, exc)
