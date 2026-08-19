"""Visit & Viewing Management — customer create/list/detail (Prompt 2). See
docs/implementation/mymakan-viewings.md. Follows this suite's conventions
(see test_bookings.py/test_partner_quality_api.py): ORM-level fixtures for
setup, HTTP-level tests via `client` for API behavior, flag-gated via
pytestmark since FEATURE_VISIT_MANAGEMENT could be toggled off locally.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.lead import Lead, LeadSuggestion
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_viewing import PropertyViewing
from app.models.user import User

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_VISIT_MANAGEMENT,
    reason="viewings.router isn't registered when FEATURE_VISIT_MANAGEMENT is off",
)


@pytest.fixture(autouse=True)
def _no_real_ai_calls(monkeypatch):
    """GET /viewings/{id} lazily generates the AI checklist (Prompt 5) on
    first access — this file isn't testing that feature, so force it to
    degrade to the deterministic fallback instead of making a real,
    billed Anthropic API call (a live key is configured in this dev env).
    Real checklist AI behavior is covered in test_viewing_checklist.py."""
    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")
    monkeypatch.setattr(gateway, "run_chat", _raise)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"viewing-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
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
    defaults = dict(title="Viewing Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _future(hours=48):
    return datetime.now(timezone.utc) + timedelta(hours=hours)


def _payload(prop, start=None, end=None, note=None):
    start = start or _future()
    end = end or (start + timedelta(minutes=30))
    body = {
        "property_id": prop.id,
        "requested_start_at": start.isoformat(),
        "requested_end_at": end.isoformat(),
        "timezone": "Asia/Riyadh",
    }
    if note is not None:
        body["customer_note"] = note
    return body


def test_create_viewing_succeeds_with_future_time(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    resp = client.post("/api/v1/viewings", json=_payload(prop, note="Looking forward to it"), headers=_auth(customer))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["property_id"] == prop.id
    assert body["status"] == "requested"
    assert body["mediator_id"] == mediator.id
    assert body["customer_note"] == "Looking forward to it"
    assert body["property_title"] == prop.title
    assert body["lead_id"] is None


def test_create_viewing_rejects_past_time(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    past_start = datetime.now(timezone.utc) - timedelta(hours=2)
    resp = client.post("/api/v1/viewings", json=_payload(prop, start=past_start), headers=_auth(customer))
    assert resp.status_code == 422, resp.text


def test_create_viewing_rejects_duplicate_active_viewing(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    first = client.post("/api/v1/viewings", json=_payload(prop), headers=_auth(customer))
    assert first.status_code == 201, first.text

    second = client.post("/api/v1/viewings", json=_payload(prop, start=_future(72)), headers=_auth(customer))
    assert second.status_code == 409, second.text


def test_create_viewing_404_on_unknown_property(client, db_session):
    customer = _make_user(db_session)
    db_session.commit()

    resp = client.post(
        "/api/v1/viewings",
        json={
            "property_id": 999_999_999,
            "requested_start_at": _future().isoformat(),
            "requested_end_at": (_future() + timedelta(minutes=30)).isoformat(),
            "timezone": "Asia/Riyadh",
        },
        headers=_auth(customer),
    )
    assert resp.status_code == 404


def test_get_viewing_403_for_another_customer(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    owner = _make_user(db_session)
    other = _make_user(db_session)
    db_session.commit()

    created = client.post("/api/v1/viewings", json=_payload(prop), headers=_auth(owner))
    assert created.status_code == 201, created.text
    viewing_id = created.json()["id"]

    resp = client.get(f"/api/v1/viewings/{viewing_id}", headers=_auth(other))
    assert resp.status_code == 403

    own = client.get(f"/api/v1/viewings/{viewing_id}", headers=_auth(owner))
    assert own.status_code == 200
    assert own.json()["id"] == viewing_id


def test_lead_linking_attaches_when_suggestion_exists(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    lead = Lead(
        customer_user_id=customer.id,
        customer_name="Test Customer",
        customer_phone="0500000000",
        customer_email=customer.email,
        area_name=prop.area,
        city=prop.city,
        status="open",
    )
    db_session.add(lead)
    db_session.flush()
    suggestion = LeadSuggestion(lead_id=lead.id, property_id=prop.id, match_score=0.9)
    db_session.add(suggestion)
    db_session.commit()

    resp = client.post("/api/v1/viewings", json=_payload(prop), headers=_auth(customer))
    assert resp.status_code == 201, resp.text
    assert resp.json()["lead_id"] == lead.id


def test_lead_linking_stays_null_without_suggestion(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    resp = client.post("/api/v1/viewings", json=_payload(prop), headers=_auth(customer))
    assert resp.status_code == 201, resp.text
    assert resp.json()["lead_id"] is None


# Idempotency-key replay coverage lives in test_redis_wired_endpoints.py
# (fake_redis fixture) — see test_viewing_creation_replays_response_for_same_idempotency_key
# there. Idempotency-Key protection is best-effort and no-ops when Redis is
# unavailable (see app/core/idempotency.py's module docstring), so it can't
# be meaningfully asserted against this file's plain `client` fixture.


# ── Prompt 3: customer-side transitions (cancel, propose-time, accept-reschedule) ──

def _create(client, prop, customer, **kwargs):
    resp = client.post("/api/v1/viewings", json=_payload(prop, **kwargs), headers=_auth(customer))
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_cancel_viewing_valid_transition(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, customer)
    resp = client.post(
        f"/api/v1/viewings/{viewing['id']}/cancel",
        json={"reason": "Plans changed"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "cancelled_by_customer"
    assert body["cancellation_reason"] == "Plans changed"
    assert body["cancelled_by"] == "customer"


def test_cancel_viewing_rejects_invalid_reason(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, customer)
    resp = client.post(
        f"/api/v1/viewings/{viewing['id']}/cancel",
        json={"reason": "Not a real reason"},
        headers=_auth(customer),
    )
    assert resp.status_code == 422


def test_cancel_already_completed_viewing_rejected(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, customer)
    row = db_session.get(PropertyViewing, viewing["id"])
    row.status = "completed"
    db_session.commit()

    resp = client.post(
        f"/api/v1/viewings/{viewing['id']}/cancel",
        json={"reason": "Plans changed"},
        headers=_auth(customer),
    )
    assert resp.status_code == 409


def test_propose_time_by_customer(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, customer)
    new_start = _future(96)
    resp = client.post(
        f"/api/v1/viewings/{viewing['id']}/propose-time",
        json={"start_at": new_start.isoformat(), "end_at": (new_start + timedelta(minutes=30)).isoformat(), "note": "Can we do later?"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "reschedule_proposed"
    assert body["proposed_by"] == "customer"
    # history preserved
    assert body["requested_start_at"] is not None


def test_propose_time_rejects_past_time(client, db_session):
    """§22 gap found in Prompt 13: propose-time must enforce the same
    future-time rule as create — it didn't until this prompt."""
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, customer)
    past_start = datetime.now(timezone.utc) - timedelta(hours=2)
    resp = client.post(
        f"/api/v1/viewings/{viewing['id']}/propose-time",
        json={"start_at": past_start.isoformat(), "end_at": (past_start + timedelta(minutes=30)).isoformat()},
        headers=_auth(customer),
    )
    assert resp.status_code == 422


def test_accept_reschedule_when_mediator_proposed(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, customer)
    row = db_session.get(PropertyViewing, viewing["id"])
    proposed_start = _future(96)
    row.status = "reschedule_proposed"
    row.proposed_start_at = proposed_start
    row.proposed_end_at = proposed_start + timedelta(minutes=30)
    row.proposed_by = "mediator"
    db_session.commit()

    resp = client.post(f"/api/v1/viewings/{viewing['id']}/accept-reschedule", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "confirmed"
    assert body["confirmed_start_at"] is not None


def test_accept_reschedule_rejects_own_proposal(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, customer)
    row = db_session.get(PropertyViewing, viewing["id"])
    proposed_start = _future(96)
    row.status = "reschedule_proposed"
    row.proposed_start_at = proposed_start
    row.proposed_end_at = proposed_start + timedelta(minutes=30)
    row.proposed_by = "customer"  # customer proposed it themselves
    db_session.commit()

    resp = client.post(f"/api/v1/viewings/{viewing['id']}/accept-reschedule", headers=_auth(customer))
    assert resp.status_code == 409


def test_transition_ownership_check_403_for_another_customer(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    owner = _make_user(db_session)
    other = _make_user(db_session)
    db_session.commit()

    viewing = _create(client, prop, owner)
    resp = client.post(
        f"/api/v1/viewings/{viewing['id']}/cancel",
        json={"reason": "Plans changed"},
        headers=_auth(other),
    )
    assert resp.status_code == 403
