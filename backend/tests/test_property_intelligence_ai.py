"""Property Intelligence AI Summary: grounding (facts passed to the model
match the intelligence payload — no fabricated content reaches the prompt),
fallback on AI failure / no API key, and Arabic output. Documents the known
limitation noted in `property_intelligence_ai.py` and the tracking doc: the
AI's free-form reply is trusted as-is once returned, same trust level
`home_finder_ai.explain_match` already operates at.
"""
from app.core.ai import gateway
from app.core.config import settings
from app.schemas.property_intelligence import (
    ComparableSummaryOut,
    DataConfidenceOut,
    NegotiationInsightOut,
    PriceIntelligenceOut,
    PropertyIntelligenceOut,
)
from app.services import property_intelligence_ai


def _intelligence(**overrides) -> PropertyIntelligenceOut:
    defaults = dict(
        decision_score=78,
        component_scores={},
        data_confidence=DataConfidenceOut(level="High", reason="High confidence — specs, images on file."),
        price_intelligence=PriceIntelligenceOut(type="rent", sufficient_data=True, classification="Good Value"),
        comparable_summary=ComparableSummaryOut(count=3),
        strengths=["Priced as Good Value against 5 comparable listings", "Listed by a verified mediator"],
        considerations=["No listing photos available yet"],
    )
    defaults.update(overrides)
    return PropertyIntelligenceOut(**defaults)


def test_grounding_facts_passed_to_ai_match_payload(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="This property looks like solid value.", input_tokens=10, output_tokens=10)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    intel = _intelligence()
    summary, generated_by = property_intelligence_ai.summarize_property_intelligence(intel, language="en")

    assert generated_by == "ai"
    assert summary == "This property looks like solid value."
    assert "78/100" in captured["content"]
    assert "Good Value" in captured["content"]
    assert "Priced as Good Value against 5 comparable listings" in captured["content"]
    assert "No listing photos available yet" in captured["content"]
    # Nothing outside the deterministic payload leaks in as a fabricated fact.
    assert "95" not in captured["content"]


def test_fallback_when_no_api_key(monkeypatch):
    called = {"run_chat": False}

    def _should_not_be_called(**kwargs):
        called["run_chat"] = True
        raise AssertionError("run_chat should not be called when no API key is set")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    intel = _intelligence()
    summary, generated_by = property_intelligence_ai.summarize_property_intelligence(intel, language="en")

    assert generated_by == "fallback"
    assert not called["run_chat"]
    assert "78" in summary


def test_fallback_when_ai_call_fails(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _raise)

    intel = _intelligence()
    summary, generated_by = property_intelligence_ai.summarize_property_intelligence(intel, language="en")

    assert generated_by == "fallback"
    assert isinstance(summary, str) and summary


def test_arabic_output_requested_and_returned(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="هذا العقار يمثل قيمة جيدة.", input_tokens=10, output_tokens=10)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    intel = _intelligence()
    summary, generated_by = property_intelligence_ai.summarize_property_intelligence(intel, language="ar")

    assert generated_by == "ai"
    assert summary == "هذا العقار يمثل قيمة جيدة."
    assert "Arabic" in captured["content"]


def test_arabic_fallback_returns_arabic_text(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    intel = _intelligence()
    summary, generated_by = property_intelligence_ai.summarize_property_intelligence(intel, language="ar")
    assert generated_by == "fallback"
    assert "من 100" in summary


def test_known_limitation_ai_reply_trusted_as_is(monkeypatch):
    """Documents that a fabricated number in the AI's free-form reply is NOT
    stripped/validated — same trust level as home_finder_ai.explain_match's
    narration. A real numeric-hallucination guard is out of this prompt's
    scope (see property_intelligence_ai.py's module docstring and the
    tracking doc's AI usage section)."""
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="This property is worth SAR 999,999,999 — a steal!", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    intel = _intelligence()
    summary, generated_by = property_intelligence_ai.summarize_property_intelligence(intel, language="en")
    assert generated_by == "ai"
    assert "999,999,999" in summary  # not filtered — documents the known limitation


# ── Negotiation-message variant (Prompt 9) ──────────────────────────────────


def _intelligence_with_negotiation(**overrides) -> PropertyIntelligenceOut:
    neg = NegotiationInsightOut(
        asking_price=11_000, market_midpoint=10_000, discussion_range_low=10_000,
        discussion_range_high=10_670, approach="Consider opening near the market midpoint.",
    )
    return _intelligence(negotiation_intelligence=neg, **overrides)


def test_negotiation_variant_grounds_facts_in_negotiation_data_only(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="Hi, would you consider SAR 10,000-10,670?", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    intel = _intelligence_with_negotiation()
    text, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intel, language="en", variant="negotiation_message"
    )
    assert generated_by == "ai"
    assert "11,000" in captured["content"]
    assert "10,000" in captured["content"]
    # The general summary facts (strengths/considerations) must NOT leak into
    # a negotiation-message prompt — it's grounded in negotiation data only.
    assert "verified mediator" not in captured["content"]


def test_negotiation_variant_without_negotiation_data_falls_back_to_summary(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    intel = _intelligence()  # no negotiation_intelligence
    text, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intel, language="en", variant="negotiation_message"
    )
    assert generated_by == "fallback"
    assert "78" in text


def test_negotiation_variant_deterministic_fallback_no_api_key(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    intel = _intelligence_with_negotiation()
    text, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intel, language="en", variant="negotiation_message"
    )
    assert generated_by == "fallback"
    assert "11,000" in text
