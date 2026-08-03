"""Background job tests. No real Celery worker/broker runs in this dev
environment, so these exercise: (1) task logic directly via Celery's own
`.apply()` (synchronous, in-process — the same mechanism `enqueue()` falls
back to), and (2) the `enqueue()` fallback decision itself.
"""
from app.core.celery_app import ALL_QUEUES, celery_app
from app.core.jobs import enqueue
from app.models.lead import Lead
from app.models.property import Property
from app.models.user import User
from app.tasks.area_intelligence import refresh_district
from app.tasks.leads import generate_lead_suggestions


def test_all_queues_are_distinct():
    assert len(ALL_QUEUES) == len(set(ALL_QUEUES)) == 7


def test_task_routes_assign_expected_queues():
    routes = celery_app.conf.task_routes
    assert routes["app.tasks.leads.*"]["queue"] == "default"
    assert routes["app.tasks.area_intelligence.*"]["queue"] == "data_ingestion"


def test_enqueue_falls_back_to_inline_execution_when_redis_unavailable(monkeypatch):
    monkeypatch.setattr("app.core.jobs.is_redis_available", lambda: False)
    calls = []

    @celery_app.task(name="test.jobs.record_call")
    def _record(value):
        calls.append(value)
        return value

    result = enqueue(_record, "hello")
    assert calls == ["hello"]
    assert result.result == "hello"


def test_generate_lead_suggestions_matches_published_properties_in_area(db_session, unique_email):
    # A unique area name (not a real seeded district) so this test's matches
    # can't collide with the 145 pre-existing seeded properties in the dev DB.
    area = f"Test District {unique_email}"

    user = User(email=unique_email, hashed_password="x")
    db_session.add(user)
    db_session.flush()

    lead = Lead(
        customer_user_id=user.id,
        customer_name="Test Customer",
        customer_phone="+966500000000",
        customer_email="lead@example.com",
        area_name=area,
        city="Riyadh",
        max_budget=6000,
        bedrooms_needed=2,
        status="pending_review",
    )
    db_session.add(lead)
    db_session.flush()

    matching = Property(
        title="Matching flat", area=area, city="Riyadh", listing_type="rent",
        monthly_rent=5000, bedrooms=2, status="Published",
    )
    non_matching_area = Property(
        title="Wrong area", area="Al Malqa", city="Riyadh", listing_type="rent",
        monthly_rent=5000, bedrooms=2, status="Published",
    )
    unpublished = Property(
        title="Unpublished", area=area, city="Riyadh", listing_type="rent",
        monthly_rent=5000, bedrooms=2, status="Draft",
    )
    db_session.add_all([matching, non_matching_area, unpublished])
    db_session.commit()

    # generate_lead_suggestions() opens its own SessionLocal() (a fresh
    # connection outside this test's transaction) — since our test data lives
    # only in an uncommitted SAVEPOINT on the test's connection, a genuinely
    # separate connection wouldn't see it. Call the underlying matching logic
    # directly (as the task body does) against the test's own session
    # instead, which is what's actually under test here.
    from app.tasks.leads import suggest_properties
    suggestions = suggest_properties(lead, db_session)

    assert len(suggestions) == 1
    assert suggestions[0].property_id == matching.id


def test_refresh_district_skips_missing_row():
    result = refresh_district.apply(args=(999_999_999,)).result
    assert result is False


def test_generate_lead_suggestions_skips_missing_lead():
    result = generate_lead_suggestions.apply(args=(999_999_999,)).result
    assert result == 0
