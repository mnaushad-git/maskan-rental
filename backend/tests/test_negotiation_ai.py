"""AI Negotiation & Offer Management — AI guidance ("Ask myMakan") +
deterministic summary ("myMakan Summary") (Prompt 5). See
docs/implementation/mymakan-negotiations.md "AI behavior" for the
AI-vs-deterministic split this documents.

Service-level tests build `PropertyNegotiation`/`NegotiationOffer`/
`RentPriceIntelligence`/`NegotiationInsight` objects directly (no DB
required) — same style as test_property_intelligence_ai.py. A small
HTTP-level section at the bottom verifies the route/schema wiring
end-to-end.
"""
import uuid
from decimal import Decimal

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_negotiation import NegotiationOffer, PropertyNegotiation
from app.models.user import User
from app.schemas.property_intelligence import (
    ComparableSummaryOut,
    DataConfidenceOut,
    NegotiationInsightOut,
    PriceIntelligenceOut,
    PropertyIntelligenceOut,
)
from app.services import negotiation_ai, property_intelligence_ai
from app.services.negotiation_intelligence import NegotiationInsight
from app.services.price_intelligence import RentPriceIntelligence

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_NEGOTIATIONS,
    reason="negotiations.router isn't registered when FEATURE_NEGOTIATIONS is off",
)


def _negotiation(**overrides) -> PropertyNegotiation:
    defaults = dict(
        id=1,
        property_id=1,
        customer_user_id=10,
        mediator_id=20,
        transaction_type="rent",
        status="countered",
        current_offer_amount=Decimal("9200"),
        original_listing_amount=Decimal("10000"),
    )
    defaults.update(overrides)
    return PropertyNegotiation(**defaults)


def _offers() -> list[NegotiationOffer]:
    return [
        NegotiationOffer(id=1, negotiation_id=1, offered_by_user_id=10, amount=Decimal("8500"), offer_type="customer_offer", status="superseded"),
        NegotiationOffer(id=2, negotiation_id=1, offered_by_user_id=21, amount=Decimal("9500"), offer_type="mediator_counter", status="superseded"),
        NegotiationOffer(id=3, negotiation_id=1, offered_by_user_id=10, amount=Decimal("9200"), offer_type="customer_counter", status="pending"),
    ]


def _price_intel(**overrides) -> RentPriceIntelligence:
    defaults = dict(
        sufficient_data=True,
        asking_rent=10_000.0,
        fair_range_low=9_300.0,
        fair_range_high=9_400.0,
        market_midpoint=9_350.0,
        percent_difference=-8.0,
        classification="Good Value",
        comparable_count=5,
    )
    defaults.update(overrides)
    return RentPriceIntelligence(**defaults)


def _insight(**overrides) -> NegotiationInsight:
    defaults = dict(asking_price=10_000.0, market_midpoint=9_350.0, discussion_range_low=9_300.0, discussion_range_high=9_400.0, approach="A modest counter-offer within a few percent may still be worth trying.")
    defaults.update(overrides)
    return NegotiationInsight(**defaults)


# ── generate_guidance: AI grounding ─────────────────────────────────────────


def test_guidance_grounding_facts_match_deterministic_inputs_only(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="Your offer is close to the fair range; consider holding firm.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    negotiation = _negotiation()
    offers = _offers()
    price_intel = _price_intel()
    insight = _insight()

    guidance, generated_by = negotiation_ai.generate_guidance(
        negotiation, offers, price_intel, insight, "en", question="Is my offer reasonable?", user_id=None
    )

    assert generated_by == "ai"
    assert guidance == "Your offer is close to the fair range; consider holding firm."
    content = captured["content"]
    # Real facts reach the prompt.
    assert "10,000" in content  # asking price
    assert "9,200" in content  # current offer amount
    assert "9,350" in content  # market midpoint
    assert "9,300" in content and "9,400" in content  # discussion range
    assert "8,500" in content  # offer history entry
    assert "9,500" in content  # offer history entry
    assert "Is my offer reasonable?" in content
    assert "<customer_question>" in content
    # No fabricated comparable/number leaks in from nowhere.
    assert "999,999" not in content


def test_guidance_grounding_omits_market_data_when_insufficient(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="Not enough market data to say more than the offer history shows.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    negotiation = _negotiation()
    price_intel = RentPriceIntelligence(sufficient_data=False, asking_rent=10_000.0, comparable_count=1)

    negotiation_ai.generate_guidance(negotiation, _offers(), price_intel, None, "en")

    content = captured["content"]
    assert "insufficient" in content.lower()
    assert "limited_comparable_data" in content


# ── generate_guidance: AI failure falls back to deterministic guidance ─────


def test_guidance_ai_failure_falls_back_to_deterministic(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(gateway, "run_chat", _raise)

    negotiation = _negotiation()
    guidance, generated_by = negotiation_ai.generate_guidance(negotiation, _offers(), _price_intel(), _insight(), "en")

    assert generated_by == "fallback"
    assert guidance  # never empty — must not block the caller
    assert "9,200" in guidance  # current offer
    assert "10,000" in guidance  # asking price


def test_guidance_never_raises_on_ai_failure(monkeypatch):
    def _raise(**kwargs):
        raise ValueError("boom")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    # Should not raise even with no price intelligence / insight at all.
    guidance, generated_by = negotiation_ai.generate_guidance(_negotiation(), [], None, None, "en")
    assert generated_by == "fallback"
    assert guidance


# ── generate_guidance: Arabic ───────────────────────────────────────────────


def test_guidance_arabic_requested_and_returned(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="عرضك قريب من النطاق العادل للسوق.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    guidance, generated_by = negotiation_ai.generate_guidance(
        _negotiation(), _offers(), _price_intel(), _insight(), "ar", question="هل عرضي معقول؟"
    )

    assert generated_by == "ai"
    assert guidance == "عرضك قريب من النطاق العادل للسوق."
    assert "Arabic" in captured["content"]
    assert "هل عرضي معقول؟" in captured["content"]


def test_guidance_arabic_fallback_returns_arabic_text(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    guidance, generated_by = negotiation_ai.generate_guidance(_negotiation(), _offers(), _price_intel(), _insight(), "ar")
    assert generated_by == "fallback"
    assert "ريال" in guidance


# ── generate_summary: deterministic only, no AI call at all ────────────────


def test_summary_never_calls_ai(monkeypatch):
    def _should_not_be_called(**kwargs):
        raise AssertionError("generate_summary must never call the AI gateway")

    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)
    text = negotiation_ai.generate_summary(_negotiation(), _offers(), _price_intel(), _insight(), "en")
    assert text


def test_summary_is_deterministic_and_stable():
    negotiation = _negotiation()
    offers = _offers()
    price_intel = _price_intel()
    insight = _insight()

    first = negotiation_ai.generate_summary(negotiation, offers, price_intel, insight, "en")
    second = negotiation_ai.generate_summary(negotiation, offers, price_intel, insight, "en")
    assert first == second
    assert "8,500" in first  # started at the first offer amount
    assert "10,000" in first  # asking price
    assert "9,200" in first  # current offer
    assert "9,300" in first and "9,400" in first  # market range


def test_summary_reflects_terminal_status():
    negotiation = _negotiation(status="accepted")
    text = negotiation_ai.generate_summary(negotiation, _offers(), _price_intel(), _insight(), "en")
    assert "accepted" in text.lower()


def test_summary_arabic():
    text = negotiation_ai.generate_summary(_negotiation(), _offers(), _price_intel(), _insight(), "ar")
    assert "ريال" in text


def test_summary_handles_no_market_insight():
    text = negotiation_ai.generate_summary(_negotiation(), _offers(), None, None, "en")
    assert "10,000" in text and "9,200" in text


# ── Message drafting (property_intelligence_ai): negotiation grounding ─────
# Prompt 6 — property_intelligence_ai.summarize_property_intelligence(
# variant="negotiation_message") gains optional negotiation/offer_history
# context so a drafted "Draft Message" references an in-progress
# negotiation's actual numbers rather than always drafting a first-contact
# message. Lives in this file (not test_property_intelligence_ai.py) since
# it's specifically about grounding a draft in THIS feature's negotiation
# data — test_property_intelligence_ai.py keeps covering the pre-existing
# no-negotiation call path.


def _intelligence_with_negotiation_insight(**overrides) -> PropertyIntelligenceOut:
    neg = NegotiationInsightOut(
        asking_price=10_000, market_midpoint=9_350, discussion_range_low=9_300,
        discussion_range_high=9_400, approach="A modest counter-offer within a few percent may still be worth trying.",
    )
    defaults = dict(
        decision_score=70,
        component_scores={},
        data_confidence=DataConfidenceOut(level="High", reason="High confidence."),
        price_intelligence=PriceIntelligenceOut(type="rent", sufficient_data=True, classification="Good Value"),
        comparable_summary=ComparableSummaryOut(count=5),
        strengths=["Priced as Good Value"],
        considerations=[],
        negotiation_intelligence=neg,
    )
    defaults.update(overrides)
    return PropertyIntelligenceOut(**defaults)


def test_draft_message_first_offer_references_real_offer_amount(monkeypatch):
    """Fresh negotiation (only the customer's initial offer on record) — the
    draft is grounded in the actual submitted amount, not a fabricated one,
    and must not reference a mediator counter that doesn't exist yet."""
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="I'd like to offer SAR 8,500...", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    negotiation = _negotiation(status="submitted", current_offer_amount=Decimal("8500"))
    offers = [
        NegotiationOffer(
            id=1, negotiation_id=1, offered_by_user_id=10, amount=Decimal("8500"),
            offer_type="customer_offer", status="pending",
        ),
    ]
    intel = _intelligence_with_negotiation_insight()

    text, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intel, language="en", variant="negotiation_message", negotiation=negotiation, offer_history=offers
    )

    assert generated_by == "ai"
    content = captured["content"]
    assert "8,500" in content  # the real, actual offer amount
    assert "first offer" in content.lower()
    assert "mediator's latest counter" not in content  # none exists yet — not fabricated


def test_draft_message_mid_negotiation_references_mediator_counter(monkeypatch):
    """Mid-negotiation (the mediator has countered) — grounded in the ACTUAL
    counter amount + the customer's own earlier real offer, not a generic
    pre-negotiation discussion-range message."""
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="Following your counter of SAR 70,000...", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    negotiation = _negotiation(
        status="countered", current_offer_amount=Decimal("70000"), original_listing_amount=Decimal("75000")
    )
    offers = [
        NegotiationOffer(
            id=1, negotiation_id=1, offered_by_user_id=10, amount=Decimal("65000"),
            offer_type="customer_offer", status="superseded",
        ),
        NegotiationOffer(
            id=2, negotiation_id=1, offered_by_user_id=21, amount=Decimal("70000"),
            offer_type="mediator_counter", status="pending",
        ),
    ]
    intel = _intelligence_with_negotiation_insight()

    text, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intel, language="en", variant="negotiation_message", negotiation=negotiation, offer_history=offers
    )

    assert generated_by == "ai"
    content = captured["content"]
    assert "70,000" in content  # the mediator's real counter
    assert "65,000" in content  # the customer's earlier real offer, from the history
    assert "reply" in content.lower()
    # The facts block sent to the model must only ever contain real numbers
    # — no fabricated comparable/figure leaks in from nowhere.
    assert "999,999" not in content


def test_draft_message_grounded_fallback_uses_real_numbers_only(monkeypatch):
    """AI unavailable — the deterministic grounded fallback still only ever
    uses real numbers already in the offer history: it proposes the
    transparent midpoint of the customer's own last offer and the
    mediator's counter, never an invented figure."""
    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _raise)

    negotiation = _negotiation(
        status="countered", current_offer_amount=Decimal("70000"), original_listing_amount=Decimal("75000")
    )
    offers = [
        NegotiationOffer(
            id=1, negotiation_id=1, offered_by_user_id=10, amount=Decimal("65000"),
            offer_type="customer_offer", status="superseded",
        ),
        NegotiationOffer(
            id=2, negotiation_id=1, offered_by_user_id=21, amount=Decimal("70000"),
            offer_type="mediator_counter", status="pending",
        ),
    ]
    intel = _intelligence_with_negotiation_insight()

    text, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intel, language="en", variant="negotiation_message", negotiation=negotiation, offer_history=offers
    )

    assert generated_by == "fallback"
    assert "70,000" in text  # the mediator's real counter, referenced
    # (65,000 + 70,000) / 2 == 67,500 — deterministic and traceable, not invented.
    assert "67,500" in text


def test_draft_message_no_negotiation_context_leaves_pre_existing_path_unchanged(monkeypatch):
    """The pre-existing no-negotiation call path (used directly from
    Property Detail before any negotiation exists) must be unaffected by
    this prompt's extension — omitting negotiation/offer_history entirely
    still drafts the original generic pre-negotiation message."""
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="Hi, would you consider SAR 9,300-9,400?", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    intel = _intelligence_with_negotiation_insight()
    text, generated_by = property_intelligence_ai.summarize_property_intelligence(
        intel, language="en", variant="negotiation_message"
    )

    assert generated_by == "ai"
    assert "10,000" in captured["content"]  # asking price, from negotiation_intelligence
    assert "current offer" not in captured["content"].lower()  # no negotiation-specific facts leak in


# ── HTTP wiring: POST /negotiations/{id}/ai-guidance + embedded summary_text ─


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"negotiation-ai-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _make_mediator(db, **overrides) -> tuple[Mediator, User]:
    user = _make_user(db)
    defaults = dict(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000002", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator, user


def _make_property(db, mediator: Mediator | None = None, **overrides) -> Property:
    defaults = dict(title="Negotiation AI Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _create_negotiation(client, prop, customer, amount=3500):
    return client.post(
        f"/api/v1/properties/{prop.id}/negotiations", json={"amount": amount}, headers=_auth(customer)
    )


def test_detail_response_embeds_deterministic_summary_text(client, db_session, monkeypatch):
    def _should_not_be_called(**kwargs):
        raise AssertionError("GET /negotiations/{id} must not call the AI gateway for summary_text")

    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create_negotiation(client, prop, customer, amount=3500)
    assert created.status_code == 201, created.text
    negotiation_id = created.json()["id"]

    resp = client.get(f"/api/v1/negotiations/{negotiation_id}", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["summary_text"]
    assert "3,500" in body["summary_text"] or "3500" in body["summary_text"]


def test_ai_guidance_endpoint_returns_guidance(client, db_session, monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="This offer looks reasonable given the current market data.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create_negotiation(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    resp = client.post(
        f"/api/v1/negotiations/{negotiation_id}/ai-guidance",
        json={"question": "Is my offer reasonable?", "language": "en"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "ai"
    assert body["guidance"] == "This offer looks reasonable given the current market data."


def test_ai_guidance_endpoint_403_for_another_customers_negotiation(client, db_session, monkeypatch):
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: gateway.ChatResult(reply="x"))

    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    other_customer = _make_user(db_session)
    db_session.commit()

    created = _create_negotiation(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    resp = client.post(
        f"/api/v1/negotiations/{negotiation_id}/ai-guidance",
        json={"language": "en"},
        headers=_auth(other_customer),
    )
    assert resp.status_code == 403


def test_ai_guidance_endpoint_falls_back_on_ai_failure(client, db_session, monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI down")

    monkeypatch.setattr(gateway, "run_chat", _raise)

    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create_negotiation(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    resp = client.post(
        f"/api/v1/negotiations/{negotiation_id}/ai-guidance",
        json={"language": "en"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "fallback"
    assert body["guidance"]


def test_ai_guidance_endpoint_rejects_unknown_language(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create_negotiation(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    resp = client.post(
        f"/api/v1/negotiations/{negotiation_id}/ai-guidance",
        json={"language": "fr"},
        headers=_auth(customer),
    )
    assert resp.status_code == 422
