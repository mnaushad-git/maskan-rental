"""Client analytics event ingestion (Phase 10)."""
from app.models.analytics_event import AnalyticsEvent


def test_ingest_event_anonymous(client, db_session):
    resp = client.post("/api/analytics/events", json={"events": [{"event_name": "push_permission_prompt_shown", "properties": {"platform": "ios"}}]})
    assert resp.status_code == 201
    assert resp.json()["accepted"] == 1
    row = db_session.query(AnalyticsEvent).filter(AnalyticsEvent.event_name == "push_permission_prompt_shown").one()
    assert row.user_id is None
    assert row.properties["platform"] == "ios"


def test_ingest_event_authenticated_attributes_user(client, db_session, unique_email):
    signup = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token = signup.json()["access_token"]
    user_id = signup.json()["user"]["id"]

    resp = client.post(
        "/api/analytics/events",
        json={"events": [{"event_name": "notification_opened", "properties": {"type": "lead_message"}}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    row = db_session.query(AnalyticsEvent).filter(AnalyticsEvent.event_name == "notification_opened").one()
    assert row.user_id == user_id


def test_ingest_unknown_event_name_rejected(client):
    resp = client.post("/api/analytics/events", json={"events": [{"event_name": "totally_made_up_event"}]})
    assert resp.status_code == 422


def test_ingest_properties_are_truncated_not_trusted(client, db_session):
    long_value = "x" * 5000
    resp = client.post("/api/analytics/events", json={"events": [{"event_name": "digest_opened", "properties": {"note": long_value}}]})
    assert resp.status_code == 201
    row = db_session.query(AnalyticsEvent).filter(AnalyticsEvent.event_name == "digest_opened").one()
    assert len(row.properties["note"]) <= 200


def test_ingest_empty_batch_rejected(client):
    resp = client.post("/api/analytics/events", json={"events": []})
    assert resp.status_code == 422
