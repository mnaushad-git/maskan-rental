"""API-level tests for saved-search CRUD, notification center, preferences,
and device registration — ownership isolation, duplicate detection, and
standard REST behavior. See tests/test_saved_search_alerts.py for the
matching-engine/digest internals."""
from app.models.notification import Notification
from app.models.saved_search import SavedSearch
from app.models.user import User


def _signup(client, email) -> str:
    resp = client.post("/api/auth/signup", json={"email": email, "password": "S3cret!23"})
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_FILTERS = {"transaction_type": "rent", "city": "Riyadh", "districts": ["Al Yasmin"], "max_price": 70000, "bedrooms": 3}


# ── Saved searches ───────────────────────────────────────────────────────────

def test_create_saved_search_requires_auth(client):
    resp = client.post("/api/v1/saved-searches/", json={"name": "x", "filters": _FILTERS})
    assert resp.status_code == 401


def test_create_and_get_saved_search(client, unique_email):
    token = _signup(client, unique_email)
    resp = client.post("/api/v1/saved-searches/", json={"name": "Family Home", "filters": _FILTERS}, headers=_auth(token))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == "Family Home"
    assert body["alert_frequency"] == "instant"
    assert body["filters"]["city"] == "Riyadh"

    get_resp = client.get(f"/api/v1/saved-searches/{body['id']}", headers=_auth(token))
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == body["id"]


def test_saved_searches_are_isolated_per_user(client, unique_email):
    token_a = _signup(client, unique_email)
    token_b = _signup(client, f"b-{unique_email}")

    created = client.post("/api/v1/saved-searches/", json={"name": "A's search", "filters": _FILTERS}, headers=_auth(token_a)).json()

    # B cannot see A's saved search — 404, not 403, to avoid confirming it exists.
    resp = client.get(f"/api/v1/saved-searches/{created['id']}", headers=_auth(token_b))
    assert resp.status_code == 404

    # B's list is empty even though A has one.
    list_resp = client.get("/api/v1/saved-searches/", headers=_auth(token_b))
    assert list_resp.json() == []

    # B cannot patch or delete A's saved search either.
    assert client.patch(f"/api/v1/saved-searches/{created['id']}", json={"name": "hijacked"}, headers=_auth(token_b)).status_code == 404
    assert client.delete(f"/api/v1/saved-searches/{created['id']}", headers=_auth(token_b)).status_code == 404


def test_duplicate_saved_search_is_rejected_unless_confirmed(client, unique_email):
    token = _signup(client, unique_email)
    first = client.post("/api/v1/saved-searches/", json={"name": "Search 1", "filters": _FILTERS}, headers=_auth(token))
    assert first.status_code == 201

    dup = client.post("/api/v1/saved-searches/", json={"name": "Search 1 copy", "filters": _FILTERS}, headers=_auth(token))
    assert dup.status_code == 409
    assert "duplicate_of" in dup.json()["detail"]

    confirmed = client.post(
        "/api/v1/saved-searches/",
        json={"name": "Search 1 copy", "filters": _FILTERS, "confirm_duplicate": True},
        headers=_auth(token),
    )
    assert confirmed.status_code == 201


def test_saved_search_per_user_limit_is_enforced(client, unique_email, monkeypatch):
    from app.api.routes import saved_searches as route_module

    monkeypatch.setattr(route_module.settings, "SAVED_SEARCH_LIMIT_PER_USER", 1)
    token = _signup(client, unique_email)
    first = client.post("/api/v1/saved-searches/", json={"name": "One", "filters": _FILTERS}, headers=_auth(token))
    assert first.status_code == 201

    over_limit = client.post(
        "/api/v1/saved-searches/",
        json={"name": "Two", "filters": {"city": "Jeddah"}},
        headers=_auth(token),
    )
    assert over_limit.status_code == 409


def test_enable_disable_alerts_round_trip(client, unique_email):
    token = _signup(client, unique_email)
    created = client.post("/api/v1/saved-searches/", json={"name": "Toggle", "filters": _FILTERS}, headers=_auth(token)).json()

    disabled = client.post(f"/api/v1/saved-searches/{created['id']}/disable-alerts", headers=_auth(token))
    assert disabled.status_code == 200
    assert disabled.json()["alert_enabled"] is False

    enabled = client.post(f"/api/v1/saved-searches/{created['id']}/enable-alerts", headers=_auth(token))
    assert enabled.status_code == 200
    assert enabled.json()["alert_enabled"] is True


def test_preview_endpoint_returns_estimated_count(client, db_session, unique_email):
    from app.models.property import Property

    db_session.add(Property(title="P1", area="Al Yasmin", city="Riyadh", listing_type="rent", monthly_rent=65000, bedrooms=3, status="Published"))
    db_session.commit()

    token = _signup(client, unique_email)
    resp = client.post("/api/v1/saved-searches/preview", json=_FILTERS, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["estimated_count"] >= 1


def test_delete_saved_search(client, unique_email):
    token = _signup(client, unique_email)
    created = client.post("/api/v1/saved-searches/", json={"name": "Bye", "filters": _FILTERS}, headers=_auth(token)).json()
    assert client.delete(f"/api/v1/saved-searches/{created['id']}", headers=_auth(token)).status_code == 204
    assert client.get(f"/api/v1/saved-searches/{created['id']}", headers=_auth(token)).status_code == 404


def test_invalid_filter_values_are_rejected(client, unique_email):
    token = _signup(client, unique_email)
    resp = client.post(
        "/api/v1/saved-searches/",
        json={"name": "Bad", "filters": {"transaction_type": "lease"}},  # not "rent"/"sale"
        headers=_auth(token),
    )
    assert resp.status_code == 422


# ── Notifications ────────────────────────────────────────────────────────────

def _make_notification(db, user_id: int, **overrides) -> Notification:
    defaults = dict(user_id=user_id, type="saved_search_new_listing", title="New match", body="Body text", locale="en", delivery_status={}, meta={})
    defaults.update(overrides)
    n = Notification(**defaults)
    db.add(n)
    db.commit()
    db.refresh(n)
    return n


def test_notification_list_and_unread_count(client, db_session, unique_email):
    token = _signup(client, unique_email)
    user = db_session.query(User).filter(User.email == unique_email).one()
    _make_notification(db_session, user.id)
    _make_notification(db_session, user.id)

    unread = client.get("/api/v1/notifications/unread-count", headers=_auth(token))
    assert unread.status_code == 200
    assert unread.json()["unread_count"] == 2

    listing = client.get("/api/v1/notifications/", headers=_auth(token))
    assert listing.status_code == 200
    body = listing.json()
    assert len(body["items"]) == 2
    assert body["unread_count"] == 2


def test_notifications_are_isolated_per_user(client, db_session, unique_email):
    token_a = _signup(client, unique_email)
    token_b = _signup(client, f"b-{unique_email}")
    user_a = db_session.query(User).filter(User.email == unique_email).one()
    n = _make_notification(db_session, user_a.id)

    resp = client.post(f"/api/v1/notifications/{n.id}/read", headers=_auth(token_b))
    assert resp.status_code == 404

    b_list = client.get("/api/v1/notifications/", headers=_auth(token_b)).json()
    assert b_list["items"] == []


def test_mark_read_and_mark_all_read(client, db_session, unique_email):
    token = _signup(client, unique_email)
    user = db_session.query(User).filter(User.email == unique_email).one()
    n1 = _make_notification(db_session, user.id)
    _make_notification(db_session, user.id)

    read_resp = client.post(f"/api/v1/notifications/{n1.id}/read", headers=_auth(token))
    assert read_resp.status_code == 200
    assert read_resp.json()["read_at"] is not None

    assert client.get("/api/v1/notifications/unread-count", headers=_auth(token)).json()["unread_count"] == 1

    all_read = client.post("/api/v1/notifications/read-all", headers=_auth(token))
    assert all_read.status_code == 200
    assert client.get("/api/v1/notifications/unread-count", headers=_auth(token)).json()["unread_count"] == 0


def test_delete_notification(client, db_session, unique_email):
    token = _signup(client, unique_email)
    user = db_session.query(User).filter(User.email == unique_email).one()
    n = _make_notification(db_session, user.id)

    assert client.delete(f"/api/v1/notifications/{n.id}", headers=_auth(token)).status_code == 204
    assert client.get("/api/v1/notifications/unread-count", headers=_auth(token)).json()["unread_count"] == 0


# ── Preferences ──────────────────────────────────────────────────────────────

def test_notification_preferences_defaults_and_update(client, unique_email):
    token = _signup(client, unique_email)
    defaults = client.get("/api/v1/notification-preferences/", headers=_auth(token))
    assert defaults.status_code == 200
    assert defaults.json()["timezone"] == "Asia/Riyadh"

    updated = client.patch("/api/v1/notification-preferences/", json={"email_enabled": True, "digest_hour": 20}, headers=_auth(token))
    assert updated.status_code == 200
    assert updated.json()["email_enabled"] is True
    assert updated.json()["digest_hour"] == 20


# ── Devices ──────────────────────────────────────────────────────────────────

def test_device_register_upsert_and_unregister(client, unique_email):
    token = _signup(client, unique_email)
    payload = {"platform": "android", "push_token": "expo-token-abc123", "app_version": "1.0.0", "locale": "en"}

    first = client.post("/api/v1/devices/", json=payload, headers=_auth(token))
    assert first.status_code == 201
    device_id = first.json()["id"]

    # Re-registering the same token upserts rather than duplicating.
    second = client.post("/api/v1/devices/", json=payload, headers=_auth(token))
    assert second.status_code == 201
    assert second.json()["id"] == device_id

    listing = client.get("/api/v1/devices/", headers=_auth(token))
    assert len(listing.json()) == 1

    assert client.delete(f"/api/v1/devices/{device_id}", headers=_auth(token)).status_code == 204
    assert client.get("/api/v1/devices/", headers=_auth(token)).json() == []


def test_device_registration_rejects_invalid_platform(client, unique_email):
    token = _signup(client, unique_email)
    resp = client.post("/api/v1/devices/", json={"platform": "windows_phone", "push_token": "x"}, headers=_auth(token))
    assert resp.status_code == 422
