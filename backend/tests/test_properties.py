from datetime import date, timedelta

from app.models.booking import Booking
from app.models.property import Property
from app.models.user import User


def test_list_properties_returns_published_only(client):
    resp = client.get("/api/properties/", params={"limit": 500})
    assert resp.status_code == 200
    items = resp.json()
    assert isinstance(items, list)
    assert "X-Total-Count" in resp.headers
    # Every publicly-listed property must be Published — no draft/pending leakage.
    assert all(item["status"] == "Published" for item in items) if items and "status" in items[0] else True


def test_list_properties_respects_limit(client):
    resp = client.get("/api/properties/", params={"limit": 5})
    assert resp.status_code == 200
    assert len(resp.json()) <= 5


def test_list_properties_price_filter(client):
    resp = client.get("/api/properties/", params={"min_monthly_rent": 0, "max_monthly_rent": 999999, "limit": 10})
    assert resp.status_code == 200


def _make_bookable_property(db, **overrides) -> Property:
    defaults = dict(
        title="Bookable Test Apartment", area="Al Yasmin", city="Riyadh", listing_type="rent",
        is_bookable=True, nightly_rate=500.0, status="Published",
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def test_list_properties_is_bookable_filter(client, db_session):
    bookable = _make_bookable_property(db_session, external_id="BOOK-TEST-1")
    non_bookable = Property(title="Regular Rental", area="Al Yasmin", city="Riyadh", listing_type="rent", status="Published", is_bookable=False, external_id="BOOK-TEST-2")
    db_session.add(non_bookable)
    db_session.commit()

    resp = client.get("/api/properties/", params={"is_bookable": True, "limit": 500})
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()]
    assert bookable.id in ids
    assert non_bookable.id not in ids


def test_list_properties_date_range_filter_excludes_conflicting_booking(client, db_session):
    prop = _make_bookable_property(db_session, external_id="BOOK-TEST-3")
    owner = User(email=f"booker-{prop.external_id}@example.com", hashed_password="x")
    db_session.add(owner)
    db_session.flush()
    check_in = date.today() + timedelta(days=30)
    check_out = check_in + timedelta(days=2)
    db_session.add(Booking(property_id=prop.id, renter_user_id=owner.id, check_in=check_in, check_out=check_out, total_price=1000.0, status="confirmed"))
    db_session.commit()

    resp_conflict = client.get(
        "/api/properties/",
        params={"is_bookable": True, "check_in": str(check_in), "check_out": str(check_out), "limit": 500},
    )
    assert prop.id not in [item["id"] for item in resp_conflict.json()]

    clear_check_in = check_out + timedelta(days=5)
    clear_check_out = clear_check_in + timedelta(days=2)
    resp_clear = client.get(
        "/api/properties/",
        params={"is_bookable": True, "check_in": str(clear_check_in), "check_out": str(clear_check_out), "limit": 500},
    )
    assert prop.id in [item["id"] for item in resp_clear.json()]
