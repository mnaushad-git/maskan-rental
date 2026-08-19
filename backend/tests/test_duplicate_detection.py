"""Duplicate Awareness service (`app.services.duplicate_detection`) — true
and false cases for each independent signal, confidence-band mapping, and
the `GET /properties/{id}/duplicate-check` HTTP endpoint. No auto-merge/
delete anywhere — this only ever returns matches + reasons for a human to
review.
"""
import uuid

from app.models.listing_image import ListingImage
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User
from app.services.duplicate_detection import find_possible_duplicates


def _city() -> str:
    return f"DupCity-{uuid.uuid4().hex[:8]}"


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Duplicate Test Property", area="Al Yasmin", city="DupCity", listing_type="rent",
        status="Published", bedrooms=3, bathrooms=2, size_sq_m=150, property_type="Apartment",
        monthly_rent=6000.0,
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    db.commit()
    return prop


def _make_mediator(db) -> Mediator:
    user = User(email=f"dup-med-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    db.add(user)
    db.flush()
    mediator = Mediator(user_id=user.id, license_number="LIC-DUP", phone="0500000002", subscription_status="active")
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    return mediator


def test_no_duplicate_when_nothing_matches(db_session):
    city = _city()
    subject = _make_property(db_session, city=city)
    _make_property(db_session, city=city, area="A Totally Different Area", bedrooms=1, bathrooms=1, size_sq_m=40, monthly_rent=1500.0)

    result = find_possible_duplicates(db_session, subject)
    assert result.is_possible_duplicate is False
    assert result.confidence == "none"
    assert result.matches == []


def test_same_mediator_location_characteristics_flagged(db_session):
    city = _city()
    mediator = _make_mediator(db_session)
    subject = _make_property(db_session, city=city, mediator_id=mediator.id)
    other = _make_property(
        db_session, city=city, mediator_id=mediator.id, area=subject.area,
        bedrooms=subject.bedrooms, bathrooms=subject.bathrooms, property_type=subject.property_type,
        title="Nearly the same listing",
    )

    result = find_possible_duplicates(db_session, subject)
    assert result.confidence in ("medium", "high")
    assert result.is_possible_duplicate is True
    assert any(m.property_id == other.id for m in result.matches)
    assert any("Same mediator, location, and property characteristics" in r for r in result.reasons)


def test_shared_image_url_flagged(db_session):
    city = _city()
    subject = _make_property(db_session, city=city)
    other = _make_property(db_session, city=city, area="Somewhere Else", bedrooms=5, size_sq_m=500, monthly_rent=99999.0)

    subject.listing_images = [ListingImage(url="https://example.com/shared-photo.jpg", display_order=0)]
    other.listing_images = [ListingImage(url="https://example.com/shared-photo.jpg", display_order=0)]
    db_session.commit()
    db_session.refresh(subject)

    result = find_possible_duplicates(db_session, subject)
    assert any(m.property_id == other.id for m in result.matches)
    assert any("identical listing photo" in r for m in result.matches for r in m.reasons)


def test_similar_price_size_beds_same_location_flagged(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, size_sq_m=150, monthly_rent=6000.0, bedrooms=3)
    other = _make_property(
        db_session, city=city, area=subject.area, bedrooms=3, size_sq_m=155, monthly_rent=6100.0,
        title="Very similar unit",
    )

    result = find_possible_duplicates(db_session, subject)
    assert any(m.property_id == other.id for m in result.matches)


def test_identical_description_flagged(db_session):
    city = _city()
    desc = "Spacious apartment near the park with a modern kitchen and two balconies."
    subject = _make_property(db_session, city=city, description=desc)
    other = _make_property(
        db_session, city=city, area="Different Area Entirely", bedrooms=1, size_sq_m=40,
        description=desc, title="Another listing",
    )

    result = find_possible_duplicates(db_session, subject)
    assert any(m.property_id == other.id for m in result.matches)
    assert any("description" in r for m in result.matches for r in m.reasons)


def test_different_listing_type_excluded_from_candidates(db_session):
    city = _city()
    subject = _make_property(db_session, city=city, listing_type="rent")
    _make_property(
        db_session, city=city, listing_type="sale", sale_price=600000.0, monthly_rent=None,
        area=subject.area, bedrooms=subject.bedrooms, bathrooms=subject.bathrooms, property_type=subject.property_type,
    )

    result = find_possible_duplicates(db_session, subject)
    assert result.matches == []


# ── HTTP endpoint ─────────────────────────────────────────────────────────

def test_duplicate_check_endpoint_shape(client, db_session):
    city = _city()
    subject = _make_property(db_session, city=city)

    resp = client.get(f"/api/v1/properties/{subject.id}/duplicate-check")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["confidence"] in ("none", "low", "medium", "high")
    assert isinstance(body["is_possible_duplicate"], bool)
    assert isinstance(body["matches"], list)


def test_duplicate_check_endpoint_404_for_unknown_property(client):
    resp = client.get("/api/v1/properties/9999999/duplicate-check")
    assert resp.status_code == 404
