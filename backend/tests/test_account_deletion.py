"""Self-service account deletion (Google Play policy) — security and
data-integrity tests for POST /api/auth/me/delete and
GET /api/auth/me/deletion-eligibility (app/services/account_deletion.py)."""
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.api.routes.auth import create_access_token, hash_password
from app.models.audit_log import AuditLog
from app.models.booking import Booking
from app.models.device import Device
from app.models.lead import Lead
from app.models.mediator import Mediator
from app.models.notification import Notification
from app.models.property import Property
from app.models.property_negotiation import PropertyNegotiation
from app.models.property_transaction import PropertyTransaction
from app.models.property_viewing import PropertyViewing
from app.models.review import Review
from app.models.saved_property import SavedProperty
from app.models.saved_search import SavedSearch
from app.models.user import User

PASSWORD = "S3cret!23"
DELETE_URL = "/api/auth/me/delete"
ELIGIBILITY_URL = "/api/auth/me/deletion-eligibility"


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    # The per-user limiter is exercised in test_rate_limit; here it would make
    # the many deletion attempts in one module order-dependent.
    from app.core import rate_limit

    monkeypatch.setattr(rate_limit, "check_rate_limit",
                        lambda bucket, identifier, *, limit, window_seconds: rate_limit.RateLimitResult(True, limit, limit, 0))


def _user(db, **overrides) -> User:
    defaults = dict(email=f"del-{uuid.uuid4().hex[:10]}@example.com", hashed_password=hash_password(PASSWORD),
                    full_name="Delete Me", phone="0512345678")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _mediator(db) -> Mediator:
    owner = _user(db, full_name="Partner")
    m = Mediator(user_id=owner.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000001",
                 is_verified=True, subscription_status="active")
    db.add(m)
    db.flush()
    return m


def _property(db, mediator: Mediator | None = None) -> Property:
    p = Property(title="Deletion Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent",
                 status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0,
                 mediator_id=mediator.id if mediator else None)
    db.add(p)
    db.flush()
    return p


def _negotiation(db, user, prop, status="submitted") -> PropertyNegotiation:
    n = PropertyNegotiation(property_id=prop.id, customer_user_id=user.id, transaction_type="rent",
                            current_offer_amount=Decimal("3500"), original_listing_amount=Decimal("4000"), status=status)
    db.add(n)
    db.flush()
    return n


def _transaction(db, user, prop, status) -> PropertyTransaction:
    neg = _negotiation(db, user, prop, status="closed")
    t = PropertyTransaction(reference=f"T-{uuid.uuid4().hex[:8]}", property_id=prop.id, transaction_type="rent",
                            customer_user_id=user.id, negotiation_id=neg.id, agreed_amount=Decimal("3500"), status=status)
    db.add(t)
    db.flush()
    return t


def _lead(db, user, status) -> Lead:
    lead = Lead(customer_user_id=user.id, customer_name=user.full_name or "x", customer_phone=user.phone or "",
                customer_email=user.email, area_name="Al Yasmin", city="Riyadh", status=status)
    db.add(lead)
    db.flush()
    return lead


def _auth(user) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _delete(client, user, password=PASSWORD, confirmation="DELETE", headers=None):
    return client.post(DELETE_URL, json={"password": password, "confirmation": confirmation},
                       headers=headers or _auth(user))


# ── re-authentication & confirmation ──────────────────────────────────────

def test_requires_authentication(client):
    assert client.post(DELETE_URL, json={"password": PASSWORD, "confirmation": "DELETE"}).status_code == 401
    assert client.get(ELIGIBILITY_URL).status_code == 401


def test_wrong_password_is_403_not_401_and_changes_nothing(client, db_session):
    user = _user(db_session)
    email = user.email
    resp = _delete(client, user, password="wrong-password")
    # 401 would make the mobile client sign the user out on a typo.
    assert resp.status_code == 403
    db_session.refresh(user)
    assert user.is_active and user.deleted_at is None and user.email == email


def test_confirmation_phrase_required(client, db_session):
    user = _user(db_session)
    resp = _delete(client, user, confirmation="yes")
    assert resp.status_code == 422
    db_session.refresh(user)
    assert user.is_active


def test_cannot_delete_another_user(client, db_session):
    victim, attacker = _user(db_session), _user(db_session)
    # The endpoint has no user id — it always acts on the token's owner, and
    # the attacker's own password is checked against the attacker.
    resp = _delete(client, attacker, password=PASSWORD, headers=_auth(attacker))
    assert resp.status_code == 200
    db_session.refresh(victim)
    assert victim.is_active and victim.deleted_at is None


# ── successful deletion ───────────────────────────────────────────────────

def test_delete_revokes_tokens_and_anonymizes(client, db_session):
    user = _user(db_session, verification_document_ref="DOC-123", moyasar_card_token="tok",
                 subscription_status="active", subscription_tier="premium")
    token_headers = _auth(user)
    original_email = user.email

    assert client.get(ELIGIBILITY_URL, headers=token_headers).json() == {"eligible": True, "blockers": []}
    resp = _delete(client, user, headers=token_headers)
    assert resp.status_code == 200 and resp.json()["status"] == "deleted"

    # Session revocation: the previously issued token no longer works anywhere.
    assert client.get("/api/auth/me", headers=token_headers).status_code == 401

    db_session.refresh(user)
    assert user.is_active is False and user.deleted_at is not None
    assert user.email != original_email and user.email.endswith("@deleted.maskanai.invalid")
    assert user.full_name is None and user.phone is None
    assert user.verification_document_ref is None and user.moyasar_card_token is None
    assert user.subscription_status == "cancelled"

    # Old credentials can't log in; the email can be reused for a new account.
    assert client.post("/api/auth/login", json={"email": original_email, "password": PASSWORD}).status_code == 401
    assert client.post("/api/auth/signup", json={"email": original_email, "password": PASSWORD}).status_code == 201


def test_personal_rows_deleted_and_records_retained(client, db_session):
    user = _user(db_session)
    mediator = _mediator(db_session)
    prop = _property(db_session, mediator)
    db_session.add_all([
        Device(user_id=user.id, platform="android", push_token=f"ExponentPushToken[{uuid.uuid4().hex}]"),
        SavedProperty(user_id=user.id, property_id=prop.id),
        Notification(user_id=user.id, type="system", title="t", body="b"),
    ])
    db_session.flush()
    completed = _transaction(db_session, user, prop, status="completed")
    closed_lead = _lead(db_session, user, status="closed")
    past_booking = Booking(property_id=prop.id, renter_user_id=user.id, check_in=date.today() - timedelta(days=10),
                           check_out=date.today() - timedelta(days=5), status="confirmed", total_price=1000.0,
                           guest_name="Delete Me", guest_phone="0512345678")
    db_session.add(past_booking)
    review = Review(mediator_id=mediator.id, user_id=user.id, rating=5, comment="Great", reviewer_name="Delete Me")
    db_session.add(review)
    db_session.flush()
    users_before = db_session.scalar(select(func.count()).select_from(User))

    resp = _delete(client, user)
    assert resp.status_code == 200, resp.text

    def count(model, col):
        return db_session.scalar(select(func.count()).select_from(model).where(col == user.id))

    # Personal-only data is gone…
    assert count(Device, Device.user_id) == 0
    assert count(SavedProperty, SavedProperty.user_id) == 0
    assert count(Notification, Notification.user_id) == 0
    assert count(SavedSearch, SavedSearch.user_id) == 0
    # …the users row is kept (no cascade, no orphans)…
    assert db_session.scalar(select(func.count()).select_from(User)) == users_before
    # …retained records still point at it, unchanged.
    db_session.refresh(completed)
    assert completed.customer_user_id == user.id and completed.status == "completed"
    db_session.refresh(past_booking)
    # Bookings are financial records: retained unchanged (guest details included).
    assert past_booking.renter_user_id == user.id and past_booking.guest_name == "Delete Me"
    assert db_session.get(Property, prop.id) is not None
    assert db_session.get(Mediator, mediator.id) is not None
    # Contact snapshots / public author names anonymized.
    db_session.refresh(closed_lead)
    assert closed_lead.customer_user_id == user.id
    assert closed_lead.customer_name == "Deleted user" and closed_lead.customer_phone == ""
    assert "example.com" not in closed_lead.customer_email
    db_session.refresh(review)
    assert review.reviewer_name is None and review.rating == 5

    audit = db_session.scalar(select(AuditLog).where(AuditLog.action == "account.self_deleted",
                                                     AuditLog.entity_id == str(user.id)))
    assert audit is not None
    assert audit.extra_metadata["retained"]["transactions"] == 1
    # Financial records retained → identity snapshot kept for attribution (DECISION, see service).
    assert audit.extra_metadata["retained_identity"]["full_name"] == "Delete Me"


def test_no_identity_snapshot_without_financial_records(client, db_session):
    user = _user(db_session)
    assert _delete(client, user).status_code == 200
    audit = db_session.scalar(select(AuditLog).where(AuditLog.action == "account.self_deleted",
                                                     AuditLog.entity_id == str(user.id)))
    assert "retained_identity" not in audit.extra_metadata


def test_second_delete_with_old_token_rejected(client, db_session):
    user = _user(db_session)
    headers = _auth(user)
    assert _delete(client, user, headers=headers).status_code == 200
    assert _delete(client, user, headers=headers).status_code == 401


# ── blockers (unresolved obligations) ─────────────────────────────────────

def _assert_blocked(client, db_session, user, code):
    elig = client.get(ELIGIBILITY_URL, headers=_auth(user)).json()
    assert elig["eligible"] is False
    assert code in {b["code"] for b in elig["blockers"]}
    resp = _delete(client, user)
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]
    db_session.refresh(user)
    assert user.is_active and user.deleted_at is None and user.full_name == "Delete Me"


def test_blocked_by_active_transaction(client, db_session):
    user = _user(db_session)
    _transaction(db_session, user, _property(db_session), status="documents_required")
    _assert_blocked(client, db_session, user, "active_transactions")


def test_blocked_by_open_negotiation(client, db_session):
    user = _user(db_session)
    _negotiation(db_session, user, _property(db_session), status="countered")
    _assert_blocked(client, db_session, user, "active_negotiations")


def test_blocked_by_scheduled_viewing(client, db_session):
    user = _user(db_session)
    mediator = _mediator(db_session)
    start = datetime.now(timezone.utc) + timedelta(days=2)
    db_session.add(PropertyViewing(property_id=_property(db_session, mediator).id, customer_user_id=user.id,
                                   mediator_id=mediator.id, requested_start_at=start,
                                   requested_end_at=start + timedelta(minutes=30), timezone="Asia/Riyadh",
                                   status="confirmed"))
    db_session.flush()
    _assert_blocked(client, db_session, user, "upcoming_viewings")


def test_blocked_by_upcoming_booking(client, db_session):
    user = _user(db_session)
    db_session.add(Booking(property_id=_property(db_session).id, renter_user_id=user.id,
                           check_in=date.today() + timedelta(days=3), check_out=date.today() + timedelta(days=6),
                           status="confirmed", total_price=900.0))
    db_session.flush()
    _assert_blocked(client, db_session, user, "upcoming_bookings")


def test_blocked_by_open_lead(client, db_session):
    user = _user(db_session)
    _lead(db_session, user, status="in_progress")
    _assert_blocked(client, db_session, user, "open_leads")


def test_partner_account_blocked(client, db_session):
    user = _user(db_session)
    db_session.add(Mediator(user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000002"))
    db_session.flush()
    _assert_blocked(client, db_session, user, "partner_account")


def test_closed_obligations_do_not_block(client, db_session):
    user = _user(db_session)
    prop = _property(db_session)
    _negotiation(db_session, user, prop, status="withdrawn")
    _transaction(db_session, user, prop, status="cancelled")
    _lead(db_session, user, status="rejected")
    assert client.get(ELIGIBILITY_URL, headers=_auth(user)).json()["eligible"] is True
    assert _delete(client, user).status_code == 200


def test_admin_cannot_self_delete(client, db_session):
    admin = _user(db_session, is_admin=True)
    assert client.get(ELIGIBILITY_URL, headers=_auth(admin)).json()["eligible"] is False
    assert _delete(client, admin).status_code == 403
    db_session.refresh(admin)
    assert admin.is_active and admin.deleted_at is None


# ── admin-initiated deletion (DELETE /api/users/{id}) ─────────────────────

ADMIN_DELETE_URL = "/api/users/{}"


def test_admin_delete_uses_safeguards_and_preserves_history(client, db_session):
    admin = _user(db_session, is_admin=True)
    customer = _user(db_session)
    prop = _property(db_session)
    completed = _transaction(db_session, customer, prop, status="completed")
    db_session.add(SavedProperty(user_id=customer.id, property_id=prop.id))
    db_session.flush()
    customer_headers = _auth(customer)
    users_before = db_session.scalar(select(func.count()).select_from(User))

    resp = client.delete(ADMIN_DELETE_URL.format(customer.id), headers=_auth(admin))
    assert resp.status_code == 204, resp.text

    # Not hard-deleted: the row and the retained transaction remain (no cascade).
    assert db_session.scalar(select(func.count()).select_from(User)) == users_before
    db_session.refresh(customer)
    assert customer.is_active is False and customer.deleted_at is not None and customer.full_name is None
    db_session.refresh(completed)
    assert completed.customer_user_id == customer.id and completed.status == "completed"
    assert db_session.scalar(select(func.count()).select_from(SavedProperty)
                             .where(SavedProperty.user_id == customer.id)) == 0
    # The customer's sessions are revoked.
    assert client.get("/api/auth/me", headers=customer_headers).status_code == 401
    # Audited as admin-initiated, attributed to the admin — distinct from self-service.
    audit = db_session.scalar(select(AuditLog).where(AuditLog.entity_id == str(customer.id),
                                                     AuditLog.entity_type == "user"))
    assert audit.action == "account.admin_deleted"
    assert audit.user_id == admin.id
    assert audit.extra_metadata["initiated_by"] == "admin"
    assert audit.extra_metadata["admin_user_id"] == admin.id
    # Second delete of an already-deleted account is a 404, not a second anonymization.
    assert client.delete(ADMIN_DELETE_URL.format(customer.id), headers=_auth(admin)).status_code == 404


def test_self_service_audit_is_marked_self(client, db_session):
    user = _user(db_session)
    assert _delete(client, user).status_code == 200
    audit = db_session.scalar(select(AuditLog).where(AuditLog.entity_id == str(user.id),
                                                     AuditLog.entity_type == "user"))
    assert audit.action == "account.self_deleted" and audit.user_id == user.id
    assert audit.extra_metadata["initiated_by"] == "self" and "admin_user_id" not in audit.extra_metadata


def test_admin_delete_requires_admin(client, db_session):
    attacker, victim = _user(db_session), _user(db_session)
    assert client.delete(ADMIN_DELETE_URL.format(victim.id), headers=_auth(attacker)).status_code == 403
    assert client.delete(ADMIN_DELETE_URL.format(victim.id)).status_code == 401
    db_session.refresh(victim)
    assert victim.is_active and victim.deleted_at is None


def test_admin_delete_refused_while_obligations_open(client, db_session):
    admin, customer = _user(db_session, is_admin=True), _user(db_session)
    _transaction(db_session, customer, _property(db_session), status="under_review")
    resp = client.delete(ADMIN_DELETE_URL.format(customer.id), headers=_auth(admin))
    assert resp.status_code == 409 and "active_transactions" in resp.json()["detail"]
    db_session.refresh(customer)
    assert customer.is_active and customer.full_name == "Delete Me"


def test_admin_delete_refuses_partner_admin_self_and_unknown(client, db_session):
    admin, other_admin = _user(db_session, is_admin=True), _user(db_session, is_admin=True)
    mediator = _mediator(db_session)
    headers = _auth(admin)
    # Partner accounts: deleting would cascade into listings/leads → refused.
    assert client.delete(ADMIN_DELETE_URL.format(mediator.user_id), headers=headers).status_code == 409
    assert db_session.get(Mediator, mediator.id) is not None
    assert client.delete(ADMIN_DELETE_URL.format(other_admin.id), headers=headers).status_code == 403
    assert client.delete(ADMIN_DELETE_URL.format(admin.id), headers=headers).status_code == 403
    assert client.delete(ADMIN_DELETE_URL.format(10**9), headers=headers).status_code == 404
    db_session.refresh(other_admin)
    assert other_admin.is_active and other_admin.deleted_at is None
