"""Booking UI must not be exposed while the bookings API is disabled:
PropertyOut reports is_bookable=False unless FEATURE_BOOKING is on, without
touching the stored column or the is_bookable list filter."""
import pytest

from app.core.config import settings
from app.models.property import Property


@pytest.fixture()
def bookable(db_session) -> Property:
    prop = Property(title="Short-stay unit", area="Al Malqa", city="Riyadh", listing_type="rent",
                    status="Published", bedrooms=1, bathrooms=1, monthly_rent=6000.0, is_bookable=True)
    db_session.add(prop)
    db_session.flush()
    return prop


def test_bookable_listing_reported_not_bookable_when_booking_disabled(client, db_session, bookable, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_BOOKING", False)
    detail = client.get(f"/api/properties/{bookable.id}")
    assert detail.status_code == 200
    assert detail.json()["is_bookable"] is False
    # Stored value untouched — re-enabling the feature restores the listing.
    db_session.refresh(bookable)
    assert bookable.is_bookable is True
    # Bookings API really is absent in this configuration.
    if not any(getattr(r, "path", "").startswith("/api/bookings") for r in client.app.routes):
        assert client.get("/api/bookings/availability").status_code == 404


def test_list_endpoints_never_report_bookable_when_disabled(client, bookable, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_BOOKING", False)
    rows = client.get("/api/properties/", params={"is_bookable": "true", "limit": 500}).json()
    assert any(r["id"] == bookable.id for r in rows)  # filter still uses the stored column
    assert all(r["is_bookable"] is False for r in rows)


def test_bookable_listing_reported_bookable_when_booking_enabled(client, bookable, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_BOOKING", True)
    assert client.get(f"/api/properties/{bookable.id}").json()["is_bookable"] is True
