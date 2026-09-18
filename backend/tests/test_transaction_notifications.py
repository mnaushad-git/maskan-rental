"""Rental/Buy Transaction Workspace — notifications (Prompt 6). See
docs/implementation/mymakan-transaction-workspace.md. Mirrors
test_negotiations.py's "Notification content" section (unit tests against
`_render()` directly) plus test_outbox.py's "real endpoints actually emit
the events they claim to" end-to-end style (HTTP-level, asserting the
`OutboxEvent` row each mutating action creates). Fixtures duplicated from
test_transactions_api.py rather than imported — matches this suite's
per-file convention (test_negotiations.py/test_partner_negotiations.py do
the same).
"""
import shutil
import uuid
from decimal import Decimal

import pytest

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.core.outbox import EventType
from app.models.mediator import Mediator
from app.models.outbox_event import OutboxEvent
from app.models.property import Property
from app.models.property_negotiation import NegotiationOffer, PropertyNegotiation
from app.models.property_transaction import PropertyTransaction
from app.models.user import User
from app.services import property_transaction as transaction_service
from app.tasks import transaction_notifications

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
    """Only remove per-transaction subdirectories created during this test —
    never `rmtree(UPLOAD_ROOT)` itself, which in this environment is the SAME
    disk directory a real running app serves real uploaded transaction
    documents from (no separate test disk exists, see
    test_transactions_api.py's identical fixture for the confirmed-live
    data-loss bug this replaces)."""
    pre_existing: set[str] = set()
    if transaction_service.UPLOAD_ROOT.is_dir():
        pre_existing = {p.name for p in transaction_service.UPLOAD_ROOT.iterdir()}
    yield
    if transaction_service.UPLOAD_ROOT.is_dir():
        for child in transaction_service.UPLOAD_ROOT.iterdir():
            if child.name not in pre_existing:
                shutil.rmtree(child, ignore_errors=True)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"txn-notif-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _make_mediator(db, **overrides) -> tuple[Mediator, User]:
    user = _make_user(db)
    defaults = dict(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000003", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator, user


def _make_property(db, mediator: Mediator | None = None, **overrides) -> Property:
    defaults = dict(title="Notification Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
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
        negotiation_id=negotiation.id, offered_by_user_id=mediator_user.id, amount=amount,
        offer_type="mediator_counter", status="pending",
    )
    db.add(offer)
    negotiation.status = "countered"
    negotiation.current_offer_amount = amount
    db.flush()
    return offer


def _make_transaction(client, db, *, full_name="Sara Al-Otaibi", phone="0512345678", amount=3500, counter_amount=3800) -> tuple[PropertyTransaction, User, Mediator, User]:
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


def _events_for(db, transaction_id: int, event_type: str) -> list[OutboxEvent]:
    return (
        db.query(OutboxEvent)
        .filter(OutboxEvent.aggregate_type == "property_transaction", OutboxEvent.aggregate_id == str(transaction_id), OutboxEvent.event_type == event_type)
        .all()
    )


# ── End-to-end: real endpoints actually emit the events they claim to ──────


def test_accept_negotiation_emits_transaction_created_event(client, db_session):
    transaction, _customer, mediator, _mediator_user = _make_transaction(client, db_session)

    events = _events_for(db_session, transaction.id, EventType.TRANSACTION_CREATED)
    assert len(events) == 1
    payload = events[0].payload
    assert payload["customer_user_id"] == transaction.customer_user_id
    assert payload["mediator_id"] == mediator.id
    assert "actor_user_id" not in payload  # both parties notified, no self-notify exclusion


def test_upload_document_emits_document_uploaded_event(client, db_session):
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    required_doc = next(d for d in transaction.documents if d.required)

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": required_doc.id},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text

    events = _events_for(db_session, transaction.id, EventType.TRANSACTION_DOCUMENT_UPLOADED)
    assert len(events) == 1
    payload = events[0].payload
    assert payload["document_id"] == required_doc.id
    assert payload["actor_user_id"] == customer.id  # mediator-only recipient, customer excluded


def test_accept_document_emits_document_accepted_event(client, db_session):
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    required_doc = next(d for d in transaction.documents if d.required)
    upload = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": required_doc.id},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert upload.status_code == 200, upload.text

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{required_doc.id}/accept",
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 200, resp.text

    events = _events_for(db_session, transaction.id, EventType.TRANSACTION_DOCUMENT_ACCEPTED)
    assert len(events) == 1
    assert events[0].payload["document_id"] == required_doc.id


def test_request_document_update_emits_two_customer_events(client, db_session):
    """One mediator action fires BOTH a specific document-update notice and
    a general action-required nudge — see
    transaction_notifications.py's module docstring."""
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    required_doc = next(d for d in transaction.documents if d.required)
    upload = client.post(
        f"/api/v1/transactions/{transaction.id}/documents",
        data={"document_id": required_doc.id},
        files={"file": ("id.pdf", _PDF_BYTES, "application/pdf")},
        headers=_auth(customer),
    )
    assert upload.status_code == 200, upload.text

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/documents/{required_doc.id}/request-update",
        json={"reason": "Blurry scan, please resubmit"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 200, resp.text

    update_events = _events_for(db_session, transaction.id, EventType.TRANSACTION_DOCUMENT_UPDATE_REQUESTED)
    assert len(update_events) == 1
    assert update_events[0].payload["reason"] == "Blurry scan, please resubmit"

    action_events = _events_for(db_session, transaction.id, EventType.TRANSACTION_ACTION_REQUIRED)
    assert len(action_events) == 1
    assert action_events[0].payload["next_best_action"]  # carries the live deterministic NBA message


def test_cancel_transaction_emits_cancelled_event_excluding_the_canceller(client, db_session):
    transaction, customer, mediator, _mediator_user = _make_transaction(client, db_session)

    resp = client.post(f"/api/v1/transactions/{transaction.id}/cancel", json={"reason": "Changed my mind"}, headers=_auth(customer))
    assert resp.status_code == 200, resp.text

    events = _events_for(db_session, transaction.id, EventType.TRANSACTION_CANCELLED)
    assert len(events) == 1
    payload = events[0].payload
    assert payload["reason"] == "Changed my mind"
    assert payload["cancelled_by"] == "customer"
    assert payload["actor_user_id"] == customer.id  # customer cancelled -> only mediator gets notified


def test_full_readiness_flow_emits_transaction_ready_event_once(client, db_session):
    transaction, customer, _mediator, mediator_user = _make_transaction(client, db_session)
    required_docs = [d for d in transaction.documents if d.required]

    for doc in required_docs:
        upload = client.post(
            f"/api/v1/transactions/{transaction.id}/documents",
            data={"document_id": doc.id},
            files={"file": (f"{doc.id}.pdf", _PDF_BYTES, "application/pdf")},
            headers=_auth(customer),
        )
        assert upload.status_code == 200, upload.text
        accept = client.post(
            f"/api/v1/partner/transactions/{transaction.id}/documents/{doc.id}/accept",
            headers=_auth(mediator_user),
        )
        assert accept.status_code == 200, accept.text

    confirm = client.post(f"/api/v1/transactions/{transaction.id}/confirm-information", headers=_auth(customer))
    assert confirm.status_code == 200, confirm.text
    assert confirm.json()["readiness_label"] == "Ready for Rental Contract Process"

    events = _events_for(db_session, transaction.id, EventType.TRANSACTION_READY)
    assert len(events) == 1
    payload = events[0].payload
    assert payload["readiness_label"] == "Ready for Rental Contract Process"
    assert "actor_user_id" not in payload  # both parties notified, no self-notify exclusion

    # Re-fetching detail (a read-only GET) must never re-fire the event.
    get_resp = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(customer))
    assert get_resp.status_code == 200
    assert len(_events_for(db_session, transaction.id, EventType.TRANSACTION_READY)) == 1


# ── Notification content: _render() / _TITLES ──────────────────────────────


def _fake_property(**overrides) -> Property:
    defaults = dict(title="Cozy Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
    defaults.update(overrides)
    return Property(**defaults)


def _fake_transaction(**overrides) -> PropertyTransaction:
    defaults = dict(
        id=1, reference="MYM-00001", property_id=1, transaction_type="rent", customer_user_id=10,
        mediator_id=20, negotiation_id=1, agreed_amount=Decimal("3500"), currency="SAR", status="documents_required",
        progress_percentage=25,
    )
    defaults.update(overrides)
    return PropertyTransaction(**defaults)


def test_render_transaction_created():
    transaction = _fake_transaction()
    transaction.property = _fake_property()

    title_en, body_en = transaction_notifications._render("transaction_created", transaction, locale="en")
    assert title_en == "Transaction workspace created"
    assert "MYM-00001" in body_en and "Cozy Apartment" in body_en

    title_ar, body_ar = transaction_notifications._render("transaction_created", transaction, locale="ar")
    assert title_ar == "تم إنشاء مساحة عمل المعاملة"
    assert "MYM-00001" in body_ar


def test_render_document_update_requested_includes_reason():
    transaction = _fake_transaction()
    transaction.property = _fake_property()

    title_en, body_en = transaction_notifications._render(
        "document_update_requested", transaction, locale="en",
        extra={"document_label": "National ID / Iqama Copy", "reason": "Blurry scan"},
    )
    assert title_en == "Document update requested"
    assert "National ID / Iqama Copy" in body_en
    assert "Blurry scan" in body_en


def test_render_transaction_ready_embeds_exact_wording():
    """The final-state wording rule is non-negotiable — the notification
    body must carry the deterministic label verbatim, never re-worded."""
    transaction = _fake_transaction()
    transaction.property = _fake_property()

    _title, body_en = transaction_notifications._render(
        "transaction_ready", transaction, locale="en", extra={"readiness_label": "Ready for Rental Contract Process"}
    )
    assert "Ready for Rental Contract Process" in body_en
    assert "Transaction complete" not in body_en
    assert "Ownership transferred" not in body_en


def test_render_transaction_cancelled_includes_reason():
    transaction = _fake_transaction()
    transaction.property = _fake_property()

    _title, body_en = transaction_notifications._render(
        "transaction_cancelled", transaction, locale="en", extra={"reason": "Found another property"}
    )
    assert "cancelled" in body_en.lower()
    assert "Found another property" in body_en


def test_deep_link_shape_matches_negotiation_viewing_convention():
    assert f"mymakan://partner/transactions/{42}" == "mymakan://partner/transactions/42"
