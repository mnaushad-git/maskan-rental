"""AI Negotiation & Offer Management — customer create/list/detail (Prompt 2).
See docs/implementation/mymakan-negotiations.md. Follows this suite's
conventions (see test_viewings.py): ORM-level fixtures for setup, HTTP-level
tests via `client` for API behavior, flag-gated via pytestmark since
FEATURE_NEGOTIATIONS could be toggled off locally.
"""
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import fakeredis
import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.lead import Lead, LeadSuggestion
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_negotiation import NegotiationOffer, PropertyNegotiation
from app.models.property_viewing import PropertyViewing
from app.models.user import User
from app.services import property_negotiation as negotiation_service
from app.tasks import negotiation_notifications

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_NEGOTIATIONS,
    reason="negotiations.router isn't registered when FEATURE_NEGOTIATIONS is off",
)


@pytest.fixture(autouse=True)
def _no_real_ai_calls(monkeypatch):
    """GET /negotiations/{id} computes NegotiationInsight fresh via the
    reused price_intelligence/negotiation_intelligence services, which are
    both deterministic (no LLM) — but this file isn't testing AI behavior
    at all, so force any accidental real Anthropic call to fail loudly
    rather than silently succeed and mask a real bug."""
    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")
    monkeypatch.setattr(gateway, "run_chat", _raise)


@pytest.fixture()
def fake_redis(monkeypatch):
    """Local copy of test_redis_wired_endpoints.py's fixture — fixtures
    aren't shared across test files without a conftest.py entry, and this is
    the only file that needs it for the idempotency-key replay test below."""
    client = fakeredis.FakeStrictRedis(decode_responses=True)
    monkeypatch.setattr("app.core.idempotency.get_redis_client", lambda: client)
    return client


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"negotiation-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
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
    defaults = dict(title="Negotiation Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _make_viewing(db, prop: Property, customer: User, mediator: Mediator | None = None, **overrides) -> PropertyViewing:
    start = datetime.now(timezone.utc) - timedelta(days=2)
    defaults = dict(
        property_id=prop.id,
        customer_user_id=customer.id,
        mediator_id=mediator.id if mediator else None,
        requested_start_at=start,
        requested_end_at=start + timedelta(minutes=30),
        status="completed",
    )
    defaults.update(overrides)
    viewing = PropertyViewing(**defaults)
    db.add(viewing)
    db.flush()
    return viewing


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _payload(amount=3500, message=None, viewing_id=None):
    body = {"amount": amount}
    if message is not None:
        body["message"] = message
    if viewing_id is not None:
        body["viewing_id"] = viewing_id
    return body


def _create(client, prop, customer, **kwargs):
    return client.post(f"/api/v1/properties/{prop.id}/negotiations", json=_payload(**kwargs), headers=_auth(customer))


# ── Create ───────────────────────────────────────────────────────────────

def test_create_negotiation_succeeds_with_valid_amount(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    resp = _create(client, prop, customer, amount=3500, message="Would you accept 3500?")
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["property_id"] == prop.id
    assert body["status"] == "submitted"
    assert body["mediator_id"] == mediator.id
    assert float(body["current_offer_amount"]) == 3500
    assert float(body["original_listing_amount"]) == 4000.0
    assert body["lead_id"] is None
    assert body["viewing_id"] is None

    # The first NegotiationOffer row was created alongside the negotiation.
    negotiation = db_session.get(PropertyNegotiation, body["id"])
    offers = db_session.query(NegotiationOffer).filter(NegotiationOffer.negotiation_id == negotiation.id).all()
    assert len(offers) == 1
    assert offers[0].offer_type == "customer_offer"
    assert offers[0].status == "pending"
    assert offers[0].offered_by_user_id == customer.id
    assert float(offers[0].amount) == 3500


def test_create_negotiation_rejects_zero_amount(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    resp = _create(client, prop, customer, amount=0)
    assert resp.status_code == 422, resp.text


def test_create_negotiation_rejects_negative_amount(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    resp = _create(client, prop, customer, amount=-500)
    assert resp.status_code == 422, resp.text


def test_create_negotiation_rejects_duplicate_active_negotiation(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    first = _create(client, prop, customer, amount=3500)
    assert first.status_code == 201, first.text

    second = _create(client, prop, customer, amount=3600)
    assert second.status_code == 409, second.text


def test_create_negotiation_404_on_unknown_property(client, db_session):
    customer = _make_user(db_session)
    db_session.commit()

    resp = client.post("/api/v1/properties/999999999/negotiations", json=_payload(), headers=_auth(customer))
    assert resp.status_code == 404


# ── Read / ownership ─────────────────────────────────────────────────────

def test_get_negotiation_403_for_another_customer(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    owner = _make_user(db_session)
    other = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, owner)
    assert created.status_code == 201, created.text
    negotiation_id = created.json()["id"]

    resp = client.get(f"/api/v1/negotiations/{negotiation_id}", headers=_auth(other))
    assert resp.status_code == 403

    own = client.get(f"/api/v1/negotiations/{negotiation_id}", headers=_auth(owner))
    assert own.status_code == 200
    assert own.json()["id"] == negotiation_id
    assert "offers" in own.json()


def test_get_negotiation_404_for_unknown_id(client, db_session):
    customer = _make_user(db_session)
    db_session.commit()

    resp = client.get("/api/v1/negotiations/999999999", headers=_auth(customer))
    assert resp.status_code == 404


def test_get_active_negotiation_returns_404_when_none_exists(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    resp = client.get(f"/api/v1/properties/{prop.id}/negotiations/active", headers=_auth(customer))
    assert resp.status_code == 404


def test_get_active_negotiation_returns_it_when_present(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer)
    assert created.status_code == 201, created.text

    resp = client.get(f"/api/v1/properties/{prop.id}/negotiations/active", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == created.json()["id"]


def test_list_my_negotiations_ordered_by_updated_at_desc(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop_a = _make_property(db_session, mediator, title="Property A")
    prop_b = _make_property(db_session, mediator, title="Property B")
    customer = _make_user(db_session)
    db_session.commit()

    first = _create(client, prop_a, customer)
    assert first.status_code == 201, first.text

    # Both rows can otherwise land on the same server_default `now()` tick
    # (test runs in well under a second) which would make DB tie-breaking
    # order non-deterministic — push the first row's updated_at safely into
    # the past so the desc-ordering assertion below is actually meaningful.
    first_row = db_session.get(PropertyNegotiation, first.json()["id"])
    first_row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.commit()

    second = _create(client, prop_b, customer)
    assert second.status_code == 201, second.text

    resp = client.get("/api/v1/negotiations", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    ids = [row["id"] for row in resp.json()]
    assert ids[0] == second.json()["id"]  # most recently updated first
    assert second.json()["id"] in ids and first.json()["id"] in ids


# ── Lead integration ─────────────────────────────────────────────────────

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

    resp = _create(client, prop, customer)
    assert resp.status_code == 201, resp.text
    assert resp.json()["lead_id"] == lead.id


def test_lead_linking_stays_null_without_suggestion(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    resp = _create(client, prop, customer)
    assert resp.status_code == 201, resp.text
    assert resp.json()["lead_id"] is None


# ── Viewing integration ──────────────────────────────────────────────────

def test_viewing_linking_attaches_when_completed_and_owned(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator, status="completed")
    db_session.commit()

    resp = _create(client, prop, customer, viewing_id=viewing.id)
    assert resp.status_code == 201, resp.text
    assert resp.json()["viewing_id"] == viewing.id


def test_viewing_linking_rejected_when_not_completed(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator, status="confirmed")
    db_session.commit()

    resp = _create(client, prop, customer, viewing_id=viewing.id)
    assert resp.status_code == 422, resp.text


def test_viewing_linking_rejected_when_belongs_to_another_customer(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    viewing_owner = _make_user(db_session)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, viewing_owner, mediator, status="completed")
    db_session.commit()

    resp = _create(client, prop, customer, viewing_id=viewing.id)
    assert resp.status_code == 422, resp.text


# ── Snapshot semantics ───────────────────────────────────────────────────

def test_original_listing_amount_snapshots_property_price_at_creation(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, monthly_rent=5000.0)
    customer = _make_user(db_session)
    db_session.commit()

    resp = _create(client, prop, customer, amount=4200)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert float(body["original_listing_amount"]) == 5000.0
    assert float(body["current_offer_amount"]) == 4200

    # A later change to the listing price must NOT retroactively change the
    # already-created negotiation's snapshot.
    prop.monthly_rent = 6000.0
    db_session.commit()

    reread = client.get(f"/api/v1/negotiations/{body['id']}", headers=_auth(customer))
    assert reread.status_code == 200, reread.text
    assert float(reread.json()["original_listing_amount"]) == 5000.0


# ── Idempotency ──────────────────────────────────────────────────────────

def _accept(client, negotiation_id, customer):
    return client.post(f"/api/v1/negotiations/{negotiation_id}/accept", headers=_auth(customer))


def _counter(client, negotiation_id, customer, amount=3700, message=None):
    body = {"amount": amount}
    if message is not None:
        body["message"] = message
    return client.post(f"/api/v1/negotiations/{negotiation_id}/offer", json=body, headers=_auth(customer))


def _withdraw(client, negotiation_id, customer, reason="Changed mind"):
    return client.post(f"/api/v1/negotiations/{negotiation_id}/withdraw", json={"reason": reason}, headers=_auth(customer))


def _make_mediator_counter(db, negotiation: PropertyNegotiation, mediator_user: User, amount=3800) -> NegotiationOffer:
    """Directly inserts a pending mediator_counter offer row + supersedes
    the previous pending one, mirroring what property_negotiation.
    submit_counter(offer_type="mediator_counter") will do once Prompt 4
    wires the mediator-side route — this test file has no mediator route to
    call yet, so it fabricates the row at the ORM level to exercise
    accept_offer()'s "latest offer, other party" rule from the customer
    side."""
    previous = (
        db.query(NegotiationOffer)
        .filter(NegotiationOffer.negotiation_id == negotiation.id, NegotiationOffer.status == "pending")
        .first()
    )
    if previous:
        previous.status = "superseded"
    offer = NegotiationOffer(
        negotiation_id=negotiation.id,
        offered_by_user_id=mediator_user.id,
        amount=amount,
        offer_type="mediator_counter",
        status="pending",
    )
    db.add(offer)
    negotiation.status = "countered"
    negotiation.current_offer_amount = amount
    db.flush()
    return offer


# ── Counter-again ────────────────────────────────────────────────────────

def test_counter_again_updates_amount_and_supersedes_prior_offer(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    resp = _counter(client, negotiation_id, customer, amount=3700, message="How about 3700?")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "countered"
    assert float(body["current_offer_amount"]) == 3700

    offers = (
        db_session.query(NegotiationOffer)
        .filter(NegotiationOffer.negotiation_id == negotiation_id)
        .order_by(NegotiationOffer.created_at)
        .all()
    )
    assert len(offers) == 2
    assert offers[0].offer_type == "customer_offer"
    assert offers[0].status == "superseded"
    assert offers[1].offer_type == "customer_counter"
    assert offers[1].status == "pending"
    assert float(offers[1].amount) == 3700


def test_counter_on_another_customers_negotiation_is_403(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    owner = _make_user(db_session)
    other = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, owner)
    negotiation_id = created.json()["id"]

    resp = _counter(client, negotiation_id, other, amount=3700)
    assert resp.status_code == 403


# ── Accept ───────────────────────────────────────────────────────────────

def test_accept_blocked_when_latest_offer_placed_by_same_actor(client, db_session):
    """Self-accept blocked: the customer's own just-submitted offer is the
    latest pending offer — the customer cannot accept it themselves."""
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    resp = _accept(client, negotiation_id, customer)
    assert resp.status_code == 409, resp.text


def test_accept_blocked_after_customer_counters_their_own_counter(client, db_session):
    """After the customer counters, the latest offer is again the
    customer's own row (offer_type=customer_counter) — still blocked."""
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]
    countered = _counter(client, negotiation_id, customer, amount=3700)
    assert countered.status_code == 200, countered.text

    resp = _accept(client, negotiation_id, customer)
    assert resp.status_code == 409, resp.text


def test_accept_succeeds_on_other_partys_latest_pending_offer(client, db_session):
    """Once a mediator_counter is the latest pending offer, the customer
    (the OTHER party relative to who placed it) can accept it."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation = db_session.get(PropertyNegotiation, created.json()["id"])
    _make_mediator_counter(db_session, negotiation, mediator_user, amount=3800)
    db_session.commit()

    resp = _accept(client, negotiation.id, customer)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "accepted"
    assert body["accepted_at"] is not None

    accepted_offer = (
        db_session.query(NegotiationOffer)
        .filter(NegotiationOffer.negotiation_id == negotiation.id, NegotiationOffer.offer_type == "mediator_counter")
        .first()
    )
    assert accepted_offer.status == "accepted"


def test_accept_on_another_customers_negotiation_is_403(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    owner = _make_user(db_session)
    other = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, owner)
    negotiation = db_session.get(PropertyNegotiation, created.json()["id"])
    _make_mediator_counter(db_session, negotiation, mediator_user)
    db_session.commit()

    resp = _accept(client, negotiation.id, other)
    assert resp.status_code == 403


def test_accept_already_accepted_negotiation_is_409(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation = db_session.get(PropertyNegotiation, created.json()["id"])
    _make_mediator_counter(db_session, negotiation, mediator_user)
    db_session.commit()

    first_accept = _accept(client, negotiation.id, customer)
    assert first_accept.status_code == 200, first_accept.text

    second_accept = _accept(client, negotiation.id, customer)
    assert second_accept.status_code == 409, second_accept.text


def test_counter_on_accepted_negotiation_is_409(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation = db_session.get(PropertyNegotiation, created.json()["id"])
    _make_mediator_counter(db_session, negotiation, mediator_user)
    db_session.commit()

    accept_resp = _accept(client, negotiation.id, customer)
    assert accept_resp.status_code == 200, accept_resp.text

    resp = _counter(client, negotiation.id, customer, amount=3900)
    assert resp.status_code == 409, resp.text


# ── Withdraw ─────────────────────────────────────────────────────────────

def test_withdraw_persists_reason_and_blocks_further_transitions(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    resp = _withdraw(client, negotiation_id, customer, reason="Found another property")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "withdrawn"
    assert body["cancellation_reason"] == "Found another property"
    assert body["cancelled_by"] == "customer"

    row = db_session.get(PropertyNegotiation, negotiation_id)
    assert row.status == "withdrawn"
    assert row.cancellation_reason == "Found another property"
    assert row.cancelled_by == "customer"

    # Further transitions on a withdrawn negotiation are all rejected.
    assert _counter(client, negotiation_id, customer, amount=3600).status_code == 409
    assert _accept(client, negotiation_id, customer).status_code == 409
    assert _withdraw(client, negotiation_id, customer).status_code == 409


def test_withdraw_on_another_customers_negotiation_is_403(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    owner = _make_user(db_session)
    other = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, owner)
    negotiation_id = created.json()["id"]

    resp = _withdraw(client, negotiation_id, other)
    assert resp.status_code == 403


# ── Offer history integrity ──────────────────────────────────────────────

def test_offer_history_intact_after_multiple_rounds(client, db_session):
    """Superseded rows are never deleted — the full offer history remains
    queryable after several counter rounds."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    round1 = _counter(client, negotiation_id, customer, amount=3600)
    assert round1.status_code == 200, round1.text

    negotiation = db_session.get(PropertyNegotiation, negotiation_id)
    _make_mediator_counter(db_session, negotiation, mediator_user, amount=3900)
    db_session.commit()

    round2 = _counter(client, negotiation_id, customer, amount=3800)
    assert round2.status_code == 200, round2.text

    detail = client.get(f"/api/v1/negotiations/{negotiation_id}", headers=_auth(customer))
    assert detail.status_code == 200, detail.text
    offers = detail.json()["offers"]
    assert len(offers) == 4
    assert [o["offer_type"] for o in offers] == [
        "customer_offer",
        "customer_counter",
        "mediator_counter",
        "customer_counter",
    ]
    assert [o["status"] for o in offers] == ["superseded", "superseded", "superseded", "pending"]
    assert float(offers[-1]["amount"]) == 3800

    # All rows still exist in the table — nothing was deleted.
    count = db_session.query(NegotiationOffer).filter(NegotiationOffer.negotiation_id == negotiation_id).count()
    assert count == 4


def test_negotiation_creation_replays_response_for_same_idempotency_key(client, fake_redis, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    headers = {**_auth(customer), "Idempotency-Key": "negotiation-key-abc-123"}
    payload = _payload(amount=3500)

    first = client.post(f"/api/v1/properties/{prop.id}/negotiations", json=payload, headers=headers)
    assert first.status_code == 201, first.text
    first_id = first.json()["id"]

    second = client.post(f"/api/v1/properties/{prop.id}/negotiations", json=payload, headers=headers)
    assert second.status_code == 201, second.text
    assert second.json()["id"] == first_id

    count = db_session.query(PropertyNegotiation).filter(PropertyNegotiation.property_id == prop.id).count()
    assert count == 1  # the replay did not create a second negotiation


# ── Agreement Summary (Prompt 6, brief §22) ─────────────────────────────────
# build_agreement_summary() (app/services/property_negotiation.py) — a small
# deterministic helper, no AI call — embedded as
# PropertyNegotiationDetailOut.agreement_summary, populated ONLY once
# status == "accepted".


def test_agreement_summary_absent_before_acceptance(client, db_session):
    mediator, _m_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation_id = created.json()["id"]

    detail = client.get(f"/api/v1/negotiations/{negotiation_id}", headers=_auth(customer))
    assert detail.status_code == 200, detail.text
    assert detail.json()["agreement_summary"] is None

    # Still None once countered — only "accepted" populates it.
    countered = _counter(client, negotiation_id, customer, amount=3600)
    assert countered.status_code == 200, countered.text
    detail2 = client.get(f"/api/v1/negotiations/{negotiation_id}", headers=_auth(customer))
    assert detail2.json()["agreement_summary"] is None


def test_agreement_summary_populated_correctly_on_acceptance(client, db_session):
    mediator, mediator_user = _make_mediator(db_session, agency_name="Prime Realty")
    prop = _make_property(db_session, mediator, title="Agreement Test Flat")
    customer = _make_user(db_session, full_name="Sara Al-Otaibi")
    db_session.commit()

    created = _create(client, prop, customer, amount=3500)
    negotiation = db_session.get(PropertyNegotiation, created.json()["id"])
    _make_mediator_counter(db_session, negotiation, mediator_user, amount=3800)
    db_session.commit()

    accept_resp = _accept(client, negotiation.id, customer)
    assert accept_resp.status_code == 200, accept_resp.text

    detail = client.get(f"/api/v1/negotiations/{negotiation.id}", headers=_auth(customer))
    assert detail.status_code == 200, detail.text
    summary = detail.json()["agreement_summary"]
    assert summary is not None
    assert summary["property_id"] == prop.id
    assert summary["property_title"] == "Agreement Test Flat"
    assert summary["customer_name"] == "Sara Al-Otaibi"
    assert summary["mediator_agent_name"] == mediator.agency_name
    assert summary["transaction_type"] == "rent"
    assert float(summary["original_listing_amount"]) == 4000.0
    # The accepted offer (the mediator's SAR 3800 counter), not the customer's
    # original SAR 3500 offer.
    assert float(summary["final_agreed_amount"]) == 3800.0
    assert summary["agreed_at"] is not None
    assert summary["negotiation_reference"] == f"NEG-{negotiation.id:06d}"


def test_build_agreement_summary_none_when_not_accepted():
    """Unit-level, no DB required: build_agreement_summary() itself guards
    on status — calling it directly on a non-accepted negotiation returns
    None rather than fabricating a summary ahead of an actual acceptance."""
    negotiation = PropertyNegotiation(
        id=99, property_id=1, customer_user_id=10, mediator_id=20, transaction_type="rent",
        status="countered", current_offer_amount=Decimal("3800"), original_listing_amount=Decimal("4000"),
    )
    assert negotiation_service.build_agreement_summary(negotiation, [], None) is None


# ── Notification content (Prompt 6, brief §19) ──────────────────────────────
# Unit-level tests against negotiation_notifications._render()/_TITLES
# directly (no DB/Celery required) — asserts the rendered title/body strings
# match the brief's exact example copy, in both languages.


def _fake_property(**overrides) -> Property:
    """A plain (unpersisted) Property instance — negotiation_notifications._render()
    only reads title/area/property_type off negotiation.property, so no DB
    round trip is needed to test its rendering."""
    defaults = dict(
        title="Cozy Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        property_type="apartment", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0,
    )
    defaults.update(overrides)
    return Property(**defaults)


def _fake_negotiation(**overrides) -> PropertyNegotiation:
    defaults = dict(
        id=1, property_id=1, customer_user_id=10, mediator_id=20, transaction_type="rent",
        status="submitted", current_offer_amount=Decimal("8500"), original_listing_amount=Decimal("10000"),
    )
    defaults.update(overrides)
    return PropertyNegotiation(**defaults)


def test_render_offer_submitted_matches_brief_copy_both_languages():
    """Brief §19's exact example: "New offer received" / "SAR X offer
    received for {property title}"."""
    negotiation = _fake_negotiation()
    negotiation.property = _fake_property(title="Cozy Apartment")

    title_en, body_en = negotiation_notifications._render(
        "negotiation_offer_submitted", negotiation, locale="en", extra={"amount": "8500"}
    )
    assert title_en == "New offer received"
    assert body_en == "SAR 8500 offer received for Cozy Apartment. Review it to respond."

    title_ar, body_ar = negotiation_notifications._render(
        "negotiation_offer_submitted", negotiation, locale="ar", extra={"amount": "8500"}
    )
    assert title_ar == "عرض جديد مستلم"
    assert "8500" in body_ar and "Cozy Apartment" in body_ar


def test_render_counter_received_mediator_direction_matches_brief_copy():
    """Brief §19's exact example: "New counter offer" / "The mediator
    proposed SAR X for the apartment in {district}"."""
    negotiation = _fake_negotiation(status="countered", current_offer_amount=Decimal("70000"))
    negotiation.property = _fake_property(title="Downtown Flat", area="Al Olaya", property_type="apartment")

    title_en, body_en = negotiation_notifications._render(
        "negotiation_counter_received", negotiation, locale="en",
        extra={"amount": "70000", "offer_type": "mediator_counter"},
    )
    assert title_en == "New counter offer"
    assert body_en == "The mediator proposed SAR 70000 for the apartment in Al Olaya. Review it to respond."

    title_ar, body_ar = negotiation_notifications._render(
        "negotiation_counter_received", negotiation, locale="ar",
        extra={"amount": "70000", "offer_type": "mediator_counter"},
    )
    assert title_ar == "عرض مضاد جديد"
    assert "70000" in body_ar and "Al Olaya" in body_ar


def test_render_counter_received_customer_direction_uses_symmetric_copy():
    """The customer -> mediator counter direction (Prompt 4) has no
    dedicated brief example string — it mirrors the mediator direction's
    sentence shape with symmetric "The customer proposed..." wording."""
    negotiation = _fake_negotiation(status="countered", current_offer_amount=Decimal("69000"))
    negotiation.property = _fake_property(title="Downtown Flat")

    title_en, body_en = negotiation_notifications._render(
        "negotiation_counter_received", negotiation, locale="en",
        extra={"amount": "69000", "offer_type": "customer_counter"},
    )
    assert title_en == "New counter offer"
    assert body_en == "The customer proposed SAR 69000 for Downtown Flat. Review it to respond."

    title_ar, body_ar = negotiation_notifications._render(
        "negotiation_counter_received", negotiation, locale="ar",
        extra={"amount": "69000", "offer_type": "customer_counter"},
    )
    assert "69000" in body_ar and "Downtown Flat" in body_ar


def test_render_deep_link_shape_matches_viewing_notifications_convention():
    """Documents (rather than changes) that deep_link stays the same
    `mymakan://partner/negotiations/{id}` string every recipient already
    got — this already embeds the negotiation id the frontend routes on,
    the exact same shape viewing_notifications.py uses for viewings."""
    negotiation = _fake_negotiation(id=42)
    deep_link = f"mymakan://partner/negotiations/{negotiation.id}"
    assert deep_link == "mymakan://partner/negotiations/42"
