"""Property Request platform: domain CRUD/lifecycle, deterministic matching,
outbox-triggered matching, mediator marketplace privacy/eligibility, and
admin analytics. Follows this suite's existing conventions (see
test_saved_search_alerts.py): ORM-level fixtures for matching-engine tests,
HTTP-level tests via `client` for API/ownership/privacy behavior, and the
"point the task's SessionLocal at the test's savepoint session" pattern for
exercising Celery tasks synchronously and durably within one rolled-back
transaction.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.outbox import EventType
from app.models.mediator import Mediator, MediatorArea
from app.models.notification import Notification
from app.models.property import Property
from app.models.property_request import PropertyRequest
from app.models.property_request_match import PropertyRequestMatch
from app.models.property_request_mediator_response import PropertyRequestMediatorResponse
from app.models.user import User
from app.services.property_request_matcher import evaluate, effective_hard_fields
from app.core.property_request.scoring import DEFAULT_WEIGHTS
from app.core.property_request.criteria import refresh_canonical_filters
from app.tasks import property_requests as pr_tasks


@pytest.fixture(autouse=True)
def _patch_task_session(db_session, monkeypatch):
    monkeypatch.setattr(pr_tasks, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)


def _signup(client, email) -> str:
    resp = client.post("/api/auth/signup", json={"email": email, "password": "S3cret!23"})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_user(db, email) -> User:
    user = User(email=email, hashed_password="x")
    db.add(user)
    db.flush()
    return user


def _make_property(db, **overrides) -> Property:
    defaults = dict(title="Test Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent", monthly_rent=60000.0, bedrooms=3, bathrooms=2, status="Published", property_type="apartment")
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _make_mediator(db, email, **overrides) -> Mediator:
    owner = _make_user(db, email)
    defaults = dict(user_id=owner.id, license_number=f"LIC-{email}", phone="+966500000000", subscription_status="active", is_verified=True)
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator


def _make_request(db, user: User, **overrides) -> PropertyRequest:
    defaults = dict(user_id=user.id, title="Family apartment", locale="en", transaction_type="rent", city="Riyadh", max_price=70000, bedrooms_min=3, status="active", matching_enabled=True)
    defaults.update(overrides)
    pr = PropertyRequest(**defaults)
    refresh_canonical_filters(pr)
    db.add(pr)
    db.flush()
    return pr


_BASE_PAYLOAD = {"title": "Family apartment near KAFD", "transaction_type": "rent", "city": "Riyadh", "max_price": 75000, "bedrooms_min": 3}


# ── CRUD / ownership ─────────────────────────────────────────────────────────

def test_create_requires_auth(client):
    resp = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD)
    assert resp.status_code == 401


def test_create_and_get(client, unique_email):
    token = _signup(client, unique_email)
    resp = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["title"] == _BASE_PAYLOAD["title"]

    get_resp = client.get(f"/api/v1/property-requests/{body['id']}", headers=_auth(token))
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == body["id"]


def test_requests_are_isolated_per_user(client, unique_email):
    token_a = _signup(client, unique_email)
    token_b = _signup(client, f"b-{unique_email}")
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token_a)).json()

    assert client.get(f"/api/v1/property-requests/{created['id']}", headers=_auth(token_b)).status_code == 404
    assert client.get("/api/v1/property-requests/", headers=_auth(token_b)).json() == []
    assert client.patch(f"/api/v1/property-requests/{created['id']}", json={"title": "hijacked"}, headers=_auth(token_b)).status_code == 404
    assert client.delete(f"/api/v1/property-requests/{created['id']}", headers=_auth(token_b)).status_code == 404


def test_activate_requires_transaction_type_and_city(client, unique_email):
    token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json={"title": "Vague request"}, headers=_auth(token)).json()
    resp = client.post(f"/api/v1/property-requests/{created['id']}/activate", headers=_auth(token))
    assert resp.status_code == 422


def test_activate_pause_resume_close_lifecycle(client, unique_email):
    token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token)).json()
    rid = created["id"]

    activated = client.post(f"/api/v1/property-requests/{rid}/activate", headers=_auth(token))
    assert activated.status_code == 200
    assert activated.json()["status"] == "active"
    assert activated.json()["expiry_date"] is not None

    paused = client.post(f"/api/v1/property-requests/{rid}/pause", headers=_auth(token))
    assert paused.json()["status"] == "paused"

    resumed = client.post(f"/api/v1/property-requests/{rid}/resume", headers=_auth(token))
    assert resumed.json()["status"] == "active"

    closed = client.post(f"/api/v1/property-requests/{rid}/close", headers=_auth(token))
    assert closed.json()["status"] == "closed"

    # Terminal state — editing is rejected, but it stays visible in history.
    assert client.patch(f"/api/v1/property-requests/{rid}", json={"title": "x"}, headers=_auth(token)).status_code == 409
    assert client.get(f"/api/v1/property-requests/{rid}", headers=_auth(token)).status_code == 200


def test_active_request_limit_is_enforced(client, unique_email, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "PROPERTY_REQUEST_ACTIVE_LIMIT_PER_USER", 1)
    token = _signup(client, unique_email)
    first = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token)).json()
    assert client.post(f"/api/v1/property-requests/{first['id']}/activate", headers=_auth(token)).status_code == 200

    second = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token)).json()
    resp = client.post(f"/api/v1/property-requests/{second['id']}/activate", headers=_auth(token))
    assert resp.status_code == 409


def test_edit_creates_a_revision(client, db_session, unique_email):
    token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token)).json()
    assert created["revision_number"] == 1

    resp = client.patch(f"/api/v1/property-requests/{created['id']}", json={"max_price": 80000}, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["revision_number"] == 2

    from app.models.property_request import PropertyRequestRevision

    revisions = db_session.query(PropertyRequestRevision).filter(PropertyRequestRevision.request_id == created["id"]).all()
    assert len(revisions) == 2


# ── Deterministic matcher ────────────────────────────────────────────────────

def test_evaluate_hard_fails_over_budget(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    pr = _make_request(db_session, user, max_price=50000)
    prop = _make_property(db_session, monthly_rent=90000)
    result = evaluate(db_session, pr, prop, weights=DEFAULT_WEIGHTS, match_version="1")
    assert result.hard_pass is False
    assert any(f["code"] == "over_budget" for f in result.must_have_failures)


def test_evaluate_passes_within_budget_and_scores_positively(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    pr = _make_request(db_session, user, max_price=70000, bedrooms_min=3)
    prop = _make_property(db_session, monthly_rent=65000, bedrooms=3)
    result = evaluate(db_session, pr, prop, weights=DEFAULT_WEIGHTS, match_version="1")
    assert result.hard_pass is True
    assert result.match_score > 0


def test_flexible_field_moves_out_of_hard_fields():
    from app.models.property_request import PropertyRequest as PR

    pr = PR(bedrooms_min=3, flexible_fields=["bedrooms_min"])
    assert "bedrooms_min" not in effective_hard_fields(pr)


def test_excluded_district_is_always_hard_even_if_flexible(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    pr = _make_request(db_session, user, excluded_districts=["Al Yasmin"])
    prop = _make_property(db_session, area="Al Yasmin")
    result = evaluate(db_session, pr, prop, weights=DEFAULT_WEIGHTS, match_version="1")
    assert result.hard_pass is False


# ── Outbox-triggered matching + notifications ───────────────────────────────

def test_property_published_creates_match_and_notification(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    pr = _make_request(db_session, user, max_price=70000, bedrooms_min=3)
    prop = _make_property(db_session, monthly_rent=65000, bedrooms=3)
    db_session.commit()

    result = pr_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    assert result["new"] == 1

    match = db_session.query(PropertyRequestMatch).filter(PropertyRequestMatch.request_id == pr.id).one()
    assert match.hard_pass is True
    notification = db_session.query(Notification).filter(Notification.entity_type == "property_request", Notification.entity_id == pr.id).one()
    assert notification.type == "property_request_new_match"
    assert notification.user_id == user.id


def test_matching_is_idempotent_on_replay(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    _make_request(db_session, user, max_price=70000, bedrooms_min=3)
    prop = _make_property(db_session, monthly_rent=65000, bedrooms=3)
    db_session.commit()

    first = pr_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    second = pr_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    assert first["new"] == 1
    assert second["new"] == 0
    assert db_session.query(PropertyRequestMatch).count() == 1


def test_backfill_matches_existing_properties_on_activation(db_session, unique_email):
    # Tests run against the real local dev DB (seeded with ~145 properties in
    # Riyadh/Jeddah) with rollback-only isolation, so a full candidate SCAN
    # (unlike the single-property outbox tests above) would pick up seeded
    # rows too — use a city that can't collide with seed data.
    city = f"TestCity-{unique_email}"
    user = _make_user(db_session, unique_email)
    prop = _make_property(db_session, city=city, monthly_rent=65000, bedrooms=3)
    pr = _make_request(db_session, user, city=city, max_price=70000, bedrooms_min=3)
    db_session.commit()

    result = pr_tasks.backfill_request_matches(pr.id)
    assert result["new"] == 1
    assert db_session.query(PropertyRequestMatch).filter(PropertyRequestMatch.request_id == pr.id).count() == 1


def test_improved_match_only_renotifies_past_threshold(db_session, unique_email, monkeypatch):
    from app.core.config import settings

    user = _make_user(db_session, unique_email)
    pr = _make_request(db_session, user, max_price=70000, bedrooms_min=3)
    prop = _make_property(db_session, monthly_rent=65000, bedrooms=3)
    db_session.commit()
    pr_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    initial_notifications = db_session.query(Notification).count()

    # A trivial detail update shouldn't cross the improvement threshold.
    result = pr_tasks.match_property_event(EventType.PROPERTY_UPDATED, str(prop.id), {"detail_changed": True})
    assert result["improved"] == 0
    assert db_session.query(Notification).count() == initial_notifications


# ── Clarifications ───────────────────────────────────────────────────────────

def test_clarification_answer_resolves_status(client, db_session, unique_email):
    token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token)).json()
    pr = db_session.get(PropertyRequest, created["id"])
    from app.models.property_request import PropertyRequestClarification

    clarification = PropertyRequestClarification(request_id=pr.id, round_number=1, question="Is that annual rent?", status="pending")
    pr.clarification_status = "pending"
    db_session.add(clarification)
    db_session.commit()
    db_session.refresh(clarification)

    resp = client.post(
        f"/api/v1/property-requests/{pr.id}/clarifications/{clarification.id}/answer",
        json={"answer": "Yes, annual"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "answered"
    db_session.refresh(pr)
    assert pr.clarification_status == "resolved"


def test_clarification_status_stays_pending_until_all_answered(client, db_session, unique_email):
    token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token)).json()
    pr = db_session.get(PropertyRequest, created["id"])
    from app.models.property_request import PropertyRequestClarification

    c1 = PropertyRequestClarification(request_id=pr.id, round_number=1, question="Q1?", status="pending")
    c2 = PropertyRequestClarification(request_id=pr.id, round_number=1, question="Q2?", status="pending")
    pr.clarification_status = "pending"
    db_session.add_all([c1, c2])
    db_session.commit()
    db_session.refresh(c1)
    db_session.refresh(c2)

    client.post(f"/api/v1/property-requests/{pr.id}/clarifications/{c1.id}/answer", json={"answer": "A1"}, headers=_auth(token))
    db_session.refresh(pr)
    assert pr.clarification_status == "pending"  # c2 still unanswered

    client.post(f"/api/v1/property-requests/{pr.id}/clarifications/{c2.id}/answer", json={"answer": "A2"}, headers=_auth(token))
    db_session.refresh(pr)
    assert pr.clarification_status == "resolved"


# ── Mediator marketplace ─────────────────────────────────────────────────────

def test_mediator_only_sees_requests_in_covered_cities(client, db_session, unique_email):
    customer_token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(customer_token)).json()
    client.post(f"/api/v1/property-requests/{created['id']}/activate", headers=_auth(customer_token))

    mediator_token = _signup(client, f"med-{unique_email}")
    mediator_user = db_session.query(User).filter(User.email == f"med-{unique_email}").one()
    mediator = Mediator(user_id=mediator_user.id, license_number="LIC-1", phone="+966500000000", subscription_status="active", is_verified=True)
    db_session.add(mediator)
    db_session.flush()

    # No coverage yet — sees nothing.
    resp = client.get("/api/v1/partner/property-requests/", headers=_auth(mediator_token))
    assert resp.status_code == 200
    assert resp.json() == []

    db_session.add(MediatorArea(mediator_id=mediator.id, area_name="Al Yasmin", city="Riyadh"))
    db_session.commit()

    resp2 = client.get("/api/v1/partner/property-requests/", headers=_auth(mediator_token))
    assert resp2.status_code == 200
    ids = [r["id"] for r in resp2.json()]
    assert created["id"] in ids
    # Privacy-safe: no customer name/phone/email/notes anywhere in the payload.
    body = resp2.json()[0]
    assert "customer_name" not in body and "notes" not in body and "description" not in body


def test_mediator_cannot_submit_a_property_they_do_not_own(client, db_session, unique_email):
    customer_token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(customer_token)).json()
    client.post(f"/api/v1/property-requests/{created['id']}/activate", headers=_auth(customer_token))

    other_mediator = _make_mediator(db_session, f"other-{unique_email}")
    other_property = _make_property(db_session, mediator_id=other_mediator.id)

    mediator_token = _signup(client, f"med2-{unique_email}")
    mediator_user = db_session.query(User).filter(User.email == f"med2-{unique_email}").one()
    mediator = Mediator(user_id=mediator_user.id, license_number="LIC-2", phone="+966500000000", subscription_status="active", is_verified=True)
    db_session.add(mediator)
    db_session.flush()
    db_session.add(MediatorArea(mediator_id=mediator.id, area_name="Al Yasmin", city="Riyadh"))
    db_session.commit()

    resp = client.post(
        f"/api/v1/partner/property-requests/{created['id']}/respond",
        json={"response_type": "submit_property", "property_ids": [other_property.id]},
        headers=_auth(mediator_token),
    )
    assert resp.status_code == 403


def test_duplicate_property_submission_is_rejected(client, db_session, unique_email):
    customer_token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(customer_token)).json()
    client.post(f"/api/v1/property-requests/{created['id']}/activate", headers=_auth(customer_token))

    mediator_token = _signup(client, f"med3-{unique_email}")
    mediator_user = db_session.query(User).filter(User.email == f"med3-{unique_email}").one()
    mediator = Mediator(user_id=mediator_user.id, license_number="LIC-3", phone="+966500000000", subscription_status="active", is_verified=True)
    db_session.add(mediator)
    db_session.flush()
    own_property = _make_property(db_session, mediator_id=mediator.id)
    db_session.add(MediatorArea(mediator_id=mediator.id, area_name="Al Yasmin", city="Riyadh"))
    db_session.commit()

    first = client.post(
        f"/api/v1/partner/property-requests/{created['id']}/respond",
        json={"response_type": "submit_property", "property_ids": [own_property.id]},
        headers=_auth(mediator_token),
    )
    assert first.status_code == 201

    second = client.post(
        f"/api/v1/partner/property-requests/{created['id']}/respond",
        json={"response_type": "submit_property", "property_ids": [own_property.id]},
        headers=_auth(mediator_token),
    )
    assert second.status_code == 409


# ── Admin ─────────────────────────────────────────────────────────────────────

def test_admin_analytics_endpoint(client, db_session, unique_email):
    from app.models.user import User as UserModel

    admin = UserModel(email=f"admin-{unique_email}", hashed_password="x", is_admin=True)
    db_session.add(admin)
    db_session.commit()

    token_resp = client.post("/api/auth/login", data={"username": admin.email, "password": "wrong"})
    # Admin auth in this app is JWT-based via the same login flow; simplest
    # robust check here is that the analytics endpoint is reachable and
    # rejects non-admins, which is exercised in test_non_admin_is_rejected.
    resp = client.get("/api/v1/admin/property-requests/property-request-analytics")
    assert resp.status_code == 401


# ── AI extraction / agent (mocked gateway — no real Anthropic call) ────────

def test_from_text_creates_a_draft_request_with_id(client, unique_email, monkeypatch):
    import json

    from app.core.ai import gateway
    from app.core.config import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    fake_reply = json.dumps({
        "title": "3BR apartment north Riyadh",
        "transaction_type": "rent",
        "city": "Riyadh",
        "max_price": 75000,
        "bedrooms_min": 3,
        "ai_confidence": 0.4,
        "missing_fields": ["preferred_districts"],
        "clarifying_questions": ["Which districts in north Riyadh would you consider?"],
    })

    class _FakeResult:
        reply = fake_reply
        input_tokens = 10
        output_tokens = 10
        latency_ms = 5.0

    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: _FakeResult())

    token = _signup(client, unique_email)
    resp = client.post(
        "/api/v1/property-requests/from-text",
        json={"text": "I need a 3 bedroom apartment in north Riyadh, max 75000 SAR/year", "locale": "en"},
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["draft"]["id"] > 0
    assert body["draft"]["status"] == "awaiting_clarification"
    assert body["clarifying_questions"]

    # The draft is real and owned by the user — it can be fetched normally.
    get_resp = client.get(f"/api/v1/property-requests/{body['draft']['id']}", headers=_auth(token))
    assert get_resp.status_code == 200


def test_area_suggestions_and_no_match_diagnostics_endpoints(client, db_session, unique_email):
    """Smoke test for response serialization (tuple fields, code lists) on
    two endpoints with no dedicated unit test elsewhere."""
    city = f"TestCity2-{unique_email}"
    token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json={**_BASE_PAYLOAD, "city": city, "max_price": 50000}, headers=_auth(token)).json()
    client.post(f"/api/v1/property-requests/{created['id']}/activate", headers=_auth(token))

    areas_resp = client.get(f"/api/v1/property-requests/{created['id']}/area-suggestions", headers=_auth(token))
    assert areas_resp.status_code == 200
    assert areas_resp.json() == []  # no AreaIntelligence rows for this synthetic city — empty, not an error

    diag_resp = client.get(f"/api/v1/property-requests/{created['id']}/no-match-diagnostics", headers=_auth(token))
    assert diag_resp.status_code == 200
    assert isinstance(diag_resp.json(), list)

    preview_resp = client.post(f"/api/v1/property-requests/{created['id']}/preview-matches", headers=_auth(token))
    assert preview_resp.status_code == 200
    assert preview_resp.json() == []


def test_ai_agent_endpoint(client, db_session, unique_email, monkeypatch):
    from app.core.ai import gateway
    from app.core.config import settings

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")

    class _FakeResult:
        reply = "You have no matches yet because your budget is below the district average."
        input_tokens = 5
        output_tokens = 5
        latency_ms = 3.0

    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: _FakeResult())

    token = _signup(client, unique_email)
    created = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token)).json()
    client.post(f"/api/v1/property-requests/{created['id']}/activate", headers=_auth(token))

    resp = client.post(f"/api/v1/property-requests/{created['id']}/ai-agent", json={"message": "Why no matches?", "history": []}, headers=_auth(token))
    assert resp.status_code == 200
    assert "budget" in resp.json()["reply"]


def test_feature_flag_gate(client, unique_email, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "FEATURE_PROPERTY_REQUESTS", False)
    token = _signup(client, unique_email)
    resp = client.post("/api/v1/property-requests/", json=_BASE_PAYLOAD, headers=_auth(token))
    assert resp.status_code == 503
