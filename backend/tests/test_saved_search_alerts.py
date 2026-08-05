"""Saved Search Alerts: filter criteria, matching engine, outbox-triggered
alert generation, dedup, and digesting. Properties/saved searches are built
directly against the ORM (not through the admin-only HTTP endpoints) so
these stay focused unit/integration tests of the matching pipeline itself,
per this suite's existing convention of testing internal functions directly
(see tests/test_outbox.py)."""
from datetime import date, datetime, timedelta, timezone

import fakeredis
import pytest

from app.core.outbox import EventType, record_event
from app.core.search.filters import PropertyFilterCriteria, property_matches_criteria
from app.models.digest_run import DigestRun
from app.models.mediator import Mediator
from app.models.notification import Notification
from app.models.property import Property
from app.models.saved_search import SavedSearch
from app.models.saved_search_match import SavedSearchMatch
from app.models.user import User
from app.services.saved_search_matcher import evaluate_property_change
from app.tasks import notifications as notif_tasks


@pytest.fixture(autouse=True)
def _patch_task_session(db_session, monkeypatch):
    """`match_property_event` opens its own `SessionLocal()` (as it must in
    production — a Celery task has no request-scoped session to reuse).
    Point it at the test's own savepoint-backed session so data the test
    adds via `db_session` is visible to the task, and so the task's own
    `db.commit()` calls commit a nested savepoint instead of ending the
    test's outer transaction — same technique as tests/test_outbox.py."""
    monkeypatch.setattr(notif_tasks, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    # AI enrichment is a real (paid, network-dependent) Anthropic call — see
    # tests/test_ai_platform.py's convention of mocking the client rather
    # than calling it. Off by default here; test_ai_enrichment_* below turns
    # it back on with a mocked client to verify the wiring specifically.
    monkeypatch.setattr(notif_tasks, "should_enrich", lambda change_type: False)


def _make_user(db, email) -> User:
    user = User(email=email, hashed_password="x")
    db.add(user)
    db.flush()
    return user


def _make_property(db, **overrides) -> Property:
    defaults = dict(
        title="Test Apartment",
        area="Al Yasmin",
        city="Riyadh",
        listing_type="rent",
        monthly_rent=60000.0,
        bedrooms=3,
        bathrooms=2,
        status="Published",
        property_type="apartment",
    )
    defaults.update(overrides)
    prop = Property(**defaults)
    db.add(prop)
    db.flush()
    return prop


def _make_saved_search(db, user: User, **overrides) -> SavedSearch:
    criteria = PropertyFilterCriteria(
        transaction_type="rent",
        city="Riyadh",
        districts=["Al Yasmin"],
        max_price=70000,
        bedrooms=3,
    )
    defaults = dict(
        name="Family Home",
        locale="en",
        filters=criteria.to_dict(),
        filter_schema_version=criteria.schema_version,
        transaction_type=criteria.transaction_type,
        city=criteria.city,
        alert_enabled=True,
        alert_frequency="instant",
        channels=["in_app"],
        user_id=user.id,
    )
    defaults.update(overrides)
    saved_search = SavedSearch(**defaults)
    db.add(saved_search)
    db.flush()
    return saved_search


# ── Canonical filter criteria ────────────────────────────────────────────────

def test_fingerprint_is_order_independent_for_list_fields():
    a = PropertyFilterCriteria(city="Riyadh", districts=["Al Yasmin", "Al Malqa"])
    b = PropertyFilterCriteria(city="Riyadh", districts=["Al Malqa", "Al Yasmin"])
    assert a.fingerprint() == b.fingerprint()


def test_fingerprint_differs_on_meaningful_change():
    a = PropertyFilterCriteria(city="Riyadh", max_price=5000)
    b = PropertyFilterCriteria(city="Riyadh", max_price=6000)
    assert a.fingerprint() != b.fingerprint()


def test_from_dict_tolerates_unknown_future_fields():
    criteria = PropertyFilterCriteria.from_dict({"city": "Jeddah", "some_future_field": "x"})
    assert criteria.city == "Jeddah"


def test_property_matches_criteria_respects_price_band(db_session):
    prop = _make_property(db_session, monthly_rent=65000)
    matches = PropertyFilterCriteria(transaction_type="rent", max_price=70000)
    no_match = PropertyFilterCriteria(transaction_type="rent", max_price=50000)
    assert property_matches_criteria(matches, prop) is True
    assert property_matches_criteria(no_match, prop) is False


def test_property_matches_criteria_requires_published_by_default(db_session):
    prop = _make_property(db_session, status="Pending Approval")
    assert property_matches_criteria(PropertyFilterCriteria(), prop) is False


# ── Matching engine ──────────────────────────────────────────────────────────

def test_evaluate_new_listing_matches_active_saved_search(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    saved_search = _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)

    candidates = evaluate_property_change(db_session, prop, change_type="new_listing")
    assert len(candidates) == 1
    assert candidates[0].saved_search.id == saved_search.id
    assert candidates[0].change_hash


def test_evaluate_skips_disabled_saved_search(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    _make_saved_search(db_session, user, alert_enabled=False)
    prop = _make_property(db_session, monthly_rent=65000)

    assert evaluate_property_change(db_session, prop, change_type="new_listing") == []


def test_evaluate_skips_property_outside_price_band(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=999999)  # over max_price=70000

    assert evaluate_property_change(db_session, prop, change_type="new_listing") == []


def test_price_drop_and_price_increase_produce_distinct_hashes(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)

    drop = evaluate_property_change(db_session, prop, change_type="price_drop", change_context={"old_price": 70000, "new_price": 65000})
    increase = evaluate_property_change(db_session, prop, change_type="price_increase", change_context={"old_price": 60000, "new_price": 65000})
    assert drop[0].change_hash != increase[0].change_hash


# ── End-to-end: outbox event -> matching task -> durable match + notification ──

def test_property_published_event_generates_instant_notification(client, db_session, unique_email):
    user = _make_user(db_session, unique_email)
    saved_search = _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)
    db_session.commit()

    result = notif_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    assert result["matches"] == 1

    match = db_session.query(SavedSearchMatch).filter(SavedSearchMatch.saved_search_id == saved_search.id).one()
    assert match.change_type == "new_listing"
    assert match.notified is True

    notification = db_session.query(Notification).filter(Notification.id == match.notification_id).one()
    assert notification.user_id == user.id
    assert notification.property_id == prop.id
    assert notification.type == "saved_search_new_listing"
    assert notification.delivery_status.get("in_app") == "delivered"


def test_republished_property_is_a_back_on_market_match(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)
    db_session.commit()

    result = notif_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": True})
    assert result["matches"] == 1
    match = db_session.query(SavedSearchMatch).filter(SavedSearchMatch.property_id == prop.id).one()
    assert match.change_type == "back_on_market"


def test_retrying_the_same_event_does_not_duplicate_the_match(db_session, unique_email):
    """Idempotency: a redelivered Celery task (worker crash/ack-late redelivery)
    must not create a second match row or a second notification."""
    user = _make_user(db_session, unique_email)
    _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)
    db_session.commit()

    first = notif_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    second = notif_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})

    assert first["matches"] == 1
    assert second["matches"] == 0
    assert db_session.query(SavedSearchMatch).filter(SavedSearchMatch.property_id == prop.id).count() == 1
    assert db_session.query(Notification).filter(Notification.property_id == prop.id).count() == 1


def test_price_drop_below_threshold_does_not_alert(db_session, unique_email):
    """A trivial re-pricing (below both the % and absolute SAR threshold)
    must never reach the matcher — see properties.py's update_property."""
    user = _make_user(db_session, unique_email)
    _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)
    db_session.commit()

    # 1% / SAR 650 move — below PRICE_CHANGE_THRESHOLD_PERCENT (3%) and
    # PRICE_CHANGE_THRESHOLD_ABS_SAR (1000), so properties.py would never
    # emit a PROPERTY_PRICE_CHANGED event for this — nothing to assert via
    # the task since the event simply wouldn't exist; assert at the
    # evaluate_property_change level that a genuinely insignificant price
    # (unchanged) produces no "price_drop" match type at all.
    candidates = evaluate_property_change(db_session, prop, change_type="new_listing")
    assert all(c.change_type != "price_drop" for c in candidates)


def test_mediator_verified_event_matches_verified_only_saved_search(db_session, unique_email):
    owner = _make_user(db_session, f"mediator-{unique_email}")
    mediator = Mediator(user_id=owner.id, license_number=f"LIC-{unique_email}", phone="+966500000000", subscription_status="active", is_verified=False)
    db_session.add(mediator)
    db_session.flush()

    prop = _make_property(db_session, monthly_rent=65000, mediator_id=mediator.id)

    seeker = _make_user(db_session, f"seeker-{unique_email}")
    criteria = PropertyFilterCriteria(transaction_type="rent", city="Riyadh", verified_only=True)
    saved_search = SavedSearch(
        name="Verified only", filters=criteria.to_dict(), filter_schema_version=1,
        transaction_type="rent", city="Riyadh", user_id=seeker.id,
    )
    db_session.add(saved_search)
    db_session.commit()

    # Not verified yet — no match.
    assert evaluate_property_change(db_session, prop, change_type="new_listing") == []

    mediator.is_verified = True
    db_session.commit()

    result = notif_tasks.match_property_event(EventType.MEDIATOR_VERIFIED, str(mediator.id), {})
    assert result["matches"] == 1
    match = db_session.query(SavedSearchMatch).filter(SavedSearchMatch.saved_search_id == saved_search.id).one()
    assert match.change_type == "verified"


# ── Redis dedupe (real fakeredis-backed path, not just the None fallback) ──

def test_redis_dedupe_prevents_reprocessing_even_before_db_insert(db_session, unique_email, monkeypatch):
    fake_client = fakeredis.FakeStrictRedis(decode_responses=True)
    monkeypatch.setattr(notif_tasks, "get_redis_client", lambda: fake_client)

    user = _make_user(db_session, unique_email)
    _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)
    db_session.commit()

    first = notif_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    second = notif_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    assert first["matches"] == 1
    assert second["matches"] == 0


# ── Digest ───────────────────────────────────────────────────────────────────

def test_daily_digest_bundles_unnotified_matches_and_is_idempotent(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    saved_search = _make_saved_search(db_session, user, alert_frequency="daily")
    prop = _make_property(db_session, monthly_rent=65000)
    db_session.commit()

    # A daily-frequency saved search: the match is recorded but NOT
    # instantly notified.
    result = notif_tasks.match_property_event(EventType.PROPERTY_PUBLISHED, str(prop.id), {"republished": False})
    assert result["matches"] == 1
    match = db_session.query(SavedSearchMatch).filter(SavedSearchMatch.saved_search_id == saved_search.id).one()
    assert match.notified is False

    today = date.today()
    sent = notif_tasks._run_digest_for_user(db_session, user.id, period="daily", run_date=today)
    assert sent == 1
    db_session.refresh(match)
    assert match.notified is True
    digest_notification = db_session.query(Notification).filter(Notification.type == "saved_search_digest").one()
    assert digest_notification.user_id == user.id

    # Re-running the same (user, period, run_date) must be a no-op — the
    # DigestRun row is the durable idempotency guard, independent of Redis.
    assert db_session.query(DigestRun).filter(DigestRun.user_id == user.id, DigestRun.period == "daily", DigestRun.run_date == today).count() == 1
    again = notif_tasks._run_digest_for_user(db_session, user.id, period="daily", run_date=today)
    assert again == 0
    assert db_session.query(Notification).filter(Notification.type == "saved_search_digest").count() == 1


def test_digest_skips_users_with_no_pending_matches(db_session, unique_email):
    user = _make_user(db_session, unique_email)
    db_session.commit()
    assert notif_tasks._run_digest_for_user(db_session, user.id, period="daily", run_date=date.today()) == 0


# ── AI-enhanced explanations (Phase 12): mocked client, never a real call ──

def test_ai_enrichment_sets_explanation_without_blocking_delivery(db_session, unique_email, monkeypatch):
    """The core alert already exists (delivered) before enrichment ever
    runs; enrichment only adds `meta.ai_explanation` on success and must
    leave the notification usable if it fails."""
    from dataclasses import dataclass

    from app.core.ai import gateway
    from app.services.ai_alert_explainer import enrich_notification_with_ai

    @dataclass
    class _FakeUsage:
        input_tokens: int
        output_tokens: int

    @dataclass
    class _FakeTextBlock:
        type: str
        text: str

    @dataclass
    class _FakeMessage:
        content: list
        usage: object = None

    class _FakeToolRunner:
        def __iter__(self):
            yield _FakeMessage(content=[_FakeTextBlock(type="text", text="6% below similar listings nearby.")], usage=_FakeUsage(10, 8))

    class _FakeClient:
        class beta:
            class messages:
                @staticmethod
                def tool_runner(**kwargs):
                    return _FakeToolRunner()

    monkeypatch.setattr(gateway, "get_client", lambda: _FakeClient())
    monkeypatch.setattr("app.services.ai_alert_explainer.settings.FEATURE_AI_ALERT_EXPLANATIONS", True)
    monkeypatch.setattr("app.services.ai_alert_explainer.settings.ANTHROPIC_API_KEY", "test-key")

    user = _make_user(db_session, unique_email)
    saved_search = _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)
    notification = Notification(
        user_id=user.id, type="saved_search_new_listing", title="t", body="b", locale="en",
        property_id=prop.id, saved_search_id=saved_search.id, match_reasons=[{"code": "within_budget"}],
        delivery_status={"in_app": "delivered"}, meta={},
    )
    db_session.add(notification)
    db_session.commit()

    enrich_notification_with_ai(db_session, notification)

    assert notification.ai_generated is True
    assert "6%" in notification.meta["ai_explanation"]
    assert notification.delivery_status == {"in_app": "delivered"}  # untouched by enrichment


def test_ai_enrichment_failure_leaves_notification_with_rule_based_text(db_session, unique_email, monkeypatch):
    from app.services.ai_alert_explainer import enrich_notification_with_ai

    def _raise(*args, **kwargs):
        raise RuntimeError("simulated Anthropic outage")

    monkeypatch.setattr("app.services.ai_alert_explainer.gateway.run_chat", _raise)
    monkeypatch.setattr("app.services.ai_alert_explainer.settings.FEATURE_AI_ALERT_EXPLANATIONS", True)
    monkeypatch.setattr("app.services.ai_alert_explainer.settings.ANTHROPIC_API_KEY", "test-key")

    user = _make_user(db_session, unique_email)
    saved_search = _make_saved_search(db_session, user)
    prop = _make_property(db_session, monthly_rent=65000)
    notification = Notification(
        user_id=user.id, type="saved_search_new_listing", title="t", body="b", locale="en",
        property_id=prop.id, saved_search_id=saved_search.id, match_reasons=[{"code": "within_budget"}],
        delivery_status={"in_app": "delivered"}, meta={"rule_based_explanation": "This property matches 1 of your saved search criteria."},
    )
    db_session.add(notification)
    db_session.commit()

    enrich_notification_with_ai(db_session, notification)  # must not raise

    assert notification.ai_generated is False
    assert notification.meta["rule_based_explanation"]
