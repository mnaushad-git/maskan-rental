"""Rental/Buy Transaction Workspace — Admin read-only visibility (Prompt 7).
See docs/implementation/mymakan-transaction-workspace.md. Fixtures mirror
test_partner_transactions.py's own helpers (duplicated rather than imported
— matches this suite's per-file convention).
"""
import uuid

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_negotiation import NegotiationOffer, PropertyNegotiation
from app.models.property_transaction import PropertyTransaction
from app.models.user import User

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_NEGOTIATIONS,
    reason="admin_transactions.router isn't registered when FEATURE_NEGOTIATIONS is off",
)


@pytest.fixture(autouse=True)
def _no_real_ai_calls(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")
    monkeypatch.setattr(gateway, "run_chat", _raise)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"at-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
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
    defaults = dict(title="Admin Transaction Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if defaults["listing_type"] == "sale" and "sale_price" not in overrides:
        defaults.pop("monthly_rent", None)
        defaults["sale_price"] = 400000.0
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _admin_headers(db) -> tuple[dict, User]:
    admin = _make_user(db, is_admin=True)
    db.commit()
    return _auth(admin), admin


def _make_mediator_counter(db, negotiation: PropertyNegotiation, mediator_user: User, amount=3800) -> NegotiationOffer:
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


def _make_transaction(client, db, *, full_name="Sara Al-Otaibi", phone="0512345678", amount=3500, counter_amount=3800, transaction_type="rent") -> tuple[PropertyTransaction, User, Mediator, User]:
    """End-to-end via the real HTTP accept path, returning
    (transaction, customer, mediator, mediator_user)."""
    mediator, mediator_user = _make_mediator(db)
    prop = _make_property(db, mediator, listing_type=transaction_type)
    customer = _make_user(db, full_name=full_name, phone=phone)
    db.commit()

    resp = client.post(f"/api/v1/properties/{prop.id}/negotiations", json={"amount": amount}, headers=_auth(customer))
    assert resp.status_code == 201, resp.text
    negotiation = db.get(PropertyNegotiation, resp.json()["id"])
    _make_mediator_counter(db, negotiation, mediator_user, amount=counter_amount)
    db.commit()

    accept_resp = client.post(f"/api/v1/negotiations/{negotiation.id}/accept", headers=_auth(customer))
    assert accept_resp.status_code == 200, accept_resp.text
    db.refresh(negotiation)

    transaction = db.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation.id).one()
    return transaction, customer, mediator, mediator_user


# ── Access control ──────────────────────────────────────────────────────

def test_list_requires_admin(client, db_session):
    non_admin = _make_user(db_session)
    db_session.commit()
    resp = client.get("/api/v1/admin/transactions", headers=_auth(non_admin))
    assert resp.status_code == 403


def test_list_requires_auth(client, db_session):
    resp = client.get("/api/v1/admin/transactions")
    assert resp.status_code == 401


def test_detail_requires_admin(client, db_session):
    transaction, *_ = _make_transaction(client, db_session)
    non_admin = _make_user(db_session)
    db_session.commit()
    resp = client.get(f"/api/v1/admin/transactions/{transaction.id}", headers=_auth(non_admin))
    assert resp.status_code == 403


# ── List ─────────────────────────────────────────────────────────────────

def test_list_happy_path(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    transaction, customer, mediator, _mediator_user = _make_transaction(client, db_session)

    resp = client.get("/api/v1/admin/transactions", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["X-Total-Count"] == str(len(resp.json()))
    rows = {row["id"]: row for row in resp.json()}
    assert transaction.id in rows
    row = rows[transaction.id]
    assert row["reference"] == transaction.reference
    assert row["transaction_type"] == "rent"
    assert row["customer_name"] == "Sara Al-Otaibi"
    assert row["customer_email"] == customer.email
    assert row["mediator_agent_name"] == mediator.agency_name
    assert float(row["agreed_amount"]) == 3800.0
    assert row["status"] == "initiated"
    # `progress_percentage` is the stored column, only refreshed by
    # sync_progress_and_status() on a mutating action (Prompt 4/5) — a
    # freshly auto-created transaction with no mutations yet still reads 0
    # here even though the live checklist below already shows "offer_agreed"
    # done (same "known quirk" tracking doc documents for `status`).
    assert row["progress_percentage"] == 0
    assert "created_at" in row and "updated_at" in row
    assert "next_best_action" in row and "readiness_label" in row


def test_list_filters_by_status(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    transaction, *_ = _make_transaction(client, db_session)

    resp = client.get("/api/v1/admin/transactions?status=initiated", headers=admin_headers)
    assert resp.status_code == 200
    assert transaction.id in [row["id"] for row in resp.json()]

    resp2 = client.get("/api/v1/admin/transactions?status=completed", headers=admin_headers)
    assert resp2.status_code == 200
    assert transaction.id not in [row["id"] for row in resp2.json()]


def test_list_rejects_unknown_status(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    resp = client.get("/api/v1/admin/transactions?status=not_a_real_status", headers=admin_headers)
    assert resp.status_code == 422


def test_list_filters_by_transaction_type(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    rent_txn, *_ = _make_transaction(client, db_session, transaction_type="rent")
    sale_txn, *_ = _make_transaction(client, db_session, transaction_type="sale")

    resp = client.get("/api/v1/admin/transactions?transaction_type=sale", headers=admin_headers)
    assert resp.status_code == 200
    ids = [row["id"] for row in resp.json()]
    assert sale_txn.id in ids
    assert rent_txn.id not in ids


def test_list_filters_by_mediator_and_customer(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    transaction, customer, mediator, _mediator_user = _make_transaction(client, db_session)
    other_txn, *_ = _make_transaction(client, db_session)

    resp = client.get(f"/api/v1/admin/transactions?mediator_id={mediator.id}", headers=admin_headers)
    ids = [row["id"] for row in resp.json()]
    assert transaction.id in ids
    assert other_txn.id not in ids

    resp2 = client.get(f"/api/v1/admin/transactions?customer_user_id={customer.id}", headers=admin_headers)
    ids2 = [row["id"] for row in resp2.json()]
    assert transaction.id in ids2
    assert other_txn.id not in ids2


def test_list_sorts_by_progress_percentage(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    transaction, *_ = _make_transaction(client, db_session)

    resp = client.get("/api/v1/admin/transactions?sort=progress_percentage&order=asc", headers=admin_headers)
    assert resp.status_code == 200
    values = [row["progress_percentage"] for row in resp.json()]
    assert values == sorted(values)


def test_list_unknown_sort_falls_back_to_updated_at(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    _make_transaction(client, db_session)

    resp = client.get("/api/v1/admin/transactions?sort=not_a_real_column", headers=admin_headers)
    assert resp.status_code == 200


# ── Detail ───────────────────────────────────────────────────────────────

def test_detail_happy_path(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    transaction, customer, mediator, _mediator_user = _make_transaction(client, db_session)

    resp = client.get(f"/api/v1/admin/transactions/{transaction.id}", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()

    assert body["id"] == transaction.id
    assert body["customer_name"] == "Sara Al-Otaibi"
    assert body["customer_email"] == customer.email
    assert body["mediator_agent_name"] == mediator.agency_name

    # Checklist (Prompt 3's deterministic engine, reused verbatim).
    keys = [step["key"] for step in body["checklist"]]
    assert keys == ["offer_agreed", "customer_info", "documents_submitted", "mediator_review", "terms_reconfirmed", "ready_for_next_step"]

    # Document statuses (seeded from DOCUMENT_TEMPLATES).
    assert len(body["documents"]) == 3
    assert all(doc["status"] == "not_uploaded" for doc in body["documents"])

    # customer_info snapshot + terms_snapshot (negotiation reference).
    assert body["customer_info"]["email"] == customer.email
    assert body["terms_snapshot"]["negotiation_reference"] == f"NEG-{transaction.negotiation_id:06d}"

    # Timeline — at least the transaction.created event fired at auto-creation.
    event_types = [entry["event_type"] for entry in body["timeline"]]
    assert "transaction.created" in event_types
    created_entry = next(e for e in body["timeline"] if e["event_type"] == "transaction.created")
    assert created_entry["payload"]["transaction_id"] == transaction.id


def test_detail_not_found(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    resp = client.get("/api/v1/admin/transactions/9999999", headers=admin_headers)
    assert resp.status_code == 404


def test_detail_has_no_ownership_restriction(client, db_session):
    """Unlike the customer/partner routes, an admin can look up ANY
    transaction by id — there is no 403 "not yours" here."""
    admin_headers, _admin = _admin_headers(db_session)
    transaction, *_ = _make_transaction(client, db_session)

    resp = client.get(f"/api/v1/admin/transactions/{transaction.id}", headers=admin_headers)
    assert resp.status_code == 200


def test_admin_router_is_read_only(client, db_session):
    """No mutation endpoints exist on this router at all — confirmed
    directly rather than just by omission in the source."""
    admin_headers, _admin = _admin_headers(db_session)
    transaction, *_ = _make_transaction(client, db_session)

    for method, path in [
        ("post", f"/api/v1/admin/transactions/{transaction.id}/cancel"),
        ("patch", f"/api/v1/admin/transactions/{transaction.id}"),
        ("post", f"/api/v1/admin/transactions/{transaction.id}/confirm-information"),
    ]:
        resp = getattr(client, method)(path, headers=admin_headers)
        assert resp.status_code in (404, 405)
