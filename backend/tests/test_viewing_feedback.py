"""Post-viewing feedback + AI Post-Viewing Assistant (Prompt 6). Follows
this suite's AI-mocking convention (see test_home_finder.py):
`monkeypatch.setattr(gateway, "run_chat", ...)`.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_viewing import PropertyViewing
from app.models.user import User

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_VISIT_MANAGEMENT,
    reason="viewings.router isn't registered when FEATURE_VISIT_MANAGEMENT is off",
)


@pytest.fixture(autouse=True)
def _no_real_ai_calls_unless_mocked(monkeypatch):
    """Same guard as test_viewings.py — a real ANTHROPIC_API_KEY is
    configured in this dev env; force AI calls to fail (deterministic
    fallback) unless a specific test overrides this with its own mock."""
    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")
    monkeypatch.setattr(gateway, "run_chat", _raise)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"feedback-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _make_mediator(db, **overrides) -> tuple[Mediator, User]:
    user = _make_user(db)
    defaults = dict(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000001", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator, user


def _make_property(db, mediator: Mediator | None = None, **overrides) -> Property:
    defaults = dict(title="Feedback Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_viewing(db, prop: Property, customer: User, mediator: Mediator, **overrides) -> PropertyViewing:
    start = datetime.now(timezone.utc) + timedelta(hours=48)
    defaults = dict(
        property_id=prop.id, customer_user_id=customer.id, mediator_id=mediator.id,
        requested_start_at=start, requested_end_at=start + timedelta(minutes=30),
        timezone="Asia/Riyadh", status="requested",
    )
    defaults.update(overrides)
    viewing = PropertyViewing(**defaults)
    db.add(viewing)
    db.flush()
    return viewing


class _FakeAiResult:
    def __init__(self, reply, input_tokens=10, output_tokens=10, latency_ms=5.0):
        self.reply = reply
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.latency_ms = latency_ms


# ── Feedback ─────────────────────────────────────────────────────────────

def test_feedback_rejected_before_completion(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator, status="confirmed")
    db_session.commit()

    resp = client.post(
        f"/api/v1/viewings/{viewing.id}/feedback",
        json={"interest_level": "Maybe"},
        headers=_auth(customer),
    )
    assert resp.status_code == 409


def test_feedback_persists_interest_reason_note(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator, status="completed", completed_at=datetime.now(timezone.utc))
    db_session.commit()

    resp = client.post(
        f"/api/v1/viewings/{viewing.id}/feedback",
        json={"interest_level": "Not Interested", "reason": "Price", "note": "Too expensive for the size"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["interest_level"] == "Not Interested"
    assert body["feedback_reason"] == "Price"
    assert body["feedback_note"] == "Too expensive for the size"

    # No status transition happened — feedback is not a state change.
    assert body["status"] == "completed"


def test_feedback_rejects_unknown_interest_level(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator, status="completed", completed_at=datetime.now(timezone.utc))
    db_session.commit()

    resp = client.post(
        f"/api/v1/viewings/{viewing.id}/feedback",
        json={"interest_level": "Kind of interested"},
        headers=_auth(customer),
    )
    assert resp.status_code == 422


# ── AI Next Steps ─────────────────────────────────────────────────────────

def test_ai_next_steps_rejected_before_completion(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator, status="confirmed")
    db_session.commit()

    resp = client.post(f"/api/v1/viewings/{viewing.id}/ai-next-steps", headers=_auth(customer))
    assert resp.status_code == 409


def test_ai_next_steps_grounding(client, db_session, monkeypatch):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(
        db_session, prop, customer, mediator,
        status="completed", completed_at=datetime.now(timezone.utc),
        private_notes=[{"text": "Kitchen felt small", "created_at": datetime.now(timezone.utc).isoformat()}],
        interest_level="Very Interested",
    )
    db_session.commit()

    captured = {}

    def _fake_run_chat(**kwargs):
        captured["content"] = kwargs["messages"][0]["content"]
        fake_reply = json.dumps({
            "visit_summary": "You visited Feedback Test Property and marked it Very Interested.",
            "next_steps": ["Contact the mediator to discuss next steps.", "Compare with your other saved properties."],
        })
        return _FakeAiResult(fake_reply)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    resp = client.post(f"/api/v1/viewings/{viewing.id}/ai-next-steps", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "ai"
    assert len(body["next_steps"]) == 2

    # Grounding: only real facts reached the prompt — the property title,
    # the customer's own note text, and the real interest level. No
    # fabricated negotiation claims or auto-contact language appear because
    # we never sent any such text as input.
    content = captured["content"]
    assert "Feedback Test Property" in content
    assert "Kitchen felt small" in content
    assert "Very Interested" in content
    assert "auto-contact" not in content.lower()
    assert "negotiat" not in content.lower()


def test_ai_next_steps_failure_falls_back_to_deterministic_summary(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(
        db_session, prop, customer, mediator,
        status="completed", completed_at=datetime.now(timezone.utc),
        interest_level="Maybe",
    )
    db_session.commit()
    # gateway.run_chat already raises via the autouse fixture — no extra mock needed.

    resp = client.post(f"/api/v1/viewings/{viewing.id}/ai-next-steps", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "fallback"
    assert body["visit_summary"]
    assert len(body["next_steps"]) >= 1


def test_ai_next_steps_works_with_minimal_input(client, db_session):
    """No search criteria, no property intelligence summary, no feedback —
    just a bare completed viewing with an empty checklist/notes."""
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator, status="completed", completed_at=datetime.now(timezone.utc))
    db_session.commit()

    resp = client.post(f"/api/v1/viewings/{viewing.id}/ai-next-steps", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["visit_summary"]
    assert len(body["next_steps"]) >= 1
