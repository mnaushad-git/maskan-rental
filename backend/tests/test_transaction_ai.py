"""AI Transaction Assistant (Prompt 6). See
docs/implementation/mymakan-transaction-workspace.md. Service-level tests
build a real `PropertyTransaction` via the HTTP accept path (same
`_make_transaction()` helper as test_transactions_api.py, duplicated per
this suite's own per-file convention) so grounding assertions exercise the
real checklist/documents/property/terms data, not a hand-built stub. A
small HTTP-level section at the bottom verifies both routers'
(`transactions.py` / `partner_transactions.py`) wiring end-to-end.
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
from app.models.property_transaction import PropertyTransaction
from app.models.user import User
from app.services import property_transaction as transaction_service
from app.services import transaction_ai
from app.services.transaction_ai import InvalidQuickAction

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_NEGOTIATIONS,
    reason="transactions.router isn't registered when FEATURE_NEGOTIATIONS is off",
)

_PDF_BYTES = b"%PDF-1.4 fake content for tests"


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
    defaults = dict(email=f"txn-ai-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _make_mediator(db, **overrides) -> tuple[Mediator, User]:
    user = _make_user(db)
    defaults = dict(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000004", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator, user


def _make_property(db, mediator: Mediator | None = None, **overrides) -> Property:
    defaults = dict(title="AI Assistant Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
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


# ── generate_response: grounding ────────────────────────────────────────────


def test_customer_grounding_includes_own_facts_only(client, db_session, monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="You still need to upload your ID and income proof.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    result = transaction_ai.generate_response(transaction, actor_role="customer", quick_action="whats_missing", language="en", user_id=None)

    assert result.generated_by == "ai"
    content = captured["content"]
    assert transaction.reference in content
    assert "AI Assistant Test Property" in content
    assert "National ID / Iqama Copy" in content
    assert "3,800" in content  # agreed amount (the accepted mediator counter)
    assert "What's missing?" in content
    assert "Sara Al-Otaibi" in content  # customer's own name is fine on the customer side
    assert "0512345678" in content


def test_mediator_grounding_excludes_customer_contact_info(client, db_session, monkeypatch):
    captured = {}

    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        captured["content"] = messages[0]["content"]
        return gateway.ChatResult(reply="One required document is still pending your review.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session, full_name="Sara Al-Otaibi", phone="0512345678")

    result = transaction_ai.generate_response(transaction, actor_role="mediator", quick_action="whats_blocking", language="en", user_id=None)

    assert result.generated_by == "ai"
    content = captured["content"]
    assert "Sara Al-Otaibi" in content  # name only, matches PartnerTransactionCustomerOut's own privacy bar
    assert "0512345678" not in content
    assert "@" not in content  # no email either
    assert "What's blocking this transaction?" in content


def test_invalid_quick_action_for_role_raises(client, db_session):
    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    with pytest.raises(InvalidQuickAction):
        transaction_ai.generate_response(transaction, actor_role="customer", quick_action="draft_update_request", language="en")

    with pytest.raises(InvalidQuickAction):
        transaction_ai.generate_response(transaction, actor_role="mediator", quick_action="whats_next", language="en")


def test_ai_failure_falls_back_and_never_raises(client, db_session, monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI unavailable")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    result = transaction_ai.generate_response(transaction, actor_role="customer", quick_action="summarize", language="en")

    assert result.generated_by == "fallback"
    assert result.reply
    assert transaction.reference in result.reply


def test_generate_response_never_mutates_transaction(client, db_session, monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(reply="Here is a summary of your transaction.", input_tokens=5, output_tokens=5)

    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)
    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    status_before = transaction.status
    progress_before = transaction.progress_percentage
    updated_at_before = transaction.updated_at

    transaction_ai.generate_response(transaction, actor_role="customer", quick_action="summarize", language="en")

    assert transaction.status == status_before
    assert transaction.progress_percentage == progress_before
    assert transaction.updated_at == updated_at_before
    assert not db_session.is_modified(transaction)


# ── HTTP wiring: both routers ────────────────────────────────────────────────


def test_customer_ai_assistant_endpoint_returns_reply(client, db_session, monkeypatch):
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: gateway.ChatResult(reply="Upload your remaining documents next.", input_tokens=5, output_tokens=5))
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "whats_next", "language": "en"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "ai"
    assert body["quick_action"] == "whats_next"
    assert body["reply"] == "Upload your remaining documents next."


def test_customer_ai_assistant_rejects_mediator_only_quick_action(client, db_session):
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "draft_update_request", "language": "en"},
        headers=_auth(customer),
    )
    assert resp.status_code == 422


def test_customer_ai_assistant_cross_customer_denied(client, db_session):
    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    other = _make_user(db_session)
    db_session.commit()

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "summarize", "language": "en"},
        headers=_auth(other),
    )
    assert resp.status_code == 403


def test_customer_ai_assistant_falls_back_on_ai_failure(client, db_session, monkeypatch):
    def _raise(**kwargs):
        raise RuntimeError("AI down")

    monkeypatch.setattr(gateway, "run_chat", _raise)
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "summarize", "language": "en"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "fallback"
    assert body["reply"]


def test_mediator_ai_assistant_endpoint_returns_reply(client, db_session, monkeypatch):
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: gateway.ChatResult(reply="Two documents are still awaiting your review.", input_tokens=5, output_tokens=5))
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "summarize_outstanding", "language": "en"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["generated_by"] == "ai"
    assert body["quick_action"] == "summarize_outstanding"


def test_mediator_ai_assistant_rejects_customer_only_quick_action(client, db_session):
    transaction, _customer, _mediator, mediator_user = _make_transaction(client, db_session)

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "what_to_ask_mediator", "language": "en"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 422


def test_mediator_ai_assistant_cross_mediator_denied(client, db_session):
    transaction, _customer, _mediator, _mediator_user = _make_transaction(client, db_session)
    other_mediator, other_mediator_user = _make_mediator(db_session)
    db_session.commit()

    resp = client.post(
        f"/api/v1/partner/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "whats_blocking", "language": "en"},
        headers=_auth(other_mediator_user),
    )
    assert resp.status_code == 403


def test_ai_assistant_rejects_unknown_language(client, db_session):
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "summarize", "language": "fr"},
        headers=_auth(customer),
    )
    assert resp.status_code == 422


def test_ai_assistant_never_mutates_transaction_state(client, db_session, monkeypatch):
    monkeypatch.setattr(gateway, "run_chat", lambda **kwargs: gateway.ChatResult(reply="Summary text.", input_tokens=5, output_tokens=5))
    transaction, customer, _mediator, _mediator_user = _make_transaction(client, db_session)

    before = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(customer)).json()

    resp = client.post(
        f"/api/v1/transactions/{transaction.id}/ai-assistant",
        json={"quick_action": "summarize", "language": "en"},
        headers=_auth(customer),
    )
    assert resp.status_code == 200, resp.text

    after = client.get(f"/api/v1/transactions/{transaction.id}", headers=_auth(customer)).json()
    assert after["status"] == before["status"]
    assert after["progress_percentage"] == before["progress_percentage"]
    assert after["checklist"] == before["checklist"]
