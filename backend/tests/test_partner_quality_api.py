"""GET/POST /partner/properties/{id}/... (Prompt 3) — Partner Listing
Quality: completeness reuse consistency with Prompt 1/2's public /trust
endpoint, missing-field suggestion accuracy, deterministic image-quality
signals, and Confirm Availability's permission checks + persistence + audit
logging. "Improve with AI" grounding/fallback unit tests live in
test_partner_listing_ai.py (service-level, mirroring
test_property_intelligence_ai.py's split from its HTTP-level sibling) —
this file only covers improve-with-ai's auth/permission wiring and the
"never auto-saves" contract.
"""
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.api.routes.auth import create_access_token
from app.core.ai import gateway
from app.core.config import settings
from app.models.audit_log import AuditLog
from app.models.listing_image import ListingImage
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.user import User


def _city() -> str:
    return f"QualityCity-{uuid.uuid4().hex[:8]}"


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"partner-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_mediator(db, **overrides) -> tuple[Mediator, User]:
    user = _make_user(db)
    defaults = dict(
        user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000001",
        is_verified=True, subscription_status="active",
    )
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    return mediator, user


def _auth(user: User) -> dict:
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _make_property(db, mediator: Mediator | None = None, **overrides) -> Property:
    defaults = dict(
        title="Quality Test Property", area="Test District", city="QualityCity", listing_type="rent",
        status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0,
    )
    defaults.update(overrides)
    if mediator is not None:
        defaults["mediator_id"] = mediator.id
    prop = Property(**defaults)
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return prop


# ── Permission checks (mirrors properties.py's /partner/{id} ownership pattern) ──

def test_quality_requires_mediator_auth(client, db_session):
    mediator, _ = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())
    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality")
    assert resp.status_code == 401


def test_quality_forbidden_for_non_owning_mediator(client, db_session):
    owner, _ = _make_mediator(db_session)
    _other, other_user = _make_mediator(db_session)
    prop = _make_property(db_session, owner, city=_city())

    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(other_user))
    assert resp.status_code == 403


def test_quality_404_for_unknown_property(client, db_session):
    _, user = _make_mediator(db_session)
    resp = client.get("/api/v1/partner/properties/9999999/quality", headers=_auth(user))
    assert resp.status_code == 404


# ── Completeness reuse consistency with Prompt 1/2 ──────────────────────────

def test_quality_completeness_matches_public_trust_endpoint(client, db_session):
    mediator, user = _make_mediator(db_session)
    city = _city()
    prop = _make_property(
        db_session, mediator, city=city, description="A lovely test apartment.", size_sq_m=120,
        property_type="Apartment", contact_phone="0500000000", latitude=24.7, longitude=46.6, furnished="Furnished",
    )

    quality_resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(user))
    trust_resp = client.get(f"/api/v1/properties/{prop.id}/trust")
    assert quality_resp.status_code == 200, quality_resp.text
    assert trust_resp.status_code == 200, trust_resp.text

    quality_completeness = quality_resp.json()["completeness"]
    trust_completeness = trust_resp.json()["component_scores"]["completeness"]
    # Same underlying compute_listing_completeness() call -> identical result,
    # guaranteed by construction rather than by convention.
    assert quality_completeness == trust_completeness


# ── Missing-field suggestion accuracy ────────────────────────────────────

def test_quality_missing_field_suggestions_accuracy(client, db_session):
    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city(), description=None)

    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    suggestions = body["missing_field_suggestions"]
    assert "Add a description explaining what makes this property worth viewing." in suggestions
    assert "Upload at least one photo — listings with photos get far more interest." in suggestions
    # Missing required fields should be present and drive the completeness gap.
    assert body["completeness"]["missing_required"], "expected at least one missing required field"
    # Every missing field must produce exactly one suggestion, no duplicates dropped.
    assert len(suggestions) == len(body["completeness"]["missing_fields"])


def test_quality_field_present_removes_its_suggestion(client, db_session):
    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city(), description="Nice place with a great view.")

    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(user))
    body = resp.json()
    assert "Add a description explaining what makes this property worth viewing." not in body["missing_field_suggestions"]
    assert "Description" not in body["completeness"]["missing_fields"]


# ── Deterministic image-quality signals (spec section 9) ────────────────────

def test_image_quality_no_images(client, db_session):
    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())

    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(user))
    iq = resp.json()["image_quality"]
    assert iq["image_count"] == 0
    codes = [i["code"] for i in iq["issues"]]
    assert codes == ["no_images"]
    assert iq["has_blocking_issues"] is True


def test_image_quality_too_few_images(client, db_session):
    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())
    db_session.add(ListingImage(property_id=prop.id, url="https://example.com/1.jpg", display_order=0))
    db_session.commit()

    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(user))
    iq = resp.json()["image_quality"]
    codes = [i["code"] for i in iq["issues"]]
    assert "too_few_images" in codes
    assert "no_images" not in codes
    assert iq["image_count"] == 1


def test_image_quality_duplicate_images(client, db_session):
    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())
    db_session.add_all(
        [
            ListingImage(property_id=prop.id, url="https://example.com/1.jpg", display_order=0),
            ListingImage(property_id=prop.id, url="https://example.com/1.jpg", display_order=1),
            ListingImage(property_id=prop.id, url="https://example.com/2.jpg", display_order=2),
        ]
    )
    db_session.commit()

    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(user))
    codes = [i["code"] for i in resp.json()["image_quality"]["issues"]]
    assert "duplicate_images" in codes
    assert "too_few_images" not in codes  # 3 images present, meets the minimum


def test_image_quality_sufficient_unique_images_no_issues(client, db_session):
    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())
    db_session.add_all(
        [ListingImage(property_id=prop.id, url=f"https://example.com/{i}.jpg", display_order=i) for i in range(3)]
    )
    db_session.commit()

    resp = client.get(f"/api/v1/partner/properties/{prop.id}/quality", headers=_auth(user))
    iq = resp.json()["image_quality"]
    assert iq["image_count"] == 3
    assert iq["issues"] == []
    assert iq["has_blocking_issues"] is False


# ── Confirm Availability ─────────────────────────────────────────────────

def test_confirm_availability_requires_auth(client, db_session):
    mediator, _ = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())
    resp = client.post(f"/api/v1/partner/properties/{prop.id}/confirm-availability")
    assert resp.status_code == 401


def test_confirm_availability_forbidden_for_non_owning_mediator(client, db_session):
    owner, _ = _make_mediator(db_session)
    _other, other_user = _make_mediator(db_session)
    prop = _make_property(db_session, owner, city=_city())

    resp = client.post(f"/api/v1/partner/properties/{prop.id}/confirm-availability", headers=_auth(other_user))
    assert resp.status_code == 403


def test_confirm_availability_404_for_unknown_property(client, db_session):
    _, user = _make_mediator(db_session)
    resp = client.post("/api/v1/partner/properties/9999999/confirm-availability", headers=_auth(user))
    assert resp.status_code == 404


def test_confirm_availability_persists_and_audit_logged(client, db_session):
    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())
    assert prop.availability_confirmed_at is None

    resp = client.post(f"/api/v1/partner/properties/{prop.id}/confirm-availability", headers=_auth(user))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["property_id"] == prop.id
    assert body["availability_confirmed_at"] is not None

    reloaded = db_session.get(Property, prop.id)
    db_session.refresh(reloaded)
    assert reloaded.availability_confirmed_at is not None

    audit_entries = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == "property.availability_confirmed", AuditLog.entity_id == str(prop.id)
        )
    ).all()
    assert len(audit_entries) == 1
    assert audit_entries[0].user_id == user.id


def test_confirm_availability_reflected_in_trust_freshness(client, db_session):
    mediator, user = _make_mediator(db_session)
    city = _city()
    old = datetime.now(timezone.utc) - timedelta(days=500)
    prop = _make_property(db_session, mediator, city=city, created_at=old, updated_at=old)

    resp = client.post(f"/api/v1/partner/properties/{prop.id}/confirm-availability", headers=_auth(user))
    assert resp.status_code == 200, resp.text

    trust_resp = client.get(f"/api/v1/properties/{prop.id}/trust")
    body = trust_resp.json()
    assert body["component_scores"]["freshness"]["category"] == "Recently Confirmed"
    assert "Recently Confirmed" in body["positive_signals"]


# ── Improve with AI — auth/permission wiring + "never auto-saves" ──────────
# Grounding + fallback behavior of the underlying service is covered in
# test_partner_listing_ai.py.

def test_improve_with_ai_requires_auth(client, db_session):
    mediator, _ = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city())
    resp = client.post(f"/api/v1/partner/properties/{prop.id}/improve-with-ai", json={})
    assert resp.status_code == 401


def test_improve_with_ai_forbidden_for_non_owning_mediator(client, db_session):
    owner, _ = _make_mediator(db_session)
    _other, other_user = _make_mediator(db_session)
    prop = _make_property(db_session, owner, city=_city())

    resp = client.post(f"/api/v1/partner/properties/{prop.id}/improve-with-ai", json={}, headers=_auth(other_user))
    assert resp.status_code == 403


def test_improve_with_ai_returns_suggestion_and_never_auto_saves(client, db_session, monkeypatch):
    def _fake_run_chat(*, model, system, tools, messages, max_tokens):
        return gateway.ChatResult(
            reply='{"title": "Much Better Title", "description": null}', input_tokens=5, output_tokens=5
        )

    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(gateway, "run_chat", _fake_run_chat)

    mediator, user = _make_mediator(db_session)
    prop = _make_property(db_session, mediator, city=_city(), title="Original Title")

    resp = client.post(
        f"/api/v1/partner/properties/{prop.id}/improve-with-ai",
        json={"focus": "title", "language": "en"},
        headers=_auth(user),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["suggested_title"] == "Much Better Title"
    assert body["suggested_description"] is None
    assert body["generated_by"] == "ai"

    reloaded = db_session.get(Property, prop.id)
    db_session.refresh(reloaded)
    assert reloaded.title == "Original Title"  # explicit-approval-only: never auto-saved
