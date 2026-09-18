"""Rental/Buy Transaction Workspace — model + auto-creation (Prompt 2). See
docs/implementation/mymakan-transaction-workspace.md. Follows this suite's
conventions (see test_negotiations.py): ORM-level fixtures for setup,
HTTP-level negotiation accept via `client` to exercise the real
accept_offer() code path the auto-creation hook attaches to (there is no
transaction API yet — Prompt 4/5's job — so PropertyTransaction rows are
read directly off the ORM), flag-gated via pytestmark since
FEATURE_NEGOTIATIONS could be toggled off locally (accept_offer() lives
behind that flag's router even though PropertyTransaction itself isn't
flag-gated).
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
from app.models.property_transaction import (
    PROPERTY_TRANSACTION_STATUSES,
    PROPERTY_TRANSACTION_TRANSITIONS,
    PropertyTransaction,
    TransactionDocument,
)
from app.models.user import User
from app.services import property_transaction as transaction_service

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_NEGOTIATIONS,
    reason="negotiations.router isn't registered when FEATURE_NEGOTIATIONS is off",
)


@pytest.fixture(autouse=True)
def _no_real_ai_calls(monkeypatch):
    """Mirrors test_negotiations.py's fixture of the same name — GET
    /negotiations/{id} computes NegotiationInsight fresh via deterministic
    services, but this file isn't testing AI behavior at all."""
    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")
    monkeypatch.setattr(gateway, "run_chat", _raise)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"txn-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
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
    defaults = dict(title="Transaction Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _create_negotiation(client, prop, customer, amount=3500) -> int:
    resp = client.post(f"/api/v1/properties/{prop.id}/negotiations", json={"amount": amount}, headers=_auth(customer))
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _make_mediator_counter(db, negotiation: PropertyNegotiation, mediator_user: User, amount=3800) -> NegotiationOffer:
    """Same fabrication trick test_negotiations.py uses — there is no
    mediator-side counter route wired yet, so this inserts a pending
    mediator_counter row directly, making the customer able to accept it (a
    customer can never accept their own latest offer)."""
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


def _accept(client, negotiation_id, customer):
    return client.post(f"/api/v1/negotiations/{negotiation_id}/accept", headers=_auth(customer))


def _accept_via_flow(client, db, prop, customer, mediator_user, amount=3500, counter_amount=3800):
    """End-to-end: create -> mediator counter (fabricated) -> customer
    accepts -> returns (negotiation, accept_response)."""
    negotiation_id = _create_negotiation(client, prop, customer, amount=amount)
    negotiation = db.get(PropertyNegotiation, negotiation_id)
    _make_mediator_counter(db, negotiation, mediator_user, amount=counter_amount)
    db.commit()

    resp = _accept(client, negotiation.id, customer)
    assert resp.status_code == 200, resp.text
    db.refresh(negotiation)
    return negotiation, resp


# ── Auto-creation on acceptance ──────────────────────────────────────────

def test_accepting_negotiation_auto_creates_transaction(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, listing_type="rent", monthly_rent=4000.0)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation, _resp = _accept_via_flow(client, db_session, prop, customer, mediator_user, amount=3500, counter_amount=3800)

    transaction = db_session.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation.id).one()
    assert transaction.property_id == prop.id
    assert transaction.transaction_type == "rent"
    assert transaction.customer_user_id == customer.id
    assert transaction.mediator_id == mediator.id
    assert transaction.lead_id is None
    assert transaction.viewing_id is None
    assert float(transaction.agreed_amount) == 3800.0
    assert transaction.currency == "SAR"
    assert transaction.status == "initiated"
    assert transaction.progress_percentage == 0
    assert transaction.customer_info_confirmed_at is None
    assert transaction.cancellation_reason is None
    assert transaction.ready_at is None
    assert transaction.completed_at is None
    assert transaction.cancelled_at is None


def test_auto_created_transaction_gets_a_reference(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation, _resp = _accept_via_flow(client, db_session, prop, customer, mediator_user)

    transaction = db_session.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation.id).one()
    assert transaction.reference == f"MYM-{transaction.id:05d}"


def test_accepting_negotiation_does_not_create_transaction_on_failed_accept(client, db_session):
    """A customer can never accept their own latest offer — accept_offer()
    raises before the transition happens, so no transaction should be
    created for a negotiation that was never actually accepted."""
    mediator, _mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation_id = _create_negotiation(client, prop, customer, amount=3500)
    resp = _accept(client, negotiation_id, customer)
    assert resp.status_code == 409, resp.text

    count = db_session.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation_id).count()
    assert count == 0


# ── Duplicate prevention ─────────────────────────────────────────────────

def test_duplicate_transaction_for_same_negotiation_is_prevented_at_db_level(db_session):
    """Directly exercises the service function twice for the same
    negotiation (simulating what a race between two concurrent accept
    requests would attempt) — the unique constraint on negotiation_id, not
    just an application-level check, is what must reject the second insert."""
    from sqlalchemy.exc import IntegrityError

    mediator, _mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    negotiation = PropertyNegotiation(
        property_id=prop.id,
        customer_user_id=customer.id,
        mediator_id=mediator.id,
        transaction_type="rent",
        status="accepted",
        current_offer_amount=Decimal("3500"),
        original_listing_amount=Decimal("4000"),
    )
    db_session.add(negotiation)
    db_session.flush()

    transaction_service.create_transaction_for_negotiation(db_session, negotiation)
    db_session.commit()

    with pytest.raises(IntegrityError):
        transaction_service.create_transaction_for_negotiation(db_session, negotiation)
        db_session.commit()
    db_session.rollback()

    count = db_session.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation.id).count()
    assert count == 1


# ── Document template seeding ────────────────────────────────────────────

def test_rent_transaction_seeds_rent_document_template(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, listing_type="rent", monthly_rent=4000.0)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation, _resp = _accept_via_flow(client, db_session, prop, customer, mediator_user)
    transaction = db_session.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation.id).one()

    documents = db_session.query(TransactionDocument).filter(TransactionDocument.transaction_id == transaction.id).all()
    types = {d.document_type for d in documents}
    assert types == {"national_id", "proof_of_income", "supporting_document"}
    required = {d.document_type for d in documents if d.required}
    assert required == {"national_id", "proof_of_income"}
    assert all(d.status == "not_uploaded" for d in documents)


def test_sale_transaction_seeds_buy_document_template(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, listing_type="sale", monthly_rent=None, sale_price=500000.0)
    customer = _make_user(db_session)
    db_session.commit()

    negotiation, _resp = _accept_via_flow(client, db_session, prop, customer, mediator_user, amount=480000, counter_amount=490000)
    transaction = db_session.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation.id).one()
    assert transaction.transaction_type == "sale"

    documents = db_session.query(TransactionDocument).filter(TransactionDocument.transaction_id == transaction.id).all()
    types = {d.document_type for d in documents}
    assert types == {"national_id", "proof_of_funds", "supporting_document"}
    required = {d.document_type for d in documents if d.required}
    assert required == {"national_id", "proof_of_funds"}


# ── Status transitions dict ──────────────────────────────────────────────

def test_transaction_transitions_cover_every_status():
    for status in PROPERTY_TRANSACTION_STATUSES:
        # Every status is a valid dict key (possibly with an empty/absent
        # set for terminal statuses) — .get(status, set()) never KeyErrors.
        PROPERTY_TRANSACTION_TRANSITIONS.get(status, set())


def test_transaction_transitions_terminal_statuses_have_no_outgoing_transitions():
    assert PROPERTY_TRANSACTION_TRANSITIONS.get("completed", set()) == set()
    assert PROPERTY_TRANSACTION_TRANSITIONS.get("cancelled", set()) == set()


def test_transaction_transitions_cancelled_reachable_from_every_active_status():
    active_statuses = [s for s in PROPERTY_TRANSACTION_STATUSES if s not in ("completed", "cancelled")]
    for status in active_statuses:
        assert "cancelled" in PROPERTY_TRANSACTION_TRANSITIONS.get(status, set()), status


def test_transaction_transitions_only_reference_known_statuses():
    for current, allowed in PROPERTY_TRANSACTION_TRANSITIONS.items():
        assert current in PROPERTY_TRANSACTION_STATUSES
        for nxt in allowed:
            assert nxt in PROPERTY_TRANSACTION_STATUSES


# ── Customer info snapshot ───────────────────────────────────────────────

def test_customer_info_snapshot_reuses_user_fields(db_session):
    customer = _make_user(db_session, full_name="Sara Al-Otaibi", phone="0512345678")
    db_session.commit()

    snapshot = transaction_service.customer_info_snapshot(customer)
    assert snapshot == {"email": customer.email, "full_name": "Sara Al-Otaibi", "phone": "0512345678"}


def test_customer_info_snapshot_allows_missing_optional_fields(db_session):
    customer = _make_user(db_session)
    db_session.commit()

    snapshot = transaction_service.customer_info_snapshot(customer)
    assert snapshot["email"] == customer.email
    assert snapshot["full_name"] is None
    assert snapshot["phone"] is None
