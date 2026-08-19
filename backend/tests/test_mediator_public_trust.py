"""GET /mediators/public + /mediators/{id}/public (Prompt 4 — Property
Verification & Trust Center, spec section 11) — Trust & Activity fields
added to the mediator public profile: verification label, rating/review
count, active/rental/sale listing counts, member-since, and response info.
All deterministic (no LLM here — that's the separate review-summary
endpoint, covered in test_review_summary.py).
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.models.lead import Lead, LeadAssignment
from app.models.mediator import Mediator
from app.models.property import Property
from app.models.review import Review
from app.models.user import User
from app.schemas.mediator import MEDIATOR_VERIFIED_LABEL


def _city() -> str:
    return f"MedPublicCity-{uuid.uuid4().hex[:8]}"


def _make_user(db, **overrides) -> User:
    defaults = dict(email=f"med-public-{uuid.uuid4().hex[:8]}@example.com", hashed_password="x")
    defaults.update(overrides)
    user = User(**defaults)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_mediator(db, **overrides) -> Mediator:
    user = _make_user(db)
    defaults = dict(
        user_id=user.id, license_number=f"LIC-{uuid.uuid4().hex[:6]}", phone="0500000001",
        subscription_status="active", is_verified=False,
    )
    defaults.update(overrides)
    mediator = Mediator(**defaults)
    db.add(mediator)
    db.commit()
    db.refresh(mediator)
    return mediator


def _make_property(db, mediator: Mediator, **overrides) -> Property:
    defaults = dict(
        title="Public Trust Test Property", area="Test District", city="MedPublicCity",
        listing_type="rent", status="Published", bedrooms=2, bathrooms=1, monthly_rent=4000.0,
        mediator_id=mediator.id,
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return prop


def _make_review(db, mediator: Mediator, rating: int, status: str = "approved", comment: str | None = None) -> Review:
    reviewer = _make_user(db)
    review = Review(mediator_id=mediator.id, user_id=reviewer.id, rating=rating, status=status, comment=comment)
    db.add(review)
    db.commit()
    db.refresh(review)
    return review


def _make_lead(db) -> Lead:
    customer = _make_user(db)
    lead = Lead(
        customer_user_id=customer.id, customer_name="Test Customer", customer_phone="0500000002",
        customer_email=f"lead-{uuid.uuid4().hex[:8]}@example.com", area_name="Test District", city="MedPublicCity",
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


def _make_assignment(db, mediator: Mediator, *, status: str, assigned_at=None, accepted_at=None) -> LeadAssignment:
    lead = _make_lead(db)
    now = datetime.now(timezone.utc)
    assignment = LeadAssignment(
        lead_id=lead.id, mediator_id=mediator.id, status=status,
        assigned_at=assigned_at or now, accepted_at=accepted_at, expires_at=now + timedelta(days=1),
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


# ── Verification wording ────────────────────────────────────────────────────

def test_verified_mediator_gets_the_one_allowed_verification_label(client, db_session):
    mediator = _make_mediator(db_session, is_verified=True)

    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["verification_label"] == "✓ Verified by myMakan"
    assert body["verification_label"] == MEDIATOR_VERIFIED_LABEL


def test_unverified_mediator_has_no_verification_label(client, db_session):
    mediator = _make_mediator(db_session, is_verified=False)

    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    assert resp.status_code == 200, resp.text
    assert resp.json()["verification_label"] is None


def test_no_disallowed_verification_phrase_ever_appears(client, db_session):
    mediator = _make_mediator(db_session, is_verified=True)
    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    text = resp.text
    for banned in ("Government Verified", "REGA Verified", "Ejar Verified", "Nafath Verified"):
        assert banned not in text


# ── Listing counts ───────────────────────────────────────────────────────────

def test_listing_counts_split_by_rent_sale_and_exclude_unpublished(client, db_session):
    mediator = _make_mediator(db_session)
    city = _city()
    _make_property(db_session, mediator, city=city, listing_type="rent", status="Published")
    _make_property(db_session, mediator, city=city, listing_type="rent", status="Published")
    _make_property(db_session, mediator, city=city, listing_type="sale", status="Published", sale_price=500000.0)
    _make_property(db_session, mediator, city=city, listing_type="rent", status="Draft")  # not counted

    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rental_listing_count"] == 2
    assert body["sale_listing_count"] == 1
    assert body["active_listing_count"] == 3


# ── Reviews ───────────────────────────────────────────────────────────────

def test_rating_and_review_count_use_approved_reviews_only(client, db_session):
    mediator = _make_mediator(db_session)
    _make_review(db_session, mediator, rating=5, status="approved")
    _make_review(db_session, mediator, rating=3, status="approved")
    _make_review(db_session, mediator, rating=1, status="pending")   # excluded
    _make_review(db_session, mediator, rating=1, status="rejected")  # excluded

    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["review_count"] == 2
    assert body["avg_rating"] == 4.0


def test_no_reviews_yields_none_rating_and_zero_count(client, db_session):
    mediator = _make_mediator(db_session)
    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    body = resp.json()
    assert body["avg_rating"] is None
    assert body["review_count"] == 0


# ── Member since ─────────────────────────────────────────────────────────

def test_member_since_matches_created_at(client, db_session):
    mediator = _make_mediator(db_session)
    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    body = resp.json()
    assert body["member_since"] is not None
    assert body["member_since"][:19] == body["created_at"][:19]


# ── Response info (from LeadAssignment) ─────────────────────────────────────

def test_response_fields_none_when_no_assignments(client, db_session):
    mediator = _make_mediator(db_session)
    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    body = resp.json()
    assert body["response_rate"] is None
    assert body["avg_response_time_hours"] is None


def test_response_rate_and_avg_response_time_computed_from_assignments(client, db_session):
    mediator = _make_mediator(db_session)
    now = datetime.now(timezone.utc)
    _make_assignment(db_session, mediator, status="accepted", assigned_at=now - timedelta(hours=5), accepted_at=now - timedelta(hours=3))  # 2h
    _make_assignment(db_session, mediator, status="accepted", assigned_at=now - timedelta(hours=10), accepted_at=now - timedelta(hours=8))  # 2h
    _make_assignment(db_session, mediator, status="rejected", assigned_at=now - timedelta(hours=2))

    resp = client.get(f"/api/v1/mediators/{mediator.id}/public")
    body = resp.json()
    assert body["response_rate"] == round(2 / 3, 2)
    assert body["avg_response_time_hours"] == 2.0


# ── List endpoint parity + N+1-safety ────────────────────────────────────────

def test_public_directory_list_matches_single_profile_trust_fields(client, db_session):
    city = _city()
    mediator = _make_mediator(db_session, is_verified=True)
    from app.models.mediator import MediatorArea
    db_session.add(MediatorArea(mediator_id=mediator.id, area_name="Test District", city=city))
    db_session.commit()
    _make_property(db_session, mediator, city=city, listing_type="rent", status="Published")
    _make_review(db_session, mediator, rating=5, status="approved")

    single = client.get(f"/api/v1/mediators/{mediator.id}/public").json()
    listing = client.get("/api/v1/mediators/public", params={"city": city}).json()
    match = next(m for m in listing if m["id"] == mediator.id)

    assert match["verification_label"] == single["verification_label"]
    assert match["review_count"] == single["review_count"] == 1
    assert match["avg_rating"] == single["avg_rating"] == 5.0
    assert match["rental_listing_count"] == single["rental_listing_count"] == 1


def test_unknown_mediator_public_profile_404s(client, db_session):
    resp = client.get("/api/v1/mediators/999999999/public")
    assert resp.status_code == 404
