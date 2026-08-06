"""Renter premium tier ("AI Alert Plus"): subscribe/renew/unsubscribe via the
mock Moyasar flow (USE_REAL_PAYMENTS off in tests), the get_premium_user gate,
and lazy expiry — mirrors the mediator subscription pattern applied to User.
"""
from datetime import datetime, timedelta, timezone

from app.models.user import User


def _signup_and_token(client, email) -> str:
    resp = client.post("/api/auth/signup", json={"email": email, "password": "S3cret!23"})
    assert resp.status_code == 201
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_subscribe_mock_activates_immediately(client, unique_email):
    token = _signup_and_token(client, unique_email)

    resp = client.post("/api/subscriptions/me/subscribe", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "active"
    assert body["subscription_expires_at"] is not None

    me = client.get("/api/subscriptions/me", headers=_auth(token))
    assert me.status_code == 200
    assert me.json()["subscription_status"] == "active"
    assert me.json()["subscription_tier"] == "premium"


def test_subscribe_twice_rejected(client, unique_email):
    token = _signup_and_token(client, unique_email)
    client.post("/api/subscriptions/me/subscribe", headers=_auth(token))

    resp = client.post("/api/subscriptions/me/subscribe", headers=_auth(token))
    assert resp.status_code == 400


def test_gate_blocks_without_subscription(client, unique_email):
    token = _signup_and_token(client, unique_email)

    resp = client.get("/api/subscriptions/premium-status", headers=_auth(token))
    assert resp.status_code == 403


def test_gate_allows_active_subscription(client, unique_email):
    token = _signup_and_token(client, unique_email)
    client.post("/api/subscriptions/me/subscribe", headers=_auth(token))

    resp = client.get("/api/subscriptions/premium-status", headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["premium"] is True


def test_unsubscribe_revokes_access(client, unique_email):
    token = _signup_and_token(client, unique_email)
    client.post("/api/subscriptions/me/subscribe", headers=_auth(token))

    resp = client.post("/api/subscriptions/me/unsubscribe", headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["status"] == "cancelled"

    gated = client.get("/api/subscriptions/premium-status", headers=_auth(token))
    assert gated.status_code == 403

    me = client.get("/api/subscriptions/me", headers=_auth(token))
    assert me.json()["subscription_status"] == "cancelled"


def test_unsubscribe_without_active_subscription_rejected(client, unique_email):
    token = _signup_and_token(client, unique_email)

    resp = client.post("/api/subscriptions/me/unsubscribe", headers=_auth(token))
    assert resp.status_code == 400


def test_expiry_lazily_flips_and_blocks_gate(client, db_session, unique_email):
    token = _signup_and_token(client, unique_email)
    client.post("/api/subscriptions/me/subscribe", headers=_auth(token))

    user = db_session.query(User).filter(User.email == unique_email).one()
    user.subscription_expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()

    resp = client.get("/api/subscriptions/premium-status", headers=_auth(token))
    assert resp.status_code == 403
    assert "expired" in resp.json()["detail"]

    me = client.get("/api/subscriptions/me", headers=_auth(token))
    assert me.json()["subscription_status"] == "expired"


def test_renew_extends_expiry(client, unique_email):
    token = _signup_and_token(client, unique_email)
    first = client.post("/api/subscriptions/me/subscribe", headers=_auth(token)).json()

    renewed = client.post("/api/subscriptions/me/renew", headers=_auth(token))
    assert renewed.status_code == 200
    assert renewed.json()["status"] == "renewed"
    assert renewed.json()["subscription_expires_at"] > first["subscription_expires_at"]


def test_subscribe_requires_auth(client):
    resp = client.post("/api/subscriptions/me/subscribe")
    assert resp.status_code == 401
