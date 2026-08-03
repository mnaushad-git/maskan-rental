"""End-to-end tests for the Redis-backed features wired into real endpoints
(idempotent lead creation, rate-limited login, cached mediator/area
endpoints). These hit the actual routes through the FastAPI TestClient
against the real dev DB (rolled back per test, see conftest.py) with a
fakeredis client injected in place of the real Redis connection.
"""
import fakeredis
import pytest

from app.models.lead import Lead
from app.models.mediator import Mediator
from app.models.user import User


@pytest.fixture()
def fake_redis(monkeypatch):
    client = fakeredis.FakeStrictRedis(decode_responses=True)
    monkeypatch.setattr("app.core.cache.get_redis_client", lambda: client)
    monkeypatch.setattr("app.core.rate_limit.get_redis_client", lambda: client)
    monkeypatch.setattr("app.core.idempotency.get_redis_client", lambda: client)
    monkeypatch.setattr("app.core.distributed_lock.get_redis_client", lambda: client)
    return client


def _signup_and_login(client, unique_email) -> str:
    resp = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    return resp.json()["access_token"]


LEAD_PAYLOAD = {
    "area_name": "Al Yasmin",
    "city": "Riyadh",
    "customer_name": "Test Customer",
    "customer_phone": "+966500000000",
    "customer_email": "customer@example.com",
    "min_budget": 3000,
    "max_budget": 6000,
}


def test_lead_creation_replays_response_for_same_idempotency_key(client, fake_redis, unique_email, db_session):
    token = _signup_and_login(client, unique_email)
    headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "key-abc-123"}

    first = client.post("/api/leads/", json=LEAD_PAYLOAD, headers=headers)
    assert first.status_code == 201
    first_id = first.json()["id"]

    second = client.post("/api/leads/", json=LEAD_PAYLOAD, headers=headers)
    assert second.status_code == 201
    assert second.json()["id"] == first_id

    lead_count = db_session.query(Lead).filter(Lead.customer_email == "customer@example.com").count()
    assert lead_count == 1  # the replay did not create a second lead


def test_lead_creation_conflict_on_key_reuse_with_different_body(client, fake_redis, unique_email):
    token = _signup_and_login(client, unique_email)
    headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "key-xyz-999"}

    first = client.post("/api/leads/", json=LEAD_PAYLOAD, headers=headers)
    assert first.status_code == 201

    different_payload = {**LEAD_PAYLOAD, "customer_name": "A Different Customer"}
    second = client.post("/api/leads/", json=different_payload, headers=headers)
    assert second.status_code == 409


def test_lead_creation_without_idempotency_key_creates_separate_leads(client, fake_redis, unique_email, db_session):
    token = _signup_and_login(client, unique_email)
    headers = {"Authorization": f"Bearer {token}"}

    client.post("/api/leads/", json=LEAD_PAYLOAD, headers=headers)
    client.post("/api/leads/", json=LEAD_PAYLOAD, headers=headers)

    lead_count = db_session.query(Lead).filter(Lead.customer_email == "customer@example.com").count()
    assert lead_count == 2


def test_login_rate_limit_returns_429_with_retry_after(client, fake_redis, unique_email):
    client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    login_body = {"email": unique_email, "password": "wrong-password"}

    for _ in range(10):
        resp = client.post("/api/auth/login", json=login_body)
        assert resp.status_code == 401

    limited = client.post("/api/auth/login", json=login_body)
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers


def test_mediator_public_profile_is_served_from_cache(client, fake_redis, db_session):
    user = User(email="mediator-cache-test@example.com", hashed_password="x")
    db_session.add(user)
    db_session.flush()
    mediator = Mediator(
        user_id=user.id,
        license_number="LIC-CACHE-TEST-1",
        agency_name="Cache Test Agency",
        phone="+966500000001",
        subscription_status="active",
    )
    db_session.add(mediator)
    db_session.commit()
    db_session.refresh(mediator)

    first = client.get(f"/api/mediators/{mediator.id}/public")
    assert first.status_code == 200
    assert first.json()["agency_name"] == "Cache Test Agency"

    # Mutate the DB row directly, bypassing the API (and its cache invalidation) —
    # a second request should still return the now-stale cached value, proving
    # the response actually came from cache rather than a fresh DB read.
    mediator.agency_name = "Mutated Directly In DB"
    db_session.commit()

    second = client.get(f"/api/mediators/{mediator.id}/public")
    assert second.status_code == 200
    assert second.json()["agency_name"] == "Cache Test Agency"  # still the cached value


def test_area_intelligence_list_is_cached(client, fake_redis):
    first = client.get("/api/areas/intelligence")
    assert first.status_code == 200

    from app.core.cache import CacheService
    cache = CacheService(client=fake_redis)
    assert cache.get("area-intel", "list") is not None  # populated by the request above
