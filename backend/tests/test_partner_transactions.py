"""Rental/Buy Transaction Workspace — partner-facing routes (Prompt 5). See
docs/implementation/mymakan-transaction-workspace.md. Fixtures mirror
test_transactions_api.py's own helpers (duplicated rather than imported —
matches this suite's per-file convention, see test_negotiations.py/
test_partner_negotiations.py doing the same).
"""
import shutil
import uuid

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
    reason="partner_transactions.router isn't registered when FEATURE_NEGOTIATIONS is off",
)

_PDF_BYTES = b"%PDF-1.4 fake content for tests"


@pytest.fixture(autouse=True)
def _no_real_ai_calls(monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("real AI calls disabled in this test file")
    monkeypatch.setattr(gateway, "run_chat", _raise)


@pytest.fixture(autouse=True)
def _cleanup_uploaded_files():
    """Uploads land on real disk outside the DB-rollback isolation — see
    test_transactions_api.py's identical fixture (and its docstring for why
    this only removes subdirectories created during this test run, never
    `rmtree(UPLOAD_ROOT)` itself — that was confirmed live to delete a real
    uploaded transaction document belonging to the actual running app)."""
    pre_existing: set[str] = set()
    if transaction_service.UPLOAD_ROOT.is_dir():
        pre_existing = {p.name for p in transaction_service.UPLOAD_ROOT.iterdir()}
    yield
    if transaction_service.UPLOAD_ROOT.is_dir():
        for child in transaction_service.UPLOAD_ROOT.iterdir():
            if child.name not in pre_existing:
                shutil.rmtree(child, ignore_errors=True)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"pt-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
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
    defaults = dict(title="Partner Transaction Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
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


def _make_transaction(client, db, *, full_name="Sara Al-Otaibi", phone="0512345678", amount=3500, counter_amount=3800) -> tuple[PropertyTransaction, User, Mediator, User]:
    """End-to-end via the real HTTP accept path, returning
    (transaction, customer, mediator, mediator_user)."""
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
    return transaction, customer, mediator, mediator_user


def _required_docs(db, transaction: PropertyTransaction) -> list[TransactionDocument]:
    return (
        db.query(TransactionDocument)
        .filter(TransactionDocument.transaction_id == transaction.id, TransactionDocument.required.is_(True))
        .order_by(TransactionDocument.id)
        .all()
    )


def _upload_document(client, transaction_id, document_id, customer, filename="id.pdf"):
    return client.post(
        f"/api/v1/transactions/{transaction_id}/documents",
        data={"document_id": str(document_id)},
        files={"file": (filename, _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )


# ── GET /partner/transactions ───────────────────────────────────────────────

def test_list_scoped_to_own_transactions(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)
    other_mediator, other_user = _make_mediator(db_session)
    db_session.commit()

    mine = client.get("/api/v1/partner/transactions", headers=_auth(mediator_user))
    assert mine.status_code == 200, mine.text
    assert [t["id"] for t in mine.json()] == [transaction.id]

    others = client.get("/api/v1/partner/transactions", headers=_auth(other_user))
    assert others.status_code == 200
    assert others.json() == []


def test_list_filter_action_required(client, db_session):
    """A transaction only enters "action_required" once a document is
    actually `uploaded` (awaiting the mediator's decision) — not merely
    because the transaction exists."""
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)

    before = client.get("/api/v1/partner/transactions?status_filter=action_required", headers=_auth(mediator_user))
    assert transaction.id not in [t["id"] for t in before.json()]

    doc = _required_docs(db_session, transaction)[0]
    upload_resp = _upload_document(client, transaction.id, doc.id, customer)
    assert upload_resp.status_code == 200, upload_resp.text

    after = client.get("/api/v1/partner/transactions?status_filter=action_required", headers=_auth(mediator_user))
    assert transaction.id in [t["id"] for t in after.json()]

    active = client.get("/api/v1/partner/transactions?status_filter=active", headers=_auth(mediator_user))
    assert transaction.id not in [t["id"] for t in active.json()]


def test_list_filter_active_before_any_upload(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)

    resp = client.get("/api/v1/partner/transactions?status_filter=active", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    assert transaction.id in [t["id"] for t in resp.json()]


def test_list_filter_ready_and_completed_and_cancelled(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)
    transaction.status = "ready_for_next_step"
    db_session.commit()

    ready = client.get("/api/v1/partner/transactions?status_filter=ready", headers=_auth(mediator_user))
    assert transaction.id in [t["id"] for t in ready.json()]

    completed_before = client.get("/api/v1/partner/transactions?status_filter=completed", headers=_auth(mediator_user))
    assert transaction.id not in [t["id"] for t in completed_before.json()]

    transaction.status = "completed"
    db_session.commit()
    completed_after = client.get("/api/v1/partner/transactions?status_filter=completed", headers=_auth(mediator_user))
    assert transaction.id in [t["id"] for t in completed_after.json()]

    transaction.status = "cancelled"
    db_session.commit()
    cancelled = client.get("/api/v1/partner/transactions?status_filter=cancelled", headers=_auth(mediator_user))
    assert transaction.id in [t["id"] for t in cancelled.json()]


def test_list_does_not_expose_customer_contact(client, db_session):
    """Narrower than the negotiations feature's own partner privacy bar —
    only `customer_name`, never phone/email."""
    _transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session, full_name="Jane Renter", phone="0522222222")

    resp = client.get("/api/v1/partner/transactions", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    row = resp.json()[0]
    assert row["customer_name"] == "Jane Renter"
    assert "customer_phone" not in row
    assert "customer_email" not in row


# ── GET /partner/transactions/{id} ─────────────────────────────────────────

def test_get_transaction_detail_happy_path(client, db_session):
    transaction, customer, mediator, mediator_user = _make_transaction(client, db_session, full_name="Sara Al-Otaibi", phone="0512345678")

    resp = client.get(f"/api/v1/partner/transactions/{transaction.id}", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["reference"] == transaction.reference
    assert body["property_title"] == "Partner Transaction Test Property"
    assert len(body["checklist"]) == 6
    assert len(body["documents"]) == 3
    assert body["terms_snapshot"]["negotiation_reference"] == f"NEG-{transaction.negotiation_id:06d}"
    # Restricted customer snapshot — name only, no email/phone anywhere on
    # the response (matches the brief's "not full customer PII" scope).
    assert body["customer"] == {"full_name": "Sara Al-Otaibi"}
    assert "email" not in body["customer"]
    assert "phone" not in body["customer"]


def test_get_transaction_not_found(client, db_session):
    _mediator, mediator_user = _make_mediator(db_session)
    db_session.commit()
    resp = client.get("/api/v1/partner/transactions/999999999", headers=_auth(mediator_user))
    assert resp.status_code == 404


def test_get_transaction_cross_mediator_denied(client, db_session):
    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    other_mediator, other_user = _make_mediator(db_session)
    db_session.commit()

    resp = client.get(f"/api/v1/partner/transactions/{transaction.id}", headers=_auth(other_user))
    assert resp.status_code == 403


def test_customer_token_rejected_on_partner_only_routes(client, db_session):
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    resp_list = client.get("/api/v1/partner/transactions", headers=_auth(customer))
    assert resp_list.status_code == 403
    assert "mediator profile" in resp_list.json()["detail"].lower()

    resp_get = client.get(f"/api/v1/partner/transactions/{transaction.id}", headers=_auth(customer))
    assert resp_get.status_code == 403


# ── Download document (Prompt 10 addition — see partner_transactions.py's
# download_document() docstring: Prompt 5 never added this despite building
# accept/request-update, but a mediator can't meaningfully review a document
# without reading its bytes) ─────────────────────────────────────────────

def test_download_document_happy_path(client, db_session):
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)

    resp = client.get(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/download", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    assert resp.content == _PDF_BYTES


def test_download_document_before_upload_is_404(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    resp = client.get(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/download", headers=_auth(mediator_user))
    assert resp.status_code == 404


def test_download_document_cross_mediator_denied(client, db_session):
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)
    other_mediator, other_user = _make_mediator(db_session)
    db_session.commit()

    resp = client.get(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/download", headers=_auth(other_user))
    assert resp.status_code == 403


# ── Accept document ──────────────────────────────────────────────────────

def test_accept_document_happy_path(client, db_session):
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    upload_resp = _upload_document(client, transaction.id, doc.id, customer)
    assert upload_resp.status_code == 200, upload_resp.text

    resp = client.post(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/accept", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    accepted = next(d for d in resp.json()["documents"] if d["id"] == doc.id)
    assert accepted["status"] == "accepted"
    assert accepted["reviewed_at"] is not None
    assert accepted["review_note"] is None


def test_accept_document_before_upload_is_409(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    resp = client.post(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/accept", headers=_auth(mediator_user))
    assert resp.status_code == 409, resp.text


def test_accept_already_accepted_document_is_409(client, db_session):
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)

    first = client.post(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/accept", headers=_auth(mediator_user))
    assert first.status_code == 200, first.text

    second = client.post(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/accept", headers=_auth(mediator_user))
    assert second.status_code == 409, second.text


def test_accept_document_unknown_document_is_404(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)
    resp = client.post(f"/api/v1/partner/transactions/{transaction.id}/documents/999999999/accept", headers=_auth(mediator_user))
    assert resp.status_code == 404


def test_accept_document_cross_mediator_denied(client, db_session):
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)
    _other_mediator, other_user = _make_mediator(db_session)
    db_session.commit()

    resp = client.post(f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/accept", headers=_auth(other_user))
    assert resp.status_code == 403


# ── Request update ──────────────────────────────────────────────────────

def test_request_update_happy_path(client, db_session):
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/request-update",
        json={"reason": "Document is blurry, please re-upload"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 200, resp.text
    flagged = next(d for d in resp.json()["documents"] if d["id"] == doc.id)
    assert flagged["status"] == "needs_update"
    assert flagged["review_note"] == "Document is blurry, please re-upload"
    assert flagged["reviewed_at"] is not None


def test_request_update_reason_required(client, db_session):
    """Empty/whitespace-only reason is rejected (422) before ever reaching
    the service layer or mutating the document."""
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)

    empty = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/request-update",
        json={"reason": ""},
        headers=_auth(mediator_user),
    )
    assert empty.status_code == 422, empty.text

    whitespace = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/request-update",
        json={"reason": "   "},
        headers=_auth(mediator_user),
    )
    assert whitespace.status_code == 422, whitespace.text

    db_session.refresh(doc)
    assert doc.status == "uploaded"


def test_request_update_before_upload_is_409(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/request-update",
        json={"reason": "Please upload a clearer copy"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 409, resp.text


def test_request_update_reopens_customer_editable_gate(client, db_session):
    """After a request-update, the customer can re-upload — proves the
    mediator's action feeds back into the existing customer-side
    _document_editable() gate rather than a parallel mechanism."""
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)

    request_resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/request-update",
        json={"reason": "Please upload a clearer copy"},
        headers=_auth(mediator_user),
    )
    assert request_resp.status_code == 200, request_resp.text

    reupload_resp = _upload_document(client, transaction.id, doc.id, customer, filename="id-v2.pdf")
    assert reupload_resp.status_code == 200, reupload_resp.text
    reuploaded = next(d for d in reupload_resp.json()["documents"] if d["id"] == doc.id)
    assert reuploaded["status"] == "uploaded"
    assert reuploaded["review_note"] is None


def test_request_update_cross_mediator_denied(client, db_session):
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)
    _other_mediator, other_user = _make_mediator(db_session)
    db_session.commit()

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/request-update",
        json={"reason": "Please re-upload"},
        headers=_auth(other_user),
    )
    assert resp.status_code == 403


# ── Mediator cannot edit the document's file/content ────────────────────

def test_mediator_cannot_alter_uploaded_file_content(client, db_session):
    """Neither the accept nor request-update endpoints accept a file/content
    payload at all — only the review status/note changes, and the customer's
    originally uploaded bytes are unchanged and still downloadable
    afterward."""
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)
    db_session.refresh(doc)
    original_file_reference = doc.file_reference

    accept_resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/accept",
        # Even if a client sneaks extra fields into the body, there is no
        # file field this endpoint reads — FastAPI/pydantic silently drops
        # unknown fields since this route takes no request body model.
        json={"file_reference": "/etc/passwd", "review_note": "hijacked"},
        headers=_auth(mediator_user),
    )
    assert accept_resp.status_code == 200, accept_resp.text

    db_session.refresh(doc)
    assert doc.file_reference == original_file_reference
    assert doc.review_note is None  # accept() always clears review_note itself

    download_resp = client.get(
        f"/api/v1/transactions/{transaction.id}/documents/{doc.id}/download", headers=_auth(customer)
    )
    assert download_resp.status_code == 200
    assert download_resp.content == _PDF_BYTES


# ── Confirm information (mediator side) ──────────────────────────────────

def test_confirm_information_happy_path(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)

    resp = client.post(f"/api/v1/partner/transactions/{transaction.id}/confirm-information", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    assert resp.json()["mediator_info_confirmed_at"] is not None

    db_session.refresh(transaction)
    assert transaction.mediator_info_confirmed_at is not None
    # Distinct from the customer's own confirmation column/action.
    assert transaction.customer_info_confirmed_at is None


def test_confirm_information_blocked_after_cancel(client, db_session):
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    cancel_resp = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Changed mind"}, headers=_auth(customer))
    assert cancel_resp.status_code == 200

    resp = client.post(f"/api/v1/partner/transactions/{transaction.id}/confirm-information", headers=_auth(mediator_user))
    assert resp.status_code == 409, resp.text


def test_confirm_information_cross_mediator_denied(client, db_session):
    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    _other_mediator, other_user = _make_mediator(db_session)
    db_session.commit()

    resp = client.post(f"/api/v1/partner/transactions/{transaction.id}/confirm-information", headers=_auth(other_user))
    assert resp.status_code == 403


# ── agreed_amount immutability ────────────────────────────────────────────

def test_agreed_amount_immutable_through_partner_actions(client, db_session):
    """No request schema on this router (TransactionDocumentReviewRequest,
    or the bodyless accept/confirm-information routes) includes an
    `agreed_amount` field — even a client that sends one anyway has it
    silently dropped by pydantic before it ever reaches the service layer."""
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    original_amount = transaction.agreed_amount
    doc = _required_docs(db_session, transaction)[0]
    _upload_document(client, transaction.id, doc.id, customer)

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/request-update",
        json={"reason": "Please re-upload", "agreed_amount": "999999.99"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 200, resp.text
    assert float(resp.json()["agreed_amount"]) == float(original_amount)

    db_session.refresh(transaction)
    assert transaction.agreed_amount == original_amount
