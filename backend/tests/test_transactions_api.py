"""Rental/Buy Transaction Workspace — customer-facing API routes (Prompt 4).
See docs/implementation/mymakan-transaction-workspace.md. Fixtures mirror
test_property_transactions.py's own helpers (duplicated rather than
imported — matches this suite's per-file convention, see
test_negotiations.py/test_partner_negotiations.py doing the same).
"""
import shutil
import uuid
from decimal import Decimal

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_negotiation import NegotiationOffer, PropertyNegotiation
from app.models.property_transaction import PropertyTransaction, TransactionDocument
from app.models.user import User
from app.services import property_transaction as transaction_service

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_NEGOTIATIONS,
    reason="transactions.router isn't registered when FEATURE_NEGOTIATIONS is off",
)

_PDF_BYTES = b"%PDF-1.4 fake content for tests"


@pytest.fixture(autouse=True)
def _no_real_ai_calls(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")
    monkeypatch.setattr(gateway, "run_chat", _raise)


@pytest.fixture(autouse=True)
def _cleanup_uploaded_files():
    """Uploaded files land on real disk (backend/uploads/transactions/), not
    inside the DB-transaction-rollback isolation the `db_session` fixture
    gives every other write — so this test file's own uploads must be swept
    up manually or they'd accumulate across every local test run.

    Only remove per-transaction subdirectories that didn't exist before this
    test ran (snapshotted below), never `rmtree(UPLOAD_ROOT)` itself — in any
    environment without a separate test disk (this repo has none, mirroring
    its "no separate test DB" convention, see conftest.py), UPLOAD_ROOT is
    the SAME directory a real running app/uvicorn process serves real
    customer-uploaded transaction documents from. An unconditional
    `rmtree(UPLOAD_ROOT)` was confirmed live to delete a real, just-uploaded,
    mediator-accepted transaction document from disk the moment this test
    file ran, while the DB row was left claiming `status="accepted"` with a
    `file_reference` pointing at a now-deleted file — a real data-loss bug,
    not just test-hygiene noise."""
    pre_existing: set[str] = set()
    if transaction_service.UPLOAD_ROOT.is_dir():
        pre_existing = {p.name for p in transaction_service.UPLOAD_ROOT.iterdir()}
    yield
    if transaction_service.UPLOAD_ROOT.is_dir():
        for child in transaction_service.UPLOAD_ROOT.iterdir():
            if child.name not in pre_existing:
                shutil.rmtree(child, ignore_errors=True)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"txn-api-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
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
    defaults = dict(title="Transaction API Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


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


def _make_transaction(client, db, *, full_name="Sara Al-Otaibi", phone="0512345678", amount=3500, counter_amount=3800) -> tuple[PropertyTransaction, User, Mediator]:
    """End-to-end via the real HTTP accept path (exercises the real
    auto-creation hook), returning the resulting PropertyTransaction."""
    mediator, mediator_user = _make_mediator(db)
    prop = _make_property(db, mediator)
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
    return transaction, customer, mediator


def _required_docs(db, transaction: PropertyTransaction) -> list[TransactionDocument]:
    return (
        db.query(TransactionDocument)
        .filter(TransactionDocument.transaction_id == transaction.id, TransactionDocument.required.is_(True))
        .order_by(TransactionDocument.id)
        .all()
    )


def _accept_all_required_documents(db, transaction: PropertyTransaction) -> None:
    """Simulates the mediator's "accept" action (Prompt 5's own job, not yet
    built) directly at the ORM level, then runs the same recompute the real
    Prompt 5 endpoints will call."""
    for doc in _required_docs(db, transaction):
        doc.status = "accepted"
    db.flush()
    transaction_service.sync_progress_and_status(db, transaction)
    db.commit()


# ── GET /transactions ──────────────────────────────────────────────────────

def test_list_transactions_returns_only_own(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    db_session.commit()

    mine = client.get("/api/v1/transactions", headers=_auth(customer))
    assert mine.status_code == 200
    assert [t["id"] for t in mine.json()] == [transaction.id]

    others = client.get("/api/v1/transactions", headers=_auth(other))
    assert others.status_code == 200
    assert others.json() == []


def test_list_transactions_active_filter_excludes_cancelled(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    cancel_resp = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Changed mind"}, headers=_auth(customer))
    assert cancel_resp.status_code == 200

    active = client.get("/api/v1/transactions?status=active", headers=_auth(customer))
    assert active.json() == []
    cancelled = client.get("/api/v1/transactions?status=cancelled", headers=_auth(customer))
    assert [t["id"] for t in cancelled.json()] == [transaction.id]


# ── GET /transactions/{id} ─────────────────────────────────────────────────

def test_get_transaction_detail_happy_path(client, db_session):
    transaction, customer, mediator = _make_transaction(client, db_session, full_name="Sara Al-Otaibi", phone="0512345678")

    resp = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["reference"] == transaction.reference
    assert body["mediator_agent_name"] == mediator.agency_name
    assert body["property_title"] == "Transaction API Test Property"
    assert len(body["checklist"]) == 6
    assert body["checklist"][0]["key"] == "offer_agreed"
    assert body["checklist"][0]["status"] == "done"
    # Profile already complete (full_name/phone supplied) — customer_info
    # step should already be done at creation time.
    customer_info_step = next(s for s in body["checklist"] if s["key"] == "customer_info")
    assert customer_info_step["status"] == "done"
    assert body["next_best_action"]["key"] == "upload_missing_document"
    assert body["readiness_label"] == "Not Ready"
    assert body["terms_snapshot"]["negotiation_reference"] == f"NEG-{transaction.negotiation_id:06d}"
    assert body["customer_info"] == {"email": customer.email, "full_name": "Sara Al-Otaibi", "phone": "0512345678"}
    assert len(body["documents"]) == 3


def test_get_transaction_cross_customer_denied(client, db_session):
    transaction, _customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    db_session.commit()

    resp = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(other))
    assert resp.status_code == 403


def test_get_transaction_not_found(client, db_session):
    customer = _make_user(db_session)
    db_session.commit()
    resp = client.get("/api/v1/transactions/999999999", headers=_auth(customer))
    assert resp.status_code == 404


# ── PATCH /transactions/{id}/customer-information ─────────────────────────

def test_patch_customer_information_updates_profile_and_recomputes(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session, full_name=None, phone=None)

    before = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(customer)).json()
    assert next(s for s in before["checklist"] if s["key"] == "customer_info")["status"] == "pending"
    # Status stays at its creation-time value ("initiated") until the first
    # mutating action triggers sync_progress_and_status() — GET never
    # writes, it only computes the checklist/next-best-action/readiness
    # fields fresh. See tracking doc's "Checklist methodology".
    assert before["status"] == "initiated"

    resp = client.patch(
        f"/api/v1/transactions/{transaction.id}/customer-information",
        json={"full_name": "New Name", "phone": "0599999999"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["customer_info"] == {"email": customer.email, "full_name": "New Name", "phone": "0599999999"}
    assert next(s for s in body["checklist"] if s["key"] == "customer_info")["status"] == "done"
    assert body["status"] == "documents_required"


def test_patch_customer_information_ignores_agreed_amount_field(client, db_session):
    """agreed_amount is never editable via any of these endpoints — an
    extraneous field in the body must be silently ignored, not applied."""
    transaction, customer, _mediator = _make_transaction(client, db_session)
    original_amount = str(transaction.agreed_amount)

    resp = client.patch(
        f"/api/v1/transactions/{transaction.id}/customer-information",
        json={"full_name": "Updated Name", "agreed_amount": "1.00"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["agreed_amount"] == original_amount


def test_patch_customer_information_cross_customer_denied(client, db_session):
    transaction, _customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    db_session.commit()

    resp = client.patch(
        f"/api/v1/transactions/{transaction.id}/customer-information",
        json={"full_name": "Hacker"},
        headers=_auth(other),
    )
    assert resp.status_code == 403


# ── POST /transactions/{id}/documents ──────────────────────────────────────

def test_upload_document_happy_path(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    uploaded = next(d for d in body["documents"] if d["id"] == doc.id)
    assert uploaded["status"] == "uploaded"
    assert uploaded["uploaded_at"] is not None
    assert uploaded["file_reference"] is not None
    docs_step = next(s for s in body["checklist"] if s["key"] == "documents_submitted")
    assert docs_step["detail"] == "1/2"


def test_upload_document_invalid_content_type_rejected(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.txt", b"not a real document", "text/plain")},
        headers=_auth(customer),
    )
    assert resp.status_code == 422, resp.text
    db_session.refresh(doc)
    assert doc.status == "not_uploaded"


def test_upload_document_oversized_rejected(client, db_session, monkeypatch):
    monkeypatch.setattr(transaction_service, "MAX_DOCUMENT_SIZE_BYTES", 8)
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert resp.status_code == 422, resp.text
    db_session.refresh(doc)
    assert doc.status == "not_uploaded"


def test_upload_document_cross_customer_denied(client, db_session):
    transaction, _customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    db_session.commit()
    doc = _required_docs(db_session, transaction)[0]

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(other),
    )
    assert resp.status_code == 403


def test_upload_document_blocked_once_accepted(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    doc.status = "accepted"
    db_session.commit()

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert resp.status_code == 409, resp.text


def test_upload_document_allowed_while_needs_update(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    doc.status = "needs_update"
    doc.review_note = "Please upload a clearer copy."
    db_session.commit()

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id-clear.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    uploaded = next(d for d in resp.json()["documents"] if d["id"] == doc.id)
    assert uploaded["status"] == "uploaded"
    # Stale mediator feedback is cleared once the customer has re-submitted.
    assert uploaded["review_note"] is None


# ── DELETE /transactions/{id}/documents/{document_id} ──────────────────────

def test_delete_document_blocked_while_under_mediator_review(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    doc.status = "uploaded"
    doc.file_reference = "/tmp/does-not-matter"
    db_session.commit()

    resp = client.delete(f"/api/v1/transactions/{transaction.id}/documents/{doc.id}", headers=_auth(customer))
    assert resp.status_code == 409, resp.text


def test_delete_document_allowed_while_needs_update(client, db_session, tmp_path):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    upload_resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert upload_resp.status_code == 200
    db_session.refresh(doc)
    doc.status = "needs_update"
    db_session.commit()

    resp = client.delete(f"/api/v1/transactions/{transaction.id}/documents/{doc.id}", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    deleted = next(d for d in resp.json()["documents"] if d["id"] == doc.id)
    assert deleted["status"] == "not_uploaded"
    assert deleted["file_reference"] is None


def test_delete_document_cross_customer_denied(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    doc = _required_docs(db_session, transaction)[0]
    client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    db_session.commit()

    resp = client.delete(f"/api/v1/transactions/{transaction.id}/documents/{doc.id}", headers=_auth(other))
    assert resp.status_code == 403


# ── GET /transactions/{id}/documents/{document_id}/download ────────────────

def test_download_document_requires_ownership(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    doc = _required_docs(db_session, transaction)[0]
    db_session.commit()

    upload_resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": str(doc.id)},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert upload_resp.status_code == 200

    own_download = client.get(f"/api/v1/transactions/{transaction.id}/documents/{doc.id}/download", headers=_auth(customer))
    assert own_download.status_code == 200
    assert own_download.content == _PDF_BYTES

    other_download = client.get(f"/api/v1/transactions/{transaction.id}/documents/{doc.id}/download", headers=_auth(other))
    assert other_download.status_code == 403


def test_download_document_404_before_upload(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    resp = client.get(f"/api/v1/transactions/{transaction.id}/documents/{doc.id}/download", headers=_auth(customer))
    assert resp.status_code == 404


# ── POST /transactions/{id}/confirm-information ────────────────────────────

def test_confirm_information_sets_timestamp_and_recomputes(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    _accept_all_required_documents(db_session, transaction)

    resp = client.post(f"/api/v1/transactions/{transaction.id}/confirm-information", headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["customer_info_confirmed_at"] is not None
    assert body["status"] == "ready_for_next_step"
    assert body["progress_percentage"] == 100
    assert body["readiness_label"] == "Ready for Rental Contract Process"
    assert body["ready_at"] is not None


def test_confirm_information_cross_customer_denied(client, db_session):
    transaction, _customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    db_session.commit()

    resp = client.post(f"/api/v1/transactions/{transaction.id}/confirm-information", headers=_auth(other))
    assert resp.status_code == 403


def test_confirm_information_blocked_after_cancel(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    cancel_resp = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Changed mind"}, headers=_auth(customer))
    assert cancel_resp.status_code == 200

    resp = client.post(f"/api/v1/transactions/{transaction.id}/confirm-information", headers=_auth(customer))
    assert resp.status_code == 409


# ── POST /transactions/{id}/cancel ─────────────────────────────────────────

def test_cancel_transaction_happy_path(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)

    resp = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Found another property"}, headers=_auth(customer))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["cancelled_by"] == "customer"
    assert body["cancellation_reason"] == "Found another property"
    assert body["cancelled_at"] is not None


def test_cancel_after_terminal_rejected(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session)
    first = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Changed mind"}, headers=_auth(customer))
    assert first.status_code == 200

    second = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Changed mind again"}, headers=_auth(customer))
    assert second.status_code == 409


def test_cancel_transaction_cross_customer_denied(client, db_session):
    transaction, _customer, _mediator = _make_transaction(client, db_session)
    other = _make_user(db_session)
    db_session.commit()

    resp = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Not mine"}, headers=_auth(other))
    assert resp.status_code == 403


def test_cancel_once_ready_still_rejected_after_completion_only():
    """Documents the one deliberate gap: ready_for_next_step is NOT terminal
    (still cancellable, per PROPERTY_TRANSACTION_TRANSITIONS — "cancelled"
    is reachable from every non-terminal status). This test just asserts
    that fact directly against the transitions dict, since no endpoint in
    this feature ever sets status to "completed" (out of scope — see
    tracking doc's "Absolutely NOT in scope": Ejar/contract execution)."""
    from app.models.property_transaction import PROPERTY_TRANSACTION_TRANSITIONS
    assert "cancelled" in PROPERTY_TRANSACTION_TRANSITIONS["ready_for_next_step"]


# ── Full rent flow (integration) ───────────────────────────────────────────

def test_full_rent_flow_reaches_ready_for_rental_contract_process(client, db_session):
    transaction, customer, _mediator = _make_transaction(client, db_session, full_name="Sara", phone="0500000000")
    required = _required_docs(db_session, transaction)
    assert len(required) == 2

    for doc in required:
        resp = client.post(
            f"/api/v1/transactions/{transaction.id}/documents",
            data={"document_id": str(doc.id)},
            files={"file": (f"{doc.document_type}.pdf", _PDF_BYTES, "application/pdf")},
            headers=_auth(customer),
        )
        assert resp.status_code == 200, resp.text

    mid = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(customer)).json()
    assert mid["status"] == "under_review"
    assert mid["next_best_action"]["key"] == "await_mediator_review"

    _accept_all_required_documents(db_session, transaction)

    almost = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(customer)).json()
    assert almost["readiness_label"] == "Almost Ready"
    assert almost["next_best_action"]["key"] == "confirm_information"

    confirm_resp = client.post(f"/api/v1/transactions/{transaction.id}/confirm-information", headers=_auth(customer))
    assert confirm_resp.status_code == 200
    final = confirm_resp.json()
    assert final["status"] == "ready_for_next_step"
    assert final["progress_percentage"] == 100
    assert final["readiness_label"] == "Ready for Rental Contract Process"
    assert final["next_best_action"]["key"] == "ready"


def test_full_sale_flow_reaches_ready_for_sale_process(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, listing_type="sale", monthly_rent=None, sale_price=500000.0)
    customer = _make_user(db_session, full_name="Buyer", phone="0511111111")
    db_session.commit()

    create_resp = client.post(f"/api/v1/properties/{prop.id}/negotiations", json={"amount": 480000}, headers=_auth(customer))
    assert create_resp.status_code == 201, create_resp.text
    negotiation = db_session.get(PropertyNegotiation, create_resp.json()["id"])
    _make_mediator_counter(db_session, negotiation, mediator_user, amount=490000)
    db_session.commit()

    accept_resp = client.post(f"/api/v1/negotiations/{negotiation.id}/accept", headers=_auth(customer))
    assert accept_resp.status_code == 200, accept_resp.text
    transaction = db_session.query(PropertyTransaction).filter(PropertyTransaction.negotiation_id == negotiation.id).one()

    for doc in _required_docs(db_session, transaction):
        resp = client.post(
            f"/api/v1/transactions/{transaction.id}/documents",
            data={"document_id": str(doc.id)},
            files={"file": (f"{doc.document_type}.pdf", _PDF_BYTES, "application/pdf")},
            headers=_auth(customer),
        )
        assert resp.status_code == 200, resp.text

    _accept_all_required_documents(db_session, transaction)
    confirm_resp = client.post(f"/api/v1/transactions/{transaction.id}/confirm-information", headers=_auth(customer))
    assert confirm_resp.status_code == 200
    final = confirm_resp.json()
    assert final["status"] == "ready_for_next_step"
    assert final["readiness_label"] == "Ready for Sale Process"
