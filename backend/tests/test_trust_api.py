"""GET /properties/{id}/trust — response shape, component presence/omission
via the HTTP layer (unit coverage of assess_property_trust itself lives in
test_trust_assessment.py), and that `availability_confirmed_at` persists and
is actually read by the endpoint (Listing Freshness's "Recently Confirmed"
category, previously inert per Prompt 1 since the column didn't exist yet).
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User


def _city() -> str:
    return f"TrustCity-{uuid.uuid4().hex[:8]}"


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Trust Test Property", area="Test District", city="TrustCity", listing_type="rent",
        status="Published", bedrooms=3, bathrooms=2, size_sq_m=150, property_type="Apartment",
        furnished="Furnished", latitude=24.7, longitude=46.6, monthly_rent=6000.0,
        description="A lovely test apartment.", contact_phone="0500000000",
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    db.commit()
    return prop


def _make_mediator(db, **overrides) -> Mediator:
    user = User(email=f"trust-med-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    db.add(user)
    db.flush()
    defaults = dict(user_id=user.id, license_number="LIC-TRUST", phone="0500000001", is_verified=True, subscription_status="active")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    db.commit()
    return mediator


def test_trust_endpoint_shape_no_mediator(client, db_session):
    city = _city()
    subject = _make_property(db_session, city=city)

    resp = client.get(f"/api/v1/properties/{subject.id}/trust")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["property_id"] == subject.id
    assert 0 <= body["overall_score"] <= 100
    assert body["trust_level"] in ("High", "Good", "Moderate", "Limited Confidence")
    # Always-computable components present.
    assert body["component_scores"]["completeness"] is not None
    assert body["component_scores"]["consistency"] is not None
    assert body["component_scores"]["freshness"] is not None
    # No mediator on record -> mediator_trust omitted, never fabricated.
    assert body["component_scores"]["mediator_trust"] is None
    assert "mediator_trust" in body["omitted_components"]
    assert isinstance(body["positive_signals"], list)
    assert isinstance(body["missing_information"], list)
    assert isinstance(body["things_to_verify"], list)
    assert "No mediator is on record for this listing — verify details directly." in body["things_to_verify"]


def test_trust_endpoint_verified_mediator_present_and_grounded(client, db_session):
    city = _city()
    mediator = _make_mediator(db_session, is_verified=True)
    subject = _make_property(db_session, city=city, mediator_id=mediator.id)

    resp = client.get(f"/api/v1/properties/{subject.id}/trust")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    mt = body["component_scores"]["mediator_trust"]
    assert mt is not None
    assert mt["is_verified"] is True
    # The one allowed verification phrase, per the global wording constraint.
    assert "✓ Verified by myMakan" in body["positive_signals"]
    assert "Government Verified" not in " ".join(body["positive_signals"])
    assert "REGA" not in " ".join(body["positive_signals"])


def test_trust_endpoint_404_for_unknown_property(client):
    resp = client.get("/api/v1/properties/9999999/trust")
    assert resp.status_code == 404


def test_trust_endpoint_data_confidence_present(client, db_session):
    city = _city()
    for rent in (5000, 5500, 6000, 6500, 7000):
        _make_property(db_session, city=city, monthly_rent=rent)
    subject = _make_property(db_session, city=city, monthly_rent=6200)

    resp = client.get(f"/api/v1/properties/{subject.id}/trust")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Enough comparables in the city -> Marketplace Confidence computable.
    assert body["component_scores"]["marketplace_confidence"] is not None
    assert body["data_confidence"] is not None
    assert body["data_confidence"]["level"] in ("High", "Moderate")


# ── availability_confirmed_at persistence + Freshness wiring ────────────────

def test_availability_confirmed_at_persists(db_session):
    city = _city()
    subject = _make_property(db_session, city=city)
    assert subject.availability_confirmed_at is None

    now = datetime.now(timezone.utc)
    subject.availability_confirmed_at = now
    db_session.commit()

    reloaded = db_session.get(Property, subject.id)
    db_session.refresh(reloaded)
    assert reloaded.availability_confirmed_at is not None
    assert abs((reloaded.availability_confirmed_at - now).total_seconds()) < 5


def test_recently_confirmed_availability_reflected_in_trust_freshness(client, db_session):
    city = _city()
    # Stale by updated_at alone (would otherwise be "Potentially Stale"),
    # but confirmed available yesterday -> "Recently Confirmed" must win.
    old = datetime.now(timezone.utc) - timedelta(days=500)
    subject = _make_property(db_session, city=city, created_at=old, updated_at=old)
    subject.availability_confirmed_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()

    resp = client.get(f"/api/v1/properties/{subject.id}/trust")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    freshness = body["component_scores"]["freshness"]
    assert freshness["category"] == "Recently Confirmed"
    assert freshness["score"] == 100
