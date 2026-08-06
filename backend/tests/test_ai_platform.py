"""AI platform foundation tests: prompt registry, model gateway (token/cost
extraction, graceful degradation when usage is missing), and AI call
logging. No real Anthropic API calls are made — the client is mocked.
"""
from dataclasses import dataclass

import pytest

from app.core.ai import gateway
from app.core.ai.prompts import ADMIN_ADVISOR, CUSTOMER_ADVISOR, get_prompt
from app.models.ai_call_log import AICallLog


# ── Prompt registry ──────────────────────────────────────────────────────

def test_get_prompt_returns_registered_definition():
    prompt = get_prompt("customer_advisor")
    assert prompt is CUSTOMER_ADVISOR
    assert prompt.version == 1
    assert "Maskan AI" in prompt.template


def test_get_prompt_unknown_name_raises():
    with pytest.raises(KeyError):
        get_prompt("nonexistent_prompt")


def test_customer_and_admin_prompts_are_distinct():
    assert CUSTOMER_ADVISOR.name != ADMIN_ADVISOR.name
    assert CUSTOMER_ADVISOR.template != ADMIN_ADVISOR.template


# ── Cost estimation ──────────────────────────────────────────────────────

def test_estimate_cost_known_model():
    cost = gateway.estimate_cost_usd("claude-sonnet-4-6", input_tokens=1_000_000, output_tokens=1_000_000)
    assert cost == pytest.approx(3.0 + 15.0)


def test_estimate_cost_unknown_model_returns_none():
    assert gateway.estimate_cost_usd("some-future-model", input_tokens=100, output_tokens=100) is None


def test_estimate_cost_missing_token_counts_returns_none():
    assert gateway.estimate_cost_usd("claude-sonnet-4-6", input_tokens=None, output_tokens=100) is None


# ── run_chat() against a mocked Anthropic client ─────────────────────────

@dataclass
class _FakeTextBlock:
    type: str
    text: str


@dataclass
class _FakeUsage:
    input_tokens: int
    output_tokens: int


@dataclass
class _FakeMessage:
    content: list
    usage: object = None


class _FakeToolRunner:
    def __init__(self, final_message):
        self._final_message = final_message

    def __iter__(self):
        yield self._final_message


def test_run_chat_extracts_reply_and_usage(monkeypatch):
    final = _FakeMessage(content=[_FakeTextBlock(type="text", text="Hello there")], usage=_FakeUsage(input_tokens=50, output_tokens=20))

    class _FakeClient:
        class beta:
            class messages:
                @staticmethod
                def tool_runner(**kwargs):
                    return _FakeToolRunner(final)

    monkeypatch.setattr(gateway, "get_client", lambda: _FakeClient())

    result = gateway.run_chat(model="claude-sonnet-4-6", system="sys", tools=[], messages=[{"role": "user", "content": "hi"}])
    assert result.reply == "Hello there"
    assert result.input_tokens == 50
    assert result.output_tokens == 20
    assert result.latency_ms >= 0


def test_run_chat_degrades_gracefully_when_usage_missing(monkeypatch):
    final = _FakeMessage(content=[_FakeTextBlock(type="text", text="Hi")], usage=None)

    class _FakeClient:
        class beta:
            class messages:
                @staticmethod
                def tool_runner(**kwargs):
                    return _FakeToolRunner(final)

    monkeypatch.setattr(gateway, "get_client", lambda: _FakeClient())

    result = gateway.run_chat(model="claude-sonnet-4-6", system="sys", tools=[], messages=[])
    assert result.reply == "Hi"
    assert result.input_tokens is None
    assert result.output_tokens is None


def test_run_chat_raises_when_no_message_produced(monkeypatch):
    class _EmptyRunner:
        def __iter__(self):
            return iter([])

    class _FakeClient:
        class beta:
            class messages:
                @staticmethod
                def tool_runner(**kwargs):
                    return _EmptyRunner()

    monkeypatch.setattr(gateway, "get_client", lambda: _FakeClient())

    with pytest.raises(RuntimeError):
        gateway.run_chat(model="claude-sonnet-4-6", system="sys", tools=[], messages=[])


# ── AI call logging ──────────────────────────────────────────────────────

def test_log_ai_call_writes_row_without_prompt_text(db_session, monkeypatch):
    monkeypatch.setattr("app.core.ai.gateway.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    gateway.log_ai_call(
        feature="customer_chat",
        model="claude-sonnet-4-6",
        prompt=CUSTOMER_ADVISOR,
        latency_ms=123.4,
        status="ok",
        input_tokens=100,
        output_tokens=50,
    )

    row = db_session.query(AICallLog).filter(AICallLog.feature == "customer_chat").one()
    assert row.model == "claude-sonnet-4-6"
    assert row.prompt_name == "customer_advisor"
    assert row.prompt_version == 1
    assert row.status == "ok"
    assert row.cost_estimate_usd == pytest.approx(gateway.estimate_cost_usd("claude-sonnet-4-6", 100, 50))
    # No raw prompt or response text anywhere on the row.
    assert not hasattr(row, "prompt_text")
    assert not hasattr(row, "response_text")


def test_log_ai_call_never_raises_on_db_error(monkeypatch):
    class _BrokenSession:
        def add(self, *a, **k):
            raise RuntimeError("simulated DB outage")

        def commit(self):
            pass

        def close(self):
            pass

    monkeypatch.setattr("app.core.ai.gateway.SessionLocal", lambda: _BrokenSession())

    gateway.log_ai_call(feature="x", model="claude-sonnet-4-6", prompt=CUSTOMER_ADVISOR, latency_ms=1.0, status="ok")


# ── End-to-end: the real /api/ai/chat endpoint logs a call ──────────────

def test_customer_chat_endpoint_logs_ai_call(client, db_session, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    monkeypatch.setattr("app.core.ai.gateway.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    fake_result = gateway.ChatResult(reply="Sure, here are some listings.", input_tokens=42, output_tokens=17, latency_ms=250.0)
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: fake_result)

    resp = client.post("/api/ai/chat", json={"message": "Show me apartments in Riyadh"})
    assert resp.status_code == 200
    assert resp.json()["reply"] == "Sure, here are some listings."

    row = db_session.query(AICallLog).filter(AICallLog.feature == "customer_chat").one()
    assert row.status == "ok"
    assert row.input_tokens == 42
    assert row.prompt_name == "customer_advisor"


# ── AI dynamic pricing suggestion (short-term booking nightly rate) ──────

def _signup(client, email) -> str:
    resp = client.post("/api/auth/signup", json={"email": email, "password": "S3cret!23"})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_pricing_suggestion_requires_auth(client):
    resp = client.post("/api/ai/pricing-suggestion", json={"area": "Al Yasmin", "city": "Riyadh", "monthly_rent": 6000})
    assert resp.status_code == 401


def test_pricing_suggestion_fallback_without_api_key(client, unique_email, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "")
    token = _signup(client, unique_email)

    resp = client.post(
        "/api/ai/pricing-suggestion",
        json={"area": "Al Yasmin", "city": "Riyadh", "monthly_rent": 6000},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "fallback"
    assert 0 < body["suggested_nightly_min"] < body["suggested_nightly_max"]
    assert body["reasoning"]


def test_pricing_suggestion_uses_ai_when_available(client, unique_email, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    fake_result = gateway.ChatResult(
        reply='{"suggested_nightly_min": 250, "suggested_nightly_max": 400, "reasoning": "Winter season premium over long-term baseline."}',
        input_tokens=30, output_tokens=25, latency_ms=100.0,
    )
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: fake_result)
    token = _signup(client, unique_email)

    resp = client.post(
        "/api/ai/pricing-suggestion",
        json={"area": "Al Yasmin", "city": "Riyadh", "monthly_rent": 6000},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "ai"
    assert body["suggested_nightly_min"] == 250
    assert body["suggested_nightly_max"] == 400


def test_pricing_suggestion_falls_back_on_malformed_ai_response(client, unique_email, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    fake_result = gateway.ChatResult(reply="not json at all", input_tokens=10, output_tokens=5, latency_ms=50.0)
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: fake_result)
    token = _signup(client, unique_email)

    resp = client.post(
        "/api/ai/pricing-suggestion",
        json={"area": "Al Yasmin", "city": "Riyadh", "monthly_rent": 6000},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["generated_by"] == "fallback"


# ── AI rental score (property detail page "Rental Score" badge) ─────────

def test_rental_score_no_auth_required(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "")
    resp = client.post(
        "/api/ai/rental-score",
        json={"listing_type": "rent", "monthly_rent": 6000, "bedrooms": 2, "area": "Al Yasmin", "city": "Riyadh"},
    )
    assert resp.status_code == 200, resp.text


def test_rental_score_fallback_without_api_key(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "")
    resp = client.post(
        "/api/ai/rental-score",
        json={"listing_type": "rent", "monthly_rent": 6000, "bedrooms": 2, "area": "Al Yasmin", "city": "Riyadh"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "fallback"
    assert 0 <= body["score"] <= 100
    assert body["reasoning"]


def test_rental_score_sale_listing_fallback_ignores_rent_average(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "")
    resp = client.post(
        "/api/ai/rental-score",
        json={"listing_type": "sale", "sale_price": 900000, "bedrooms": 4, "area": "Al Yasmin", "city": "Riyadh"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "fallback"
    assert body["district_avg_monthly_rent"] is None
    assert body["score"] == 90  # 82 + 4*2, clamped


def test_rental_score_uses_ai_when_available(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    fake_result = gateway.ChatResult(
        reply='{"score": 88, "reasoning": "Rent is below the district average and area quality is strong."}',
        input_tokens=30, output_tokens=20, latency_ms=90.0,
    )
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: fake_result)

    resp = client.post(
        "/api/ai/rental-score",
        json={"listing_type": "rent", "monthly_rent": 6000, "bedrooms": 2, "area": "Al Yasmin", "city": "Riyadh"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "ai"
    assert body["score"] == 88
    assert body["reasoning"]


def test_rental_score_falls_back_on_malformed_ai_response(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    fake_result = gateway.ChatResult(reply="not json at all", input_tokens=10, output_tokens=5, latency_ms=50.0)
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: fake_result)

    resp = client.post(
        "/api/ai/rental-score",
        json={"listing_type": "rent", "monthly_rent": 6000, "bedrooms": 2, "area": "Al Yasmin", "city": "Riyadh"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["generated_by"] == "fallback"


def test_rental_score_falls_back_on_out_of_range_ai_score(client, monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    fake_result = gateway.ChatResult(
        reply='{"score": 140, "reasoning": "Implausibly high."}', input_tokens=10, output_tokens=5, latency_ms=50.0,
    )
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: fake_result)

    resp = client.post(
        "/api/ai/rental-score",
        json={"listing_type": "rent", "monthly_rent": 6000, "bedrooms": 2, "area": "Al Yasmin", "city": "Riyadh"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["generated_by"] == "fallback"
