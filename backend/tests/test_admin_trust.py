"""Admin moderation extensions (Prompt 6): dashboard counts, moderation-list
filters, review-detail assembly, hide/restore/resolve-report actions —
permission checks, audit-log entries, and report status transitions.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.api.routes.auth import create_access_token
from app.models.audit_log import AuditLog
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.property_report import PropertyReport
from app.models.user import User


def _city() -> str:
    return f"AdminTrustCity-{uuid.uuid4().hex[:8]}"


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"admintrust-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _admin_headers(db) -> tuple[dict, User]:
    admin = _make_user(db, is_admin=True)
    token = create_access_token(admin.id)
    return {"Authorization": f"Bearer {token}"}, admin


def _plain_headers(db) -> dict:
    user = _make_user(db)
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Admin Trust Test Property", area="Test District", city="AdminTrustCity", listing_type="rent",
        status="Published", bedrooms=2, bathrooms=1, size_sq_m=100, property_type="Apartment",
        monthly_rent=4500.0, description="A decent test apartment for admin moderation tests.",
        contact_phone="0500000000",
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    db.commit()
    return prop


def _make_mediator(db, **overrides) -> Mediator:
    user = User(email=f"admintrust-med-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    db.add(user)
    db.flush()
    defaults = dict(user_id=user.id, license_number="LIC-ADMINTRUST", phone="0500000001", is_verified=False, subscription_status="active", approval_status="approved")
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.flush()
    db.commit()
    return mediator


def _make_report(db, prop, **overrides) -> PropertyReport:
    defaults = dict(property_id=prop.id, reason="incorrect_information", status="Open")
    defaults.update(overrides)
    report = PropertyReport(**defaults)
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


# ── Permission checks ────────────────────────────────────────────────────

def test_dashboard_requires_admin(client, db_session):
    headers = _plain_headers(db_session)
    resp = client.get("/api/v1/admin/trust/dashboard", headers=headers)
    assert resp.status_code == 403


def test_dashboard_requires_auth(client):
    resp = client.get("/api/v1/admin/trust/dashboard")
    assert resp.status_code == 401


def test_moderation_list_requires_admin(client, db_session):
    headers = _plain_headers(db_session)
    resp = client.get("/api/v1/admin/trust/properties", headers=headers)
    assert resp.status_code == 403


def test_review_detail_requires_admin(client, db_session):
    subject = _make_property(db_session, city=_city())
    headers = _plain_headers(db_session)
    resp = client.get(f"/api/v1/admin/trust/properties/{subject.id}", headers=headers)
    assert resp.status_code == 403


def test_hide_requires_admin(client, db_session):
    subject = _make_property(db_session, city=_city())
    headers = _plain_headers(db_session)
    resp = client.post(f"/api/v1/admin/trust/properties/{subject.id}/hide", headers=headers)
    assert resp.status_code == 403


def test_resolve_report_requires_admin(client, db_session):
    subject = _make_property(db_session, city=_city())
    report = _make_report(db_session, subject)
    headers = _plain_headers(db_session)
    resp = client.post(
        f"/api/v1/admin/trust/reports/{report.id}/resolve", json={"status": "Resolved"}, headers=headers
    )
    assert resp.status_code == 403


# ── Dashboard counts ─────────────────────────────────────────────────────

def test_dashboard_counts_correctness(client, db_session):
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)

    # Pending-approval listing -> counted in listings_requiring_review.
    _make_property(db_session, city=city, status="Pending Approval")

    # Very low-completeness Published listing (almost nothing filled in).
    low_completeness = _make_property(
        db_session, city=city, status="Published", description=None, bedrooms=None, bathrooms=None,
        size_sq_m=None, property_type=None, contact_phone=None,
    )

    # Potentially-stale Published listing (created/updated far in the past).
    old = datetime.now(timezone.utc) - timedelta(days=500)
    stale = _make_property(db_session, city=city, status="Published", created_at=old, updated_at=old)

    # Property with an open report.
    reported_prop = _make_property(db_session, city=city, status="Published")
    _make_report(db_session, reported_prop, status="Open")

    # Unverified mediator -> counted in mediators_pending_verification.
    _make_mediator(db_session, is_verified=False)

    resp = client.get("/api/v1/admin/trust/dashboard", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["listings_requiring_review"] >= 1
    assert body["low_completeness_listings"] >= 1
    assert body["stale_listings"] >= 1
    assert body["open_reports"] >= 1
    assert body["mediators_pending_verification"] >= 1
    assert body["recently_reported_properties"] >= 1

    # Sanity: low_completeness/stale fixtures actually exist and are Published.
    assert db_session.get(Property, low_completeness.id).status == "Published"
    assert db_session.get(Property, stale.id).status == "Published"


# ── Moderation list + filters ────────────────────────────────────────────

def test_moderation_list_shape_and_pagination_header(client, db_session):
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)
    _make_property(db_session, city=city, listing_type="rent")
    _make_property(db_session, city=city, listing_type="sale", sale_price=500000.0, monthly_rent=None)

    resp = client.get(f"/api/v1/admin/trust/properties?city={city}", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert "X-Total-Count" in resp.headers
    assert int(resp.headers["X-Total-Count"]) >= 2
    body = resp.json()
    assert len(body) >= 2
    item = body[0]
    for key in ("property_id", "title", "transaction_type", "city", "trust_score", "trust_level", "completeness_score", "freshness_category", "open_report_count", "status"):
        assert key in item


def test_moderation_list_filter_by_transaction_type(client, db_session):
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)
    rent_prop = _make_property(db_session, city=city, listing_type="rent")
    sale_prop = _make_property(db_session, city=city, listing_type="sale", sale_price=500000.0, monthly_rent=None)

    resp = client.get(f"/api/v1/admin/trust/properties?city={city}&transaction_type=sale", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    ids = [item["property_id"] for item in resp.json()]
    assert sale_prop.id in ids
    assert rent_prop.id not in ids


def test_moderation_list_filter_by_reported(client, db_session):
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)
    clean_prop = _make_property(db_session, city=city)
    reported_prop = _make_property(db_session, city=city)
    _make_report(db_session, reported_prop, status="Open")

    resp = client.get(f"/api/v1/admin/trust/properties?city={city}&reported=true", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    ids = [item["property_id"] for item in resp.json()]
    assert reported_prop.id in ids
    assert clean_prop.id not in ids

    resp2 = client.get(f"/api/v1/admin/trust/properties?city={city}&reported=false", headers=admin_headers)
    ids2 = [item["property_id"] for item in resp2.json()]
    assert clean_prop.id in ids2
    assert reported_prop.id not in ids2


def test_moderation_list_filter_by_mediator_verified(client, db_session):
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)
    verified_med = _make_mediator(db_session, is_verified=True)
    unverified_med = _make_mediator(db_session, is_verified=False)
    verified_prop = _make_property(db_session, city=city, mediator_id=verified_med.id)
    unverified_prop = _make_property(db_session, city=city, mediator_id=unverified_med.id)

    resp = client.get(f"/api/v1/admin/trust/properties?city={city}&mediator_verified=true", headers=admin_headers)
    ids = [item["property_id"] for item in resp.json()]
    assert verified_prop.id in ids
    assert unverified_prop.id not in ids


def test_moderation_list_filter_by_stale(client, db_session):
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)
    old = datetime.now(timezone.utc) - timedelta(days=500)
    stale_prop = _make_property(db_session, city=city, created_at=old, updated_at=old)
    fresh_prop = _make_property(db_session, city=city)

    resp = client.get(f"/api/v1/admin/trust/properties?city={city}&stale=true", headers=admin_headers)
    ids = [item["property_id"] for item in resp.json()]
    assert stale_prop.id in ids
    assert fresh_prop.id not in ids


def test_moderation_list_filter_combination(client, db_session):
    """rent + reported=true + city together should narrow to exactly the
    matching property, proving filters compose (AND), not just work alone."""
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)
    target = _make_property(db_session, city=city, listing_type="rent")
    _make_report(db_session, target, status="Open")
    # Distractor: reported but wrong transaction type.
    other = _make_property(db_session, city=city, listing_type="sale", sale_price=500000.0, monthly_rent=None)
    _make_report(db_session, other, status="Open")

    resp = client.get(
        f"/api/v1/admin/trust/properties?city={city}&transaction_type=rent&reported=true", headers=admin_headers
    )
    ids = [item["property_id"] for item in resp.json()]
    assert target.id in ids
    assert other.id not in ids


# ── Review detail ─────────────────────────────────────────────────────────

def test_review_detail_assembly(client, db_session):
    city = _city()
    admin_headers, _admin = _admin_headers(db_session)
    mediator = _make_mediator(db_session, is_verified=True)
    subject = _make_property(db_session, city=city, mediator_id=mediator.id)
    report = _make_report(db_session, subject, reason="fraudulent_or_scam")

    resp = client.get(f"/api/v1/admin/trust/properties/{subject.id}", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["property_id"] == subject.id
    assert body["trust"]["property_id"] == subject.id
    assert 0 <= body["trust"]["overall_score"] <= 100
    assert body["data_quality"]["completeness"]["score"] >= 0
    assert isinstance(body["data_quality"]["missing_field_suggestions"], list)
    assert body["mediator"] is not None
    assert body["mediator"]["is_verified"] is True
    assert body["mediator_approval_status"] == "approved"
    assert any(r["id"] == report.id for r in body["reports"])
    assert isinstance(body["moderation_history"], list)


def test_review_detail_no_mediator(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city())

    resp = client.get(f"/api/v1/admin/trust/properties/{subject.id}", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mediator"] is None
    assert body["mediator_approval_status"] is None


def test_review_detail_404_for_unknown_property(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    resp = client.get("/api/v1/admin/trust/properties/9999999", headers=admin_headers)
    assert resp.status_code == 404


def test_review_detail_includes_moderation_history_after_hide(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city())

    hide_resp = client.post(f"/api/v1/admin/trust/properties/{subject.id}/hide", headers=admin_headers)
    assert hide_resp.status_code == 200, hide_resp.text

    resp = client.get(f"/api/v1/admin/trust/properties/{subject.id}", headers=admin_headers)
    body = resp.json()
    actions = [h["action"] for h in body["moderation_history"]]
    assert "property.admin_hidden" in actions


# ── Hide / restore actions ───────────────────────────────────────────────

def test_hide_and_restore_roundtrip_with_audit_log(client, db_session):
    admin_headers, admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city(), status="Published")

    hide_resp = client.post(
        f"/api/v1/admin/trust/properties/{subject.id}/hide", json={"reason": "policy_review"}, headers=admin_headers
    )
    assert hide_resp.status_code == 200, hide_resp.text
    assert hide_resp.json()["status"] == "Hidden"

    reloaded = db_session.get(Property, subject.id)
    db_session.refresh(reloaded)
    assert reloaded.status == "Hidden"

    audit_entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "property.admin_hidden", AuditLog.entity_id == str(subject.id))
    ).first()
    assert audit_entry is not None
    assert audit_entry.user_id == admin.id
    assert audit_entry.extra_metadata["reason"] == "policy_review"

    restore_resp = client.post(f"/api/v1/admin/trust/properties/{subject.id}/restore", headers=admin_headers)
    assert restore_resp.status_code == 200, restore_resp.text
    assert restore_resp.json()["status"] == "Published"

    reloaded2 = db_session.get(Property, subject.id)
    db_session.refresh(reloaded2)
    assert reloaded2.status == "Published"

    restore_audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "property.admin_restored", AuditLog.entity_id == str(subject.id))
    ).first()
    assert restore_audit is not None


def test_hide_already_hidden_returns_409(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city(), status="Hidden")

    resp = client.post(f"/api/v1/admin/trust/properties/{subject.id}/hide", headers=admin_headers)
    assert resp.status_code == 409


def test_restore_not_hidden_returns_409(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city(), status="Published")

    resp = client.post(f"/api/v1/admin/trust/properties/{subject.id}/restore", headers=admin_headers)
    assert resp.status_code == 409


def test_hide_404_for_unknown_property(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    resp = client.post("/api/v1/admin/trust/properties/9999999/hide", headers=admin_headers)
    assert resp.status_code == 404


# ── Resolve report ───────────────────────────────────────────────────────

def test_resolve_report_transitions_and_is_audit_logged(client, db_session):
    admin_headers, admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city())
    report = _make_report(db_session, subject, status="Open")

    resp = client.post(
        f"/api/v1/admin/trust/reports/{report.id}/resolve",
        json={"status": "Resolved", "resolution_notes": "Verified in person — listing is accurate."},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "Resolved"
    assert body["resolved_by"] == admin.id
    assert body["resolved_at"] is not None
    assert body["resolution_notes"] == "Verified in person — listing is accurate."

    reloaded = db_session.get(PropertyReport, report.id)
    db_session.refresh(reloaded)
    assert reloaded.status == "Resolved"
    assert reloaded.resolved_by == admin.id

    audit_entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "property_report.resolved", AuditLog.entity_id == str(report.id))
    ).first()
    assert audit_entry is not None
    assert audit_entry.extra_metadata["previous_status"] == "Open"
    assert audit_entry.extra_metadata["new_status"] == "Resolved"


def test_resolve_report_to_under_review_does_not_set_resolved_at(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city())
    report = _make_report(db_session, subject, status="Open")

    resp = client.post(
        f"/api/v1/admin/trust/reports/{report.id}/resolve", json={"status": "Under Review"}, headers=admin_headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "Under Review"
    assert body["resolved_at"] is None
    assert body["resolved_by"] is None


def test_resolve_report_dismissed(client, db_session):
    admin_headers, admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city())
    report = _make_report(db_session, subject, status="Open")

    resp = client.post(
        f"/api/v1/admin/trust/reports/{report.id}/resolve", json={"status": "Dismissed"}, headers=admin_headers
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "Dismissed"
    assert body["resolved_by"] == admin.id


def test_resolve_already_resolved_report_returns_409(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city())
    report = _make_report(db_session, subject, status="Resolved", resolved_at=datetime.now(timezone.utc))

    resp = client.post(
        f"/api/v1/admin/trust/reports/{report.id}/resolve", json={"status": "Dismissed"}, headers=admin_headers
    )
    assert resp.status_code == 409


def test_resolve_report_invalid_status_rejected(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    subject = _make_property(db_session, city=_city())
    report = _make_report(db_session, subject, status="Open")

    resp = client.post(
        f"/api/v1/admin/trust/reports/{report.id}/resolve", json={"status": "NotARealStatus"}, headers=admin_headers
    )
    assert resp.status_code == 422


def test_resolve_report_404_for_unknown_report(client, db_session):
    admin_headers, _admin = _admin_headers(db_session)
    resp = client.post(
        "/api/v1/admin/trust/reports/9999999/resolve", json={"status": "Resolved"}, headers=admin_headers
    )
    assert resp.status_code == 404
