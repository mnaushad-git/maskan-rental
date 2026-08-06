"""Rent financing interest-capture waitlist: submission stores the request
plus an AI Affordability Advisor note, my/admin listing endpoints, and the
deterministic fallback note. This environment's .env has a real
ANTHROPIC_API_KEY configured, so every submission test explicitly forces it
off (empty string) to avoid live paid API calls — same convention as
test_ai_platform.py's test_pricing_suggestion_fallback_without_api_key.
"""
from dataclasses import dataclass

from app.api.routes.ai import _deterministic_affordability_note, generate_affordability_note
from app.core.ai import gateway
from app.models.property import Property
from app.models.user import User


@dataclass
class _FakeChatResult:
    reply: str
    input_tokens: int | None = 10
    output_tokens: int | None = 20
    latency_ms: float = 5.0


def _no_ai_key(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "")


def _signup(client, email) -> str:
    resp = client.post("/api/auth/signup", json={"email": email, "password": "S3cret!23"})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_property(db, **overrides) -> Property:
    defaults = dict(title="Test Villa", area="Al Yasmin", city="Riyadh", listing_type="rent", monthly_rent=6000.0, bedrooms=3, bathrooms=2, status="Published", property_type="apartment")
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


# ── Deterministic fallback note ─────────────────────────────────────────────

def test_deterministic_note_comfortable():
    note = _deterministic_affordability_note(stated_budget=20000, monthly_rent=6000)
    assert "comfortable" in note
    assert "not a financing offer" in note


def test_deterministic_note_stretch():
    note = _deterministic_affordability_note(stated_budget=6500, monthly_rent=6000)
    assert "stretch" in note


def test_deterministic_note_invalid_budget():
    note = _deterministic_affordability_note(stated_budget=0, monthly_rent=6000)
    assert "couldn't assess" in note


def test_generate_affordability_note_falls_back_without_api_key(monkeypatch):
    _no_ai_key(monkeypatch)
    note, generated_by = generate_affordability_note(stated_budget=10000, monthly_rent=6000, user_id=None)
    assert generated_by == "fallback"
    assert note


def test_generate_affordability_note_uses_ai_when_available(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    fake_result = _FakeChatResult(reply="This rent is a moderate stretch. Consider quarterly installments.")
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: fake_result)
    note, generated_by = generate_affordability_note(stated_budget=10000, monthly_rent=6000, user_id=None)
    assert generated_by == "ai"
    assert note == fake_result.reply


def test_generate_affordability_note_falls_back_on_ai_error(monkeypatch):
    monkeypatch.setattr("app.core.config.settings.ANTHROPIC_API_KEY", "sk-ant-fake-for-test")

    def _boom(**kwargs):
        raise RuntimeError("AI error: timeout")

    monkeypatch.setattr(gateway, "run_chat", _boom)
    note, generated_by = generate_affordability_note(stated_budget=10000, monthly_rent=6000, user_id=None)
    assert generated_by == "fallback"
    assert note


# ── API ───────────────────────────────────────────────────────────────────

def test_submit_financing_interest_requires_auth(client, db_session):
    prop = _make_property(db_session)
    db_session.commit()

    resp = client.post("/api/financing/", json={"property_id": prop.id, "stated_budget": 10000})
    assert resp.status_code == 401


def test_submit_financing_interest_404_for_missing_property(client, unique_email, monkeypatch):
    _no_ai_key(monkeypatch)
    token = _signup(client, unique_email)
    resp = client.post("/api/financing/", json={"property_id": 999999, "stated_budget": 10000}, headers=_auth(token))
    assert resp.status_code == 404


def test_submit_financing_interest_rejects_non_positive_budget(client, db_session, unique_email, monkeypatch):
    _no_ai_key(monkeypatch)
    prop = _make_property(db_session)
    db_session.commit()
    token = _signup(client, unique_email)

    resp = client.post("/api/financing/", json={"property_id": prop.id, "stated_budget": 0}, headers=_auth(token))
    assert resp.status_code == 422


def test_submit_and_fetch_my_financing_interest(client, db_session, unique_email, monkeypatch):
    _no_ai_key(monkeypatch)
    prop = _make_property(db_session)
    db_session.commit()
    token = _signup(client, unique_email)

    resp = client.post("/api/financing/", json={"property_id": prop.id, "stated_budget": 10000}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["property_id"] == prop.id
    assert body["stated_budget"] == 10000
    assert body["ai_generated_by"] == "fallback"
    assert body["ai_note"]
    assert body["property_title"] == "Test Villa"

    mine = client.get("/api/financing/my", headers=_auth(token))
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["id"] == body["id"]


def test_financing_admin_listing_requires_admin(client, db_session, unique_email, monkeypatch):
    _no_ai_key(monkeypatch)
    prop = _make_property(db_session)
    db_session.commit()
    token = _signup(client, unique_email)
    client.post("/api/financing/", json={"property_id": prop.id, "stated_budget": 10000}, headers=_auth(token))

    forbidden = client.get("/api/financing/admin/all", headers=_auth(token))
    assert forbidden.status_code == 403


def test_admin_can_list_all_financing_interests(client, db_session, unique_email, monkeypatch):
    _no_ai_key(monkeypatch)
    prop = _make_property(db_session)
    db_session.commit()
    renter_token = _signup(client, unique_email)
    submitted = client.post(
        "/api/financing/", json={"property_id": prop.id, "stated_budget": 10000}, headers=_auth(renter_token)
    ).json()

    admin_token = _signup(client, f"admin-{unique_email}")
    admin_user = db_session.query(User).filter(User.email == f"admin-{unique_email}").first()
    admin_user.is_admin = True
    db_session.commit()

    resp = client.get("/api/financing/admin/all", headers=_auth(admin_token))
    assert resp.status_code == 200, resp.text
    ids = [row["id"] for row in resp.json()]
    assert submitted["id"] in ids
