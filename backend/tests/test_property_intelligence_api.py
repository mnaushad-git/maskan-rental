"""GET /properties/{id}/intelligence — full response shape for a rent and a
sale fixture, personalized_fit null/populated depending on query params,
feature-flag-off 503 (home_finder's convention), and a minimal-data property
still returning 200 with omissions rather than erroring.
"""
import uuid

from app.core.config import settings
from app.models.property import Property


def _city() -> str:
    return f"TestCity-{uuid.uuid4().hex[:8]}"


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Test Property", area="Test District", city="TestCity", listing_type="rent",
        status="Published", bedrooms=3, bathrooms=2, size_sq_m=150, property_type="Apartment",
        furnished="Furnished", latitude=24.7, longitude=46.6, monthly_rent=6000.0,
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    db.commit()
    return prop


def test_rent_property_full_response_shape(client, db_session):
    city = _city()
    for rent in (5000, 5500, 6000, 6500, 7000):
        _make_property(db_session, city=city, monthly_rent=rent)
    subject = _make_property(db_session, city=city, monthly_rent=6200)

    resp = client.get(f"/api/v1/properties/{subject.id}/intelligence")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert isinstance(body["decision_score"], int)
    assert "component_scores" in body
    assert body["data_confidence"]["level"] in ("High", "Moderate")
    assert body["price_intelligence"]["type"] == "rent"
    assert body["price_intelligence"]["sufficient_data"] is True
    assert body["comparable_summary"]["count"] >= 1
    assert isinstance(body["strengths"], list)
    assert isinstance(body["smart_questions"], list) and len(body["smart_questions"]) >= 4
    assert body["personalized_fit"] is None


def test_sale_property_full_response_shape(client, db_session):
    city = _city()
    for price_per_sqm in (2000, 2500, 3000, 3500, 4000):
        _make_property(db_session, city=city, listing_type="sale", sale_price=price_per_sqm * 100, size_sq_m=100, monthly_rent=None)
    subject = _make_property(db_session, city=city, listing_type="sale", sale_price=310_000, size_sq_m=100, monthly_rent=None)

    resp = client.get(f"/api/v1/properties/{subject.id}/intelligence")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["price_intelligence"]["type"] == "buy"
    assert body["price_intelligence"]["sufficient_data"] is True
    assert body["price_intelligence"]["price_per_sqm"] is not None


def test_personalized_fit_populated_with_criteria(client, db_session):
    city = _city()
    subject = _make_property(db_session, city=city, bedrooms=3, monthly_rent=6000.0)

    resp = client.get(f"/api/v1/properties/{subject.id}/intelligence", params={"bedrooms": 3, "max_price": 80000})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["personalized_fit"] is not None
    assert body["personalized_fit"]["priorities_total"] >= 1


def test_feature_flag_off_returns_503(client, db_session, monkeypatch):
    city = _city()
    subject = _make_property(db_session, city=city)
    monkeypatch.setattr(settings, "FEATURE_PROPERTY_INTELLIGENCE", False)

    resp = client.get(f"/api/v1/properties/{subject.id}/intelligence")
    assert resp.status_code == 503


def test_unknown_property_404s(client):
    resp = client.get("/api/v1/properties/9999999/intelligence")
    assert resp.status_code == 404


def test_minimal_data_property_returns_200_with_omissions(client, db_session):
    city = _city()
    subject = Property(title="Bare listing", area="Nowhere", city=city, listing_type="rent", status="Published")
    db_session.add(subject)
    db_session.flush()
    db_session.commit()

    resp = client.get(f"/api/v1/properties/{subject.id}/intelligence")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["price_intelligence"]["sufficient_data"] is False
    assert body["comparable_summary"]["count"] == 0
    assert body["area_intelligence"] is None
    assert body["personalized_fit"] is None


# ── POST /{id}/ai-summary — HTTP-level coverage (Prompt 12 gap: only the
# service function was unit-tested in test_property_intelligence_ai.py,
# never the actual route) ───────────────────────────────────────────────────


def test_ai_summary_endpoint_returns_200(client, db_session):
    city = _city()
    subject = _make_property(db_session, city=city)

    resp = client.post(f"/api/v1/properties/{subject.id}/ai-summary", json={"language": "en"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["summary"], str) and body["summary"]
    assert body["generated_by"] in ("ai", "fallback")


def test_ai_summary_endpoint_negotiation_variant_requires_negotiation_data(client, db_session):
    city = _city()
    # Fewer than 3 comparables -> price_intelligence insufficient -> no
    # negotiation_intelligence -> the negotiation_message variant must 422
    # rather than fabricate a message.
    subject = _make_property(db_session, city=city)

    resp = client.post(f"/api/v1/properties/{subject.id}/ai-summary", json={"language": "en", "variant": "negotiation_message"})
    assert resp.status_code == 422


def test_ai_summary_endpoint_negotiation_variant_succeeds_with_enough_comparables(client, db_session):
    city = _city()
    for rent in (5000, 5500, 6000, 6500, 7000):
        _make_property(db_session, city=city, monthly_rent=rent)
    subject = _make_property(db_session, city=city, monthly_rent=6200)

    resp = client.post(f"/api/v1/properties/{subject.id}/ai-summary", json={"language": "en", "variant": "negotiation_message"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body["summary"], str) and body["summary"]


def test_ai_summary_endpoint_404_for_unknown_property(client):
    resp = client.post("/api/v1/properties/9999999/ai-summary", json={"language": "en"})
    assert resp.status_code == 404


def test_ai_summary_endpoint_feature_flag_off_returns_503(client, db_session, monkeypatch):
    city = _city()
    subject = _make_property(db_session, city=city)
    monkeypatch.setattr(settings, "FEATURE_PROPERTY_INTELLIGENCE", False)

    resp = client.post(f"/api/v1/properties/{subject.id}/ai-summary", json={"language": "en"})
    assert resp.status_code == 503
