"""AI Trust Summary (Prompt 5 — Property Verification & Trust Center, spec
section 18) — service-level grounding/fallback tests for
`app.services.trust_ai_summary.summarize_trust_assessment`, plus HTTP-level
tests for `GET /properties/{id}/trust-summary` (fallback shape, 404) and the
no-blocking contract with `GET /properties/{id}/trust`.
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User
from app.services import trust_ai_summary
from app.services.mediator_trust import MediatorTrustResult
from app.services.review_summary import ReviewSummaryResult
from app.services.trust_assessment import assess_property_trust

NOW = datetime(2026, 8, 17, 12, 0, 0, tzinfo=timezone.utc)


def _property(**overrides) -> Property:
    defaults = dict(
        title="Sunny 3BR Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        monthly_rent=6000.0, bedrooms=3, bathrooms=2, size_sq_m=150, property_type="Apartment",
        furnished="Furnished", description="A lovely apartment near the park.",
        contact_phone="0500000000", created_at=NOW - timedelta(days=5), updated_at=NOW - timedelta(days=2),
    )
    defaults.update(overrides)
    return Property(**defaults)


def _assessment(prop: Property, **kwargs):
    return assess_property_trust(prop, now=NOW, **kwargs)


def _mediator_trust(**overrides) -> MediatorTrustResult:
    defaults = dict(score=90, is_verified=True, review_count=12, avg_rating=4.8, listing_count=6, reason="Verified by myMakan; 4.8★ average from 12 reviews; 6 listings on myMakan.")
    defaults.update(overrides)
    return MediatorTrustResult(**defaults)


def _review_summary(**overrides) -> ReviewSummaryResult:
    defaults = dict(avg_rating=4.8, review_count=12, positive_themes=["Responsive communication"], considerations=[], generated_by="ai")
    defaults.update(overrides)
    return ReviewSummaryResult(**defaults)


# ── Fallback ─────────────────────────────────────────────────────────────────

def test_fallback_when_no_api_key(monkeypatch):
    called = {"run_chat": False}

    def _should_not_be_called(**kwargs):
        called["run_chat"] = True
        raise AssertionError("run_chat should not be called with no API key")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    prop = _property()
    assessment = _assessment(prop)
    result = trust_ai_summary.summarize_trust_assessment(assessment, prop, None, None)

    assert result.generated_by == "fallback"
    assert not called["run_chat"]
    assert str(assessment.overall_score) in result.summary
    assert assessment.trust_level.lower() in result.summary.lower()
    assert result.summary  # a real, non-empty explanation — never an error state


def test_fallback_when_gateway_raises(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _raise)

    prop = _property()
    assessment = _assessment(prop)
    result = trust_ai_summary.summarize_trust_assessment(assessment, prop, _mediator_trust(), _review_summary())

    assert result.generated_by == "fallback"
    assert result.summary


def test_fallback_when_reply_is_empty(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="   ", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    assessment = _assessment(prop)
    result = trust_ai_summary.summarize_trust_assessment(assessment, prop, None, None)

    assert result.generated_by == "fallback"
    assert result.summary


def test_fallback_summary_reflects_things_to_verify_for_weak_listing(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)

    weak = Property(title="", area="", city="Riyadh", listing_type="rent", created_at=NOW - timedelta(days=500))
    assessment = _assessment(weak)
    result = trust_ai_summary.summarize_trust_assessment(assessment, weak, None, None)

    assert result.generated_by == "fallback"
    assert assessment.trust_level == "Limited Confidence"
    # The fallback must never accuse anyone of fraud/scam even for a weak score.
    assert "fraud" not in result.summary.lower()
    assert "scam" not in result.summary.lower()
    assert "illegal" not in result.summary.lower()


# ── Success path ─────────────────────────────────────────────────────────────

def test_ai_summary_used_when_call_succeeds(monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(
            reply="This listing has a high trust score, backed by a verified, well-reviewed mediator.",
            input_tokens=20, output_tokens=20,
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    prop.mediator = Mediator(user_id=1, license_number="LIC-1", phone="0500000000", is_verified=True)
    assessment = _assessment(prop, review_count=12, avg_rating=4.8, mediator_listing_count=6)
    result = trust_ai_summary.summarize_trust_assessment(
        assessment, prop, _mediator_trust(), _review_summary(), language="en"
    )

    assert result.generated_by == "ai"
    assert "high trust score" in result.summary.lower()


# ── Grounding ────────────────────────────────────────────────────────────────

def test_grounding_prompt_only_contains_the_four_permitted_sources(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="A grounded explanation.", input_tokens=10, output_tokens=10)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property(title="Grounding Test Villa", area="Al Narjis", city="Jeddah", monthly_rent=99999.0)
    assessment = _assessment(prop)
    mediator_trust = _mediator_trust(review_count=7, avg_rating=4.2, listing_count=3)
    review_summary = _review_summary(review_count=7, avg_rating=4.2, positive_themes=["Accurate listing photos"], considerations=["Slow to reply on weekends"])

    trust_ai_summary.summarize_trust_assessment(assessment, prop, mediator_trust, review_summary, language="en")
    content = captured["content"]

    # Source 1 — TrustAssessment: score/level and its own signal text.
    assert str(assessment.overall_score) in content
    assert assessment.trust_level in content
    for signal in assessment.positive_signals:
        assert signal in content

    # Source 2 — property identity facts only.
    assert "Grounding Test Villa" in content
    assert "Al Narjis" in content
    assert "Jeddah" in content
    # Price is deliberately excluded from property facts (trust != value).
    assert "99999" not in content and "99,999" not in content

    # Source 3 — mediator trust facts.
    assert "4.2" in content
    assert "7" in content

    # Source 4 — review summary.
    assert "Accurate listing photos" in content
    assert "Slow to reply on weekends" in content

    # Nothing outside the four sources: no disallowed verification phrase,
    # no fabricated topic.
    assert "government" not in content.lower()
    assert "rega" not in content.lower()
    assert "nafath" not in content.lower()
    assert "ejar" not in content.lower()


def test_grounding_no_mediator_and_no_reviews_still_produces_valid_facts(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="A grounded explanation.", input_tokens=10, output_tokens=10)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    assessment = _assessment(prop)
    trust_ai_summary.summarize_trust_assessment(assessment, prop, None, None, language="en")

    content = captured["content"]
    assert "No mediator is on record" in content
    assert "No customer reviews yet" in content


def test_arabic_language_passed_through(monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="شرح موجز وموثوق.", input_tokens=10, output_tokens=10)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    assessment = _assessment(prop)
    result = trust_ai_summary.summarize_trust_assessment(assessment, prop, None, None, language="ar")

    assert result.generated_by == "ai"
    assert "Language: Arabic" in captured["content"]


# ── HTTP endpoint ────────────────────────────────────────────────────────────

def _city() -> str:
    return f"TrustSummaryCity-{uuid.uuid4().hex[:8]}"


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Trust Summary Test Property", area="Test District", city="TrustSummaryCity", listing_type="rent",
        status="Published", bedrooms=3, bathrooms=2, size_sq_m=150, property_type="Apartment",
        furnished="Furnished", monthly_rent=6000.0, description="A lovely test apartment.",
        contact_phone="0500000000",
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    db.commit()
    return prop


def _make_mediator(db, **overrides) -> Mediator:
    user = User(email=f"trust-summary-med-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    db.add(user)
    db.flush()
    defaults = dict(user_id=user.id, license_number="LIC-TS", phone="0500000001", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    db.commit()
    return mediator


def test_trust_summary_endpoint_fallback_shape_no_mediator(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", None)
    city = _city()
    subject = _make_property(db_session, city=city)

    resp = client.get(f"/api/v1/properties/{subject.id}/trust-summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["property_id"] == subject.id
    assert body["generated_by"] == "fallback"
    assert body["summary"]
    # Never a disallowed verification phrase, even in the fallback text.
    assert "Government Verified" not in body["summary"]
    assert "REGA" not in body["summary"]


def test_trust_summary_endpoint_404_for_unknown_property(client):
    resp = client.get("/api/v1/properties/9999999/trust-summary")
    assert resp.status_code == 404


def test_trust_summary_endpoint_ai_path_with_mediator_and_reviews(client, db_session, monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="This is a trustworthy, well-reviewed listing.", input_tokens=10, output_tokens=10)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    from app.models.review import Review

    city = _city()
    mediator = _make_mediator(db_session)
    subject = _make_property(db_session, city=city, mediator_id=mediator.id)
    for i in range(6):
        reviewer = User(email=f"ts-reviewer-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
        db_session.add(reviewer)
        db_session.flush()
        db_session.add(Review(mediator_id=mediator.id, user_id=reviewer.id, rating=5, comment="Great experience, very responsive.", status="approved"))
    db_session.commit()

    resp = client.get(f"/api/v1/properties/{subject.id}/trust-summary")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "ai"
    assert body["summary"] == "This is a trustworthy, well-reviewed listing."


# ── No-blocking contract ─────────────────────────────────────────────────────

def test_trust_endpoint_never_calls_the_ai_gateway(client, db_session, monkeypatch):
    """GET /trust (the deterministic endpoint Property Detail renders
    instantly from) must never invoke the AI gateway — the AI Trust Summary
    only runs on its own separate GET /trust-summary call, so the fast path
    stays fast and is never coupled to AI latency/failures."""
    called = {"run_chat": False}

    def _should_not_be_called(**kwargs):
        called["run_chat"] = True
        raise AssertionError("GET /trust must never call the AI gateway")

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _should_not_be_called)

    city = _city()
    subject = _make_property(db_session, city=city)

    resp = client.get(f"/api/v1/properties/{subject.id}/trust")
    assert resp.status_code == 200, resp.text
    assert not called["run_chat"]


def test_summarize_trust_assessment_independently_callable_without_http_layer(monkeypatch):
    """The service function itself is a standalone, separately
    callable/awaitable unit — no dependency on the /trust route or any
    request/response object, only plain Python values."""
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="Standalone call works.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    prop = _property()
    assessment = _assessment(prop)
    result = trust_ai_summary.summarize_trust_assessment(assessment, prop, None, None)
    assert result.generated_by == "ai"
    assert result.summary == "Standalone call works."
