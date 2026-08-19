"""AI Negotiation & Offer Management — partner-facing routes (Prompt 4). See
docs/implementation/mymakan-negotiations.md. Mirrors
test_partner_viewings.py's ownership-check structure: every endpoint is
mediator-authenticated and scoped to the mediator's own properties'
negotiations, 404 for an unknown id, 403 "Not your listing" for someone
else's.
"""
import uuid

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_NEGOTIATIONS,
    reason="partner_negotiations.router isn't registered when FEATURE_NEGOTIATIONS is off",
)


@pytest.fixture(autouse=True)
def _no_real_ai_calls(monkeypatch):
    """GET /partner/negotiations/{id} computes NegotiationInsight fresh via
    the reused price_intelligence/negotiation_intelligence services (both
    deterministic, no LLM) — but this file isn't testing AI behavior at all,
    so force any accidental real Anthropic call to fail loudly rather than
    silently succeed and mask a real bug (mirrors test_negotiations.py's
    fixture of the same name)."""

    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")

    monkeypatch.setattr(gateway, "run_chat", _raise)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"pn-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x", full_name="Test Customer", phone="0511111111")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _make_mediator(db, **overrides) -> tuple[Mediator, User]:
    user = _make_user(db, full_name="Test Mediator")
    defaults = dict(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000001", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator, user


def _make_property(db, mediator: Mediator | None = None, **overrides) -> Property:
    defaults = dict(title="Partner Negotiation Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _create_negotiation(client, prop, customer, amount=3500, message=None) -> dict:
    """Creates a negotiation through the real customer-side endpoint
    (negotiations.py) rather than at the ORM level, so its first
    NegotiationOffer row + NEGOTIATION_SUBMITTED event exist exactly as they
    would in production."""
    body = {"amount": amount}
    if message is not None:
        body["message"] = message
    resp = client.post(f"/api/v1/properties/{prop.id}/negotiations", json=body, headers=_auth(customer))
    assert resp.status_code == 201, resp.text
    return resp.json()


def _partner_counter(client, negotiation_id, mediator_user, amount=3800, message=None):
    body = {"amount": amount}
    if message is not None:
        body["message"] = message
    return client.post(f"/api/v1/partner/negotiations/{negotiation_id}/counter", json=body, headers=_auth(mediator_user))


def _partner_accept(client, negotiation_id, mediator_user):
    return client.post(f"/api/v1/partner/negotiations/{negotiation_id}/accept", headers=_auth(mediator_user))


def _partner_reject(client, negotiation_id, mediator_user, reason="Offer too low"):
    return client.post(f"/api/v1/partner/negotiations/{negotiation_id}/reject", json={"reason": reason}, headers=_auth(mediator_user))


def _customer_counter(client, negotiation_id, customer, amount=3700):
    return client.post(f"/api/v1/negotiations/{negotiation_id}/offer", json={"amount": amount}, headers=_auth(customer))


# ── Counter ──────────────────────────────────────────────────────────────

def test_counter_from_submitted(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    resp = _partner_counter(client, negotiation["id"], mediator_user, amount=3800)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "countered"
    assert float(body["current_offer_amount"]) == 3800


def test_counter_from_countered(client, db_session):
    """Mediator can counter again after the customer counters back — the
    single `countered` status covers both directions."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    first = _partner_counter(client, negotiation["id"], mediator_user, amount=3800)
    assert first.status_code == 200, first.text

    customer_counter = _customer_counter(client, negotiation["id"], customer, amount=3650)
    assert customer_counter.status_code == 200, customer_counter.text

    second = _partner_counter(client, negotiation["id"], mediator_user, amount=3750)
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["status"] == "countered"
    assert float(body["current_offer_amount"]) == 3750


def test_counter_on_terminal_negotiation_is_409(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    reject_resp = _partner_reject(client, negotiation["id"], mediator_user)
    assert reject_resp.status_code == 200, reject_resp.text

    resp = _partner_counter(client, negotiation["id"], mediator_user, amount=3800)
    assert resp.status_code == 409, resp.text


def test_counter_rejects_non_positive_amount(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    resp = _partner_counter(client, negotiation["id"], mediator_user, amount=0)
    assert resp.status_code == 422


# ── Accept ───────────────────────────────────────────────────────────────

def test_accept_customers_latest_pending_offer(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    resp = _partner_accept(client, negotiation["id"], mediator_user)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "accepted"
    assert body["accepted_at"] is not None


def test_mediator_cannot_accept_own_counter(client, db_session):
    """Self-accept-blocked rule (brief §11): once the mediator's own counter
    is the latest pending offer, the mediator can't accept it themselves —
    only the customer (the OTHER party) can."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    counter = _partner_counter(client, negotiation["id"], mediator_user, amount=3800)
    assert counter.status_code == 200, counter.text

    resp = _partner_accept(client, negotiation["id"], mediator_user)
    assert resp.status_code == 409, resp.text


def test_accept_after_customer_counter(client, db_session):
    """Once the customer counters, the mediator (the OTHER party relative to
    that offer) can accept it."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    first_counter = _partner_counter(client, negotiation["id"], mediator_user, amount=3800)
    assert first_counter.status_code == 200, first_counter.text

    customer_counter = _customer_counter(client, negotiation["id"], customer, amount=3650)
    assert customer_counter.status_code == 200, customer_counter.text

    resp = _partner_accept(client, negotiation["id"], mediator_user)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "accepted"


# ── Reject ───────────────────────────────────────────────────────────────

def test_reject_with_mediator_reason(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    resp = _partner_reject(client, negotiation["id"], mediator_user, reason="Offer too low")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "rejected"
    assert body["cancellation_reason"] == "Offer too low"
    assert body["cancelled_by"] == "mediator"
    assert body["rejected_at"] is not None


def test_reject_from_countered(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    counter = _partner_counter(client, negotiation["id"], mediator_user, amount=3800)
    assert counter.status_code == 200, counter.text

    resp = _partner_reject(client, negotiation["id"], mediator_user, reason="Owner declined")
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected"


def test_reject_already_rejected_negotiation_is_409(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    first = _partner_reject(client, negotiation["id"], mediator_user)
    assert first.status_code == 200, first.text

    second = _partner_reject(client, negotiation["id"], mediator_user)
    assert second.status_code == 409, second.text


# ── Ownership ────────────────────────────────────────────────────────────

def test_403_when_mediator_does_not_own_property(client, db_session):
    owner_mediator, owner_user = _make_mediator(db_session)
    other_mediator, other_user = _make_mediator(db_session)
    prop = _make_property(db_session, owner_mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)

    resp = _partner_counter(client, negotiation["id"], other_user, amount=3800)
    assert resp.status_code == 403

    resp_accept = _partner_accept(client, negotiation["id"], other_user)
    assert resp_accept.status_code == 403

    resp_reject = _partner_reject(client, negotiation["id"], other_user)
    assert resp_reject.status_code == 403

    resp_get = client.get(f"/api/v1/partner/negotiations/{negotiation['id']}", headers=_auth(other_user))
    assert resp_get.status_code == 403


def test_404_for_unknown_negotiation(client, db_session):
    _mediator, mediator_user = _make_mediator(db_session)
    db_session.commit()

    resp = client.get("/api/v1/partner/negotiations/999999999", headers=_auth(mediator_user))
    assert resp.status_code == 404


def test_customer_token_rejected_on_partner_only_routes(client, db_session):
    """Prompt 13 (final validation) gap: every partner_negotiations.py route
    depends on get_mediator_user (app/api/deps.py), which — unlike
    negotiations.py's plain get_current_user — additionally requires the
    authenticated user to have their own Mediator row
    (`Mediator.user_id == user.id`); a customer-only user (no mediator
    profile at all) has none, so get_mediator_user itself raises 403 before
    any ownership check (_load_owned_negotiation) is ever reached. This
    proves the two auth dependencies genuinely differ and that a customer's
    token cannot be used to reach any partner-only action, not just that a
    mediator can't manage someone else's listing (already covered by
    test_403_when_mediator_does_not_own_property above)."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)

    resp_list = client.get("/api/v1/partner/negotiations", headers=_auth(customer))
    assert resp_list.status_code == 403
    assert "mediator profile" in resp_list.json()["detail"].lower()

    resp_get = client.get(f"/api/v1/partner/negotiations/{negotiation['id']}", headers=_auth(customer))
    assert resp_get.status_code == 403

    resp_counter = _partner_counter(client, negotiation["id"], customer, amount=3800)
    assert resp_counter.status_code == 403

    resp_accept = _partner_accept(client, negotiation["id"], customer)
    assert resp_accept.status_code == 403

    resp_reject = _partner_reject(client, negotiation["id"], customer)
    assert resp_reject.status_code == 403


def test_list_scoped_to_own_properties_negotiations(client, db_session):
    """A second mediator's negotiations never leak into this mediator's own
    list."""
    mediator, mediator_user = _make_mediator(db_session)
    other_mediator, _other_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    other_prop = _make_property(db_session, other_mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    _create_negotiation(client, other_prop, customer, amount=4200)

    resp = client.get("/api/v1/partner/negotiations", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    ids = [n["id"] for n in resp.json()]
    assert negotiation["id"] in ids
    assert len(ids) == 1


def test_status_filter(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)
    reject_resp = _partner_reject(client, negotiation["id"], mediator_user)
    assert reject_resp.status_code == 200, reject_resp.text

    matching = client.get("/api/v1/partner/negotiations?status_filter=rejected", headers=_auth(mediator_user))
    assert matching.status_code == 200, matching.text
    assert negotiation["id"] in [n["id"] for n in matching.json()]

    non_matching = client.get("/api/v1/partner/negotiations?status_filter=submitted", headers=_auth(mediator_user))
    assert negotiation["id"] not in [n["id"] for n in non_matching.json()]


# ── PII exposure ─────────────────────────────────────────────────────────

def test_partner_negotiation_exposes_customer_contact_matching_lead_privacy_bar(client, db_session):
    """LeadSummaryOut/LeadDetailOut already expose an assigned mediator the
    customer's full name/phone/email (backend/app/schemas/lead.py) — a
    mediator viewing their OWN property's negotiation is gated the same way
    (ownership check), so matching that bar (not exceeding it) is correct,
    not a leak."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session, full_name="Jane Renter", phone="0522222222")
    db_session.commit()

    negotiation = _create_negotiation(client, prop, customer, amount=3500)

    resp = client.get(f"/api/v1/partner/negotiations/{negotiation['id']}", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["customer_name"] == "Jane Renter"
    assert body["customer_phone"] == "0522222222"
    assert body["customer_email"] == customer.email

    # The customer-facing schemas (negotiations.py, not
    # partner_negotiations.py) must NOT declare customer contact fields at
    # all — sanity check that PropertyNegotiationOut/
    # PropertyNegotiationDetailOut (not PartnerNegotiationOut/
    # PartnerNegotiationDetailOut) is what the customer-side router actually
    # returns, mirroring test_partner_viewings.py's equivalent check.
    from app.schemas.property_negotiation import PropertyNegotiationDetailOut, PropertyNegotiationOut

    assert "customer_name" not in PropertyNegotiationOut.model_fields
    assert "customer_name" not in PropertyNegotiationDetailOut.model_fields


def test_partner_negotiation_list_does_not_leak_other_customers(client, db_session):
    """Two different customers' negotiations on the same mediator's
    properties must never cross-contaminate in the list response."""
    mediator, mediator_user = _make_mediator(db_session)
    prop_a = _make_property(db_session, mediator, title="Property A")
    prop_b = _make_property(db_session, mediator, title="Property B")
    customer_a = _make_user(db_session, full_name="Customer A", phone="0533333333")
    customer_b = _make_user(db_session, full_name="Customer B", phone="0544444444")
    db_session.commit()

    neg_a = _create_negotiation(client, prop_a, customer_a, amount=3500)
    neg_b = _create_negotiation(client, prop_b, customer_b, amount=4200)

    resp = client.get("/api/v1/partner/negotiations", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    by_id = {n["id"]: n for n in resp.json()}
    assert by_id[neg_a["id"]]["customer_name"] == "Customer A"
    assert by_id[neg_b["id"]]["customer_name"] == "Customer B"
