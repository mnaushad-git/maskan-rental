"""POST /properties/{id}/reports — auth requirement, creation +
audit-logging, one-active-report-per-user/property/reason rejection (409),
a different reason or a resolved/dismissed prior report being allowed
again, invalid reason validation, and 404 for an unknown property.
"""
import uuid

from sqlalchemy import select

from app.api.routes.auth import create_access_token
from app.models.audit_log import AuditLog
from app.models.property import Property
from app.models.property_report import PropertyReport
from app.models.user import User


def _city() -> str:
    return f"ReportCity-{uuid.uuid4().hex[:8]}"


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Reportable Property", area="Test District", city="ReportCity", listing_type="rent",
        status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0,
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    db.commit()
    return prop


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"reporter-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _auth_headers(db) -> tuple[dict, User]:
    user = _make_user(db)
    token = create_access_token(user.id)
    return {"Authorization": f"Bearer {token}"}, user


def test_report_requires_auth(client, db_session):
    subject = _make_property(db_session, city=_city())
    resp = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "duplicate_listing"})
    assert resp.status_code == 401


def test_report_creation_succeeds_and_is_audit_logged(client, db_session):
    subject = _make_property(db_session, city=_city())
    headers, user = _auth_headers(db_session)

    resp = client.post(
        f"/api/v1/properties/{subject.id}/reports",
        json={"reason": "incorrect_information", "comment": "Bedrooms count looks wrong"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["property_id"] == subject.id
    assert body["reporter_user_id"] == user.id
    assert body["reason"] == "incorrect_information"
    assert body["status"] == "Open"
    assert body["resolved_at"] is None

    report = db_session.get(PropertyReport, body["id"])
    assert report is not None

    audit_entry = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "property.reported", AuditLog.entity_id == str(report.id))
    ).first()
    assert audit_entry is not None
    assert audit_entry.user_id == user.id
    assert audit_entry.extra_metadata["property_id"] == subject.id


def test_duplicate_active_report_same_reason_rejected(client, db_session):
    subject = _make_property(db_session, city=_city())
    headers, _user = _auth_headers(db_session)

    first = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "duplicate_listing"}, headers=headers)
    assert first.status_code == 201, first.text

    second = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "duplicate_listing"}, headers=headers)
    assert second.status_code == 409


def test_different_reason_from_same_user_is_allowed(client, db_session):
    subject = _make_property(db_session, city=_city())
    headers, _user = _auth_headers(db_session)

    first = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "duplicate_listing"}, headers=headers)
    assert first.status_code == 201, first.text

    second = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "no_longer_available"}, headers=headers)
    assert second.status_code == 201, second.text


def test_resubmission_allowed_after_prior_report_resolved(client, db_session):
    subject = _make_property(db_session, city=_city())
    headers, user = _auth_headers(db_session)

    first = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "duplicate_listing"}, headers=headers)
    assert first.status_code == 201, first.text

    report = db_session.get(PropertyReport, first.json()["id"])
    report.status = "Resolved"
    db_session.commit()

    second = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "duplicate_listing"}, headers=headers)
    assert second.status_code == 201, second.text


def test_invalid_reason_rejected(client, db_session):
    subject = _make_property(db_session, city=_city())
    headers, _user = _auth_headers(db_session)

    resp = client.post(f"/api/v1/properties/{subject.id}/reports", json={"reason": "not_a_real_reason"}, headers=headers)
    assert resp.status_code == 422


def test_report_unknown_property_404s(client, db_session):
    headers, _user = _auth_headers(db_session)
    resp = client.post("/api/v1/properties/9999999/reports", json={"reason": "duplicate_listing"}, headers=headers)
    assert resp.status_code == 404
