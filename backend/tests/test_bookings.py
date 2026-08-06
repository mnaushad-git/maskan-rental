"""Short-term stay booking data layer (session A): availability check, booking
creation, DB-level overlap prevention, and property/user listing. Follows this
suite's conventions (see test_property_requests.py): ORM-level fixtures for
setup, HTTP-level tests via `client` for API behavior.
"""
from datetime import date, timedelta

from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User


def _signup(client, email) -> str:
    resp = client.post("/api/auth/signup", json={"email": email, "password": "S3cret!23"})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_property(db, **overrides) -> Property:
    defaults = dict(title="Test Chalet", area="Al Yasmin", city="Riyadh", listing_type="rent", monthly_rent=60000.0, bedrooms=3, bathrooms=2, status="Published", property_type="apartment")
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _make_mediator(db, email, **overrides) -> Mediator:
    owner = User(email=email, hashed_password="x")
    db.add(owner)
    db.flush()
    defaults = dict(user_id=owner.id, license_number=f"LIC-{email}", phone="+966500000000", subscription_status="active", is_verified=True)
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    return mediator


D0 = date.today() + timedelta(days=30)


def test_availability_true_when_no_bookings(client, db_session, unique_email):
    prop = _make_property(db_session)
    db_session.commit()

    resp = client.get("/api/bookings/availability", params={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=3)),
    })
    assert resp.status_code == 200
    assert resp.json()["available"] is True


def test_availability_rejects_bad_range(client, db_session):
    prop = _make_property(db_session)
    db_session.commit()

    resp = client.get("/api/bookings/availability", params={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0),
    })
    assert resp.status_code == 400


def test_create_booking_requires_auth(client, db_session):
    prop = _make_property(db_session)
    db_session.commit()

    resp = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=2)),
        "total_price": 1500,
    })
    assert resp.status_code == 401


def test_create_and_fetch_booking(client, db_session, unique_email):
    prop = _make_property(db_session)
    db_session.commit()
    token = _signup(client, unique_email)

    resp = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=2)),
        "total_price": 1500,
    }, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "confirmed"
    assert body["property_id"] == prop.id

    mine = client.get("/api/bookings/my", headers=_auth(token))
    assert mine.status_code == 200
    assert len(mine.json()) == 1
    assert mine.json()[0]["id"] == body["id"]


def test_overlapping_booking_rejected(client, db_session, unique_email):
    prop = _make_property(db_session)
    db_session.commit()
    token = _signup(client, unique_email)

    first = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=5)),
        "total_price": 3000,
    }, headers=_auth(token))
    assert first.status_code == 201, first.text

    # overlaps the middle of the first booking's range
    overlapping = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0 + timedelta(days=2)),
        "check_out": str(D0 + timedelta(days=7)),
        "total_price": 3000,
    }, headers=_auth(token))
    assert overlapping.status_code == 409

    availability = client.get("/api/bookings/availability", params={
        "property_id": prop.id,
        "check_in": str(D0 + timedelta(days=2)),
        "check_out": str(D0 + timedelta(days=7)),
    })
    assert availability.json()["available"] is False


def test_adjacent_booking_allowed(client, db_session, unique_email):
    """Checkout day == next check-in day is not an overlap (half-open range)."""
    prop = _make_property(db_session)
    db_session.commit()
    token = _signup(client, unique_email)

    first = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=3)),
        "total_price": 1800,
    }, headers=_auth(token))
    assert first.status_code == 201

    adjacent = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0 + timedelta(days=3)),
        "check_out": str(D0 + timedelta(days=6)),
        "total_price": 1800,
    }, headers=_auth(token))
    assert adjacent.status_code == 201, adjacent.text


def test_cancelled_booking_frees_the_dates(client, db_session, unique_email):
    prop = _make_property(db_session)
    db_session.commit()
    token = _signup(client, unique_email)

    booking = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=3)),
        "total_price": 1800,
    }, headers=_auth(token)).json()

    cancel = client.post(f"/api/bookings/{booking['id']}/cancel", headers=_auth(token))
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "cancelled"

    again = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=3)),
        "total_price": 1900,
    }, headers=_auth(token))
    assert again.status_code == 201, again.text


def test_property_bookings_blocked_for_non_owner(client, db_session, unique_email):
    mediator = _make_mediator(db_session, f"mediator-{unique_email}")
    prop = _make_property(db_session, mediator_id=mediator.id)
    db_session.commit()

    renter_token = _signup(client, unique_email)
    created = client.post("/api/bookings/", json={
        "property_id": prop.id,
        "check_in": str(D0),
        "check_out": str(D0 + timedelta(days=2)),
        "total_price": 1200,
    }, headers=_auth(renter_token))
    assert created.status_code == 201

    stranger_token = _signup(client, f"stranger-{unique_email}")
    forbidden = client.get(f"/api/bookings/property/{prop.id}", headers=_auth(stranger_token))
    assert forbidden.status_code == 403
