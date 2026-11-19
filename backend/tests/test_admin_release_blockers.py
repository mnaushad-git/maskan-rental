"""Regression tests for the Admin Portal release blockers.

Covers:
  * disabled accounts lose access immediately, even with a still-valid JWT
    (protected routes, optional-auth routes, admin routes, SSE stream token);
  * ONE admin rule (`app.core.roles.is_admin_user`) shared by login,
    /auth/me and the admin API guard — DB-flag admins and ADMIN_EMAILS admins
    are both admins everywhere, customers/partners/anonymous are not;
  * the identity-verification review flow the new admin screen uses;
  * /analytics/summary returns only real, DB-derived figures;
  * admin-only bulk import (the Data Import screen's endpoint).

All data is created inside the per-test rolled-back transaction (conftest).
"""
import uuid

import pytest
from fastapi import HTTPException

from app.api.routes import notifications as notifications_routes
from app.api.routes.auth import create_access_token, hash_password
from app.core import rate_limit
from app.core.config import settings
from app.core.roles import is_admin_user
from app.models.lead import Lead
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_transaction import PropertyTransaction
from app.models.property_viewing import PropertyViewing
from app.models.user import User

PASSWORD = "Rel3ase!Test"


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch):
    # Login is rate-limited per IP (10 / 5 min, Redis-backed); every TestClient
    # request comes from the same "IP", so neutralise it for these tests.
    monkeypatch.setattr(
        rate_limit,
        "check_rate_limit",
        lambda *a, limit, **k: rate_limit.RateLimitResult(True, limit, limit, 0),
    )


def _user(db, **overrides) -> User:
    defaults = dict(
        email=f"rb-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password=hash_password(PASSWORD),
        full_name="Release Blocker Test",
    )
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.flush()
    return user


def _partner(db) -> User:
    user = _user(db)
    db.add(
        Mediator(
            user_id=user.id,
            license_number=f"LIC-{uuid.uuid4().hex[:6]}",
            phone="0500000001",
            subscription_status="active",
            approval_status="approved",
        )
    )
    db.flush()
    return user


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _login(client, user: User):
    return client.post("/api/auth/login", json={"email": user.email, "password": PASSWORD})


# ── 1. Disabled accounts ─────────────────────────────────────────────────────


def test_disabled_user_token_stops_working_immediately(client, db_session):
    user = _user(db_session)
    headers = _auth(user)  # issued while the account is active
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.get("/api/notifications/unread-count", headers=headers).status_code == 200

    user.is_active = False
    db_session.flush()

    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.get("/api/notifications/unread-count", headers=headers).status_code == 401
    assert client.get("/api/verification/me", headers=headers).status_code == 401


def test_disabled_user_on_optional_auth_route_is_treated_as_anonymous(client, db_session):
    user = _user(db_session, is_active=False)
    resp = client.get("/api/properties/?limit=1", headers=_auth(user))
    assert resp.status_code == 200  # public route still works, just without identity


def test_disabled_admin_loses_admin_access(client, db_session):
    admin = _user(db_session, is_admin=True)
    headers = _auth(admin)
    assert client.get("/api/users/", headers=headers).status_code == 200

    admin.is_active = False
    db_session.flush()
    assert client.get("/api/users/", headers=headers).status_code == 401
    assert is_admin_user(admin) is False


def test_admin_disabling_user_through_api_revokes_their_session(client, db_session):
    admin = _user(db_session, is_admin=True)
    victim = _user(db_session)
    victim_headers = _auth(victim)
    assert client.get("/api/auth/me", headers=victim_headers).status_code == 200

    resp = client.patch(f"/api/users/{victim.id}", json={"is_active": False}, headers=_auth(admin))
    assert resp.status_code == 200, resp.text

    assert client.get("/api/auth/me", headers=victim_headers).status_code == 401
    assert _login(client, victim).status_code == 403


def test_disabled_user_rejected_by_sse_stream_token(db_session):
    user = _user(db_session)
    token = create_access_token(user.id)
    assert notifications_routes._user_from_stream_token(token, db_session).id == user.id

    user.is_active = False
    db_session.flush()
    with pytest.raises(HTTPException) as exc:
        notifications_routes._user_from_stream_token(token, db_session)
    assert exc.value.status_code == 401


def test_malformed_subject_is_rejected_not_500(client):
    from jose import jwt

    bad = jwt.encode({"sub": "not-an-int"}, settings.SECRET_KEY, algorithm="HS256")
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401


# ── 2. One consistent admin rule ─────────────────────────────────────────────


def test_db_flag_admin_is_admin_in_login_me_and_api(client, db_session):
    admin = _user(db_session, is_admin=True)

    login = _login(client, admin)
    assert login.status_code == 200
    assert login.json()["user"]["is_admin"] is True

    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200 and me.json()["is_admin"] is True
    assert client.get("/api/users/", headers=headers).status_code == 200


def test_admin_emails_admin_is_admin_everywhere_case_insensitive(client, db_session, monkeypatch):
    user = _user(db_session)
    monkeypatch.setattr(settings, "ADMIN_EMAILS", f"someone-else@example.com, {user.email.upper()}")

    login = _login(client, user)
    assert login.status_code == 200 and login.json()["user"]["is_admin"] is True
    headers = _auth(user)
    assert client.get("/api/auth/me", headers=headers).json()["is_admin"] is True
    assert client.get("/api/users/", headers=headers).status_code == 200


def test_admin_created_from_users_screen_can_use_the_portal(client, db_session):
    """The Users screen's "Admin" role must yield a working portal login
    (previously the API accepted them but login/me said is_admin=false)."""
    root = _user(db_session, is_admin=True)
    email = f"rb-new-admin-{uuid.uuid4().hex[:8]}@example.com"
    created = client.post(
        "/api/users/",
        json={"email": email, "password": PASSWORD, "full_name": "New Admin", "role": "admin"},
        headers=_auth(root),
    )
    assert created.status_code == 201, created.text

    login = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert login.status_code == 200
    assert login.json()["user"]["is_admin"] is True


@pytest.mark.parametrize("kind", ["customer", "partner"])
def test_non_admins_are_not_admin_anywhere(client, db_session, kind):
    user = _user(db_session) if kind == "customer" else _partner(db_session)
    login = _login(client, user)
    assert login.status_code == 200 and login.json()["user"]["is_admin"] is False
    headers = _auth(user)
    assert client.get("/api/auth/me", headers=headers).json()["is_admin"] is False
    for path in ("/api/users/", "/api/verification/admin/pending", "/api/analytics/summary"):
        assert client.get(path, headers=headers).status_code == 403, path
    assert client.post("/api/properties/bulk", json=[], headers=headers).status_code == 403


def test_anonymous_cannot_reach_admin_endpoints(client):
    for path in ("/api/users/", "/api/verification/admin/pending", "/api/analytics/summary"):
        assert client.get(path).status_code == 401, path
    assert client.post("/api/verification/admin/1/approve").status_code == 401
    assert client.post("/api/properties/bulk", json=[]).status_code == 401


# ── 3. Identity verification review ──────────────────────────────────────────


def test_verification_submit_list_approve(client, db_session):
    admin = _user(db_session, is_admin=True)
    applicant = _user(db_session)

    submitted = client.post(
        "/api/verification/me", json={"document_reference": "NID-1234567890"}, headers=_auth(applicant)
    )
    assert submitted.status_code == 201 and submitted.json()["verification_status"] == "pending"

    pending = client.get("/api/verification/admin/pending", headers=_auth(admin))
    assert pending.status_code == 200
    row = next(r for r in pending.json() if r["id"] == applicant.id)
    assert row["email"] == applicant.email
    assert row["verification_document_ref"] == "NID-1234567890"

    approved = client.post(f"/api/verification/admin/{applicant.id}/approve", headers=_auth(admin))
    assert approved.status_code == 200
    assert approved.json()["verification_status"] == "approved" and approved.json()["is_verified"] is True

    after = client.get("/api/verification/admin/pending", headers=_auth(admin)).json()
    assert all(r["id"] != applicant.id for r in after)
    assert client.get("/api/verification/me", headers=_auth(applicant)).json()["is_verified"] is True


def test_verification_reject_allows_resubmission(client, db_session):
    admin = _user(db_session, is_admin=True)
    applicant = _user(db_session)
    client.post("/api/verification/me", json={"document_reference": "NID-999"}, headers=_auth(applicant))

    rejected = client.post(f"/api/verification/admin/{applicant.id}/reject", headers=_auth(admin))
    assert rejected.status_code == 200
    assert rejected.json()["verification_status"] == "rejected" and rejected.json()["is_verified"] is False

    again = client.post("/api/verification/me", json={"document_reference": "NID-1000"}, headers=_auth(applicant))
    assert again.status_code == 201


def test_verification_actions_404_for_unknown_user(client, db_session):
    admin = _user(db_session, is_admin=True)
    assert client.post("/api/verification/admin/999999999/approve", headers=_auth(admin)).status_code == 404


# ── 4. Analytics: real figures only ──────────────────────────────────────────


def test_analytics_summary_is_computed_from_real_rows(client, db_session):
    admin = _user(db_session, is_admin=True)
    resp = client.get("/api/analytics/summary", headers=_auth(admin))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    total_props = db_session.query(Property).count()
    kpis = {k["label"]: k for k in data["kpis"]}
    assert kpis["Total properties"]["value"] == f"{total_props:,}"
    assert kpis["Total leads"]["value"] == f"{db_session.query(Lead).count():,}"
    assert kpis["Registered users"]["value"] == f"{db_session.query(User).count():,}"

    funnel = {f["stage"]: f["value"] for f in data["funnel"]}
    assert funnel["Leads created"] == db_session.query(Lead).count()
    assert funnel["Viewings scheduled"] == db_session.query(PropertyViewing).count()
    assert funnel["Transactions started"] == db_session.query(PropertyTransaction).count()

    # Not tracked → explicitly unavailable, never invented.
    assert data["searchDemand"] == []
    assert "searchDemand" in data["unavailable"]

    # The old hard-coded figures are gone.
    for k in data["kpis"]:
        assert k["delta"] not in {"+8.2%", "+14.6%", "+0.9 pp", "+22.4%"}
    assert [t["label"] for t in data["aiTrends"]] != [
        "Area recommendation", "Budget fit", "Compare districts", "Rent fairness check", "Schools & family"
    ]
    inv_total = sum(c["published"] + c["pending"] + c["inactive"] for c in data["inventory"])
    assert inv_total == total_props
    for q in data["dataQuality"]:
        assert 0 <= q["value"] <= 100


def test_analytics_new_listing_counts_in_window(client, db_session):
    admin = _user(db_session, is_admin=True)
    before = client.get("/api/analytics/summary", headers=_auth(admin)).json()
    db_session.add(Property(title="RB analytics probe", area="Al Yasmin", city="Riyadh", status="Draft", monthly_rent=1000))
    db_session.flush()
    after = client.get("/api/analytics/summary", headers=_auth(admin)).json()
    kb = {k["label"]: k for k in before["kpis"]}["Total properties"]
    ka = {k["label"]: k for k in after["kpis"]}["Total properties"]
    assert int(ka["value"].replace(",", "")) == int(kb["value"].replace(",", "")) + 1
    assert ka["delta"].startswith("+")
    assert any(a["title"] == "New listing — RB analytics probe" for a in after["activity"])


# ── 5. Data Import endpoint ──────────────────────────────────────────────────


def test_admin_bulk_import_inserts_and_dedupes(client, db_session):
    admin = _user(db_session, is_admin=True)
    ext = f"RB-IMPORT-{uuid.uuid4().hex[:8]}"
    rows = [
        {"external_id": ext, "title": "RB Import One", "area": "Al Yasmin", "city": "Riyadh", "monthly_rent": 5000, "status": "Draft"},
        {"title": "RB Import Two", "area": "Al Malqa", "city": "Riyadh", "monthly_rent": 6500, "bedrooms": 2, "status": "Draft"},
    ]
    first = client.post("/api/properties/bulk", json=rows, headers=_auth(admin))
    assert first.status_code == 201 and first.json() == {"inserted": 2, "skipped": 0, "total": 2}
    imported = db_session.query(Property).filter(Property.external_id == ext).one()
    # Missing fields stay missing — nothing is fabricated on import.
    assert imported.size_sq_m is None and imported.bedrooms is None and imported.bathrooms is None

    second = client.post("/api/properties/bulk", json=rows[:1], headers=_auth(admin))
    assert second.json() == {"inserted": 0, "skipped": 1, "total": 1}
