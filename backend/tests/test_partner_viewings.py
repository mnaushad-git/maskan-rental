"""Visit & Viewing Management — partner portal backend (Prompt 4). Mirrors
test_partner_quality_api.py's ownership-check structure: every endpoint is
mediator-authenticated and scoped to the mediator's own properties'
viewings, 404 for an unknown id, 403 "Not your listing" for someone else's.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.api.routes.auth import create_access_token
from app.core.config import settings
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_viewing import PropertyViewing
from app.models.user import User

pytestmark = pytest.mark.skipif(
    not settings.FEATURE_VISIT_MANAGEMENT,
    reason="partner_viewings.router isn't registered when FEATURE_VISIT_MANAGEMENT is off",
)


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"pv-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x", full_name="Test Customer", phone="0511111111")
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
    defaults = dict(title="Partner Viewing Test Property", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0)
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


def _make_viewing(db, prop: Property, customer: User, mediator: Mediator, **overrides) -> PropertyViewing:
    start = overrides.pop("requested_start_at", _future())
    defaults = dict(
        property_id=prop.id,
        customer_user_id=customer.id,
        mediator_id=mediator.id,
        requested_start_at=start,
        requested_end_at=start + timedelta(minutes=30),
        timezone="Asia/Riyadh",
        status="requested",
    )
    defaults.update(overrides)
    viewing = PropertyViewing(**defaults)
    db.add(viewing)
    db.flush()
    return viewing


def test_confirm_from_requested(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    resp = client.post(f"/api/v1/partner/viewings/{viewing.id}/confirm", json={}, headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "confirmed"
    assert body["confirmed_start_at"] is not None


def test_confirm_accepting_customer_counter_proposal(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    proposed_start = _future(96)
    viewing = _make_viewing(
        db_session, prop, customer, mediator,
        status="reschedule_proposed", proposed_by="customer",
        proposed_start_at=proposed_start, proposed_end_at=proposed_start + timedelta(minutes=30),
    )
    db_session.commit()

    resp = client.post(f"/api/v1/partner/viewings/{viewing.id}/confirm", json={}, headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "confirmed"
    confirmed_start = datetime.fromisoformat(body["confirmed_start_at"].replace("Z", "+00:00"))
    assert abs((confirmed_start - proposed_start).total_seconds()) < 1  # confirmed at the customer's proposed time, not the original requested time


def test_propose_time_by_mediator(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    new_start = _future(96)
    resp = client.post(
        f"/api/v1/partner/viewings/{viewing.id}/propose-time",
        json={"start_at": new_start.isoformat(), "end_at": (new_start + timedelta(minutes=30)).isoformat(), "note": "Can we do this time instead?"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "reschedule_proposed"
    assert body["proposed_by"] == "mediator"


def test_propose_time_by_mediator_rejects_past_time(client, db_session):
    """§22 gap found in Prompt 13: propose-time must enforce the same
    future-time rule on the mediator side too."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    past_start = datetime.now(timezone.utc) - timedelta(hours=2)
    resp = client.post(
        f"/api/v1/partner/viewings/{viewing.id}/propose-time",
        json={"start_at": past_start.isoformat(), "end_at": (past_start + timedelta(minutes=30)).isoformat()},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 422


def test_cancel_with_mediator_reason(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    resp = client.post(
        f"/api/v1/partner/viewings/{viewing.id}/cancel",
        json={"reason": "Schedule conflict"},
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "cancelled_by_mediator"
    assert body["cancellation_reason"] == "Schedule conflict"


def test_cancel_rejects_unknown_mediator_reason(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    resp = client.post(
        f"/api/v1/partner/viewings/{viewing.id}/cancel",
        json={"reason": "Plans changed"},  # a customer reason, not a mediator one
        headers=_auth(mediator_user),
    )
    assert resp.status_code == 422


def test_complete_only_from_confirmed(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)

    still_requested = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()
    rejected = client.post(f"/api/v1/partner/viewings/{still_requested.id}/complete", headers=_auth(mediator_user))
    assert rejected.status_code == 409

    confirmed = _make_viewing(db_session, prop, customer, mediator, status="confirmed", confirmed_start_at=_future(), confirmed_end_at=_future() + timedelta(minutes=30))
    db_session.commit()
    ok = client.post(f"/api/v1/partner/viewings/{confirmed.id}/complete", headers=_auth(mediator_user))
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "completed"


def test_no_show_for_both_parties(client, db_session):
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session)

    v1 = _make_viewing(db_session, prop, customer, mediator, status="confirmed", confirmed_start_at=_future(), confirmed_end_at=_future() + timedelta(minutes=30))
    db_session.commit()
    resp1 = client.post(f"/api/v1/partner/viewings/{v1.id}/no-show", json={"who": "customer"}, headers=_auth(mediator_user))
    assert resp1.status_code == 200, resp1.text
    assert resp1.json()["status"] == "no_show_customer"

    v2 = _make_viewing(db_session, prop, customer, mediator, status="confirmed", confirmed_start_at=_future(), confirmed_end_at=_future() + timedelta(minutes=30))
    db_session.commit()
    resp2 = client.post(f"/api/v1/partner/viewings/{v2.id}/no-show", json={"who": "mediator"}, headers=_auth(mediator_user))
    assert resp2.status_code == 200, resp2.text
    assert resp2.json()["status"] == "no_show_mediator"


def test_403_when_mediator_does_not_own_property(client, db_session):
    owner_mediator, owner_user = _make_mediator(db_session)
    other_mediator, other_user = _make_mediator(db_session)
    prop = _make_property(db_session, owner_mediator)
    customer = _make_user(db_session)
    viewing = _make_viewing(db_session, prop, customer, owner_mediator)
    db_session.commit()

    resp = client.post(f"/api/v1/partner/viewings/{viewing.id}/confirm", json={}, headers=_auth(other_user))
    assert resp.status_code == 403

    resp_get = client.get(f"/api/v1/partner/viewings/{viewing.id}", headers=_auth(other_user))
    assert resp_get.status_code == 403


def test_partner_viewing_exposes_customer_contact_matching_lead_privacy_bar(client, db_session):
    """LeadSummaryOut/LeadDetailOut already expose an assigned mediator the
    customer's full name/phone/email (backend/app/schemas/lead.py) — a
    mediator viewing their OWN property's viewing request is gated the same
    way (ownership check), so matching that bar (not exceeding it) is
    correct, not a leak."""
    mediator, mediator_user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator)
    customer = _make_user(db_session, full_name="Jane Renter", phone="0522222222")
    viewing = _make_viewing(db_session, prop, customer, mediator)
    db_session.commit()

    resp = client.get(f"/api/v1/partner/viewings/{viewing.id}", headers=_auth(mediator_user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["customer_name"] == "Jane Renter"
    assert body["customer_phone"] == "0522222222"
    assert body["customer_email"] == customer.email

    # The customer-facing schema (viewings.py, not partner_viewings.py) must
    # NOT declare customer contact fields at all — sanity check that
    # PropertyViewingOut (not PartnerPropertyViewingOut) is what the
    # customer-side router actually returns.
    from app.schemas.property_viewing import PropertyViewingOut
    assert "customer_name" not in PropertyViewingOut.model_fields
