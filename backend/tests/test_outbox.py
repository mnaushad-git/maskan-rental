"""Transactional outbox tests: event-created-in-same-transaction, the
publisher marking events completed, retry-then-fail behavior, and duplicate-
publish protection (SKIP LOCKED + status check)."""
from app.core.outbox import EventType, record_event
from app.models.outbox_event import OutboxEvent
from app.tasks import outbox as outbox_tasks


def test_record_event_is_in_the_same_transaction_as_the_caller(db_session):
    """A rollback of the caller's transaction must also discard the event —
    that's the entire point of the outbox pattern (no orphaned events for a
    state change that never actually happened)."""
    record_event(db_session, event_type=EventType.LEAD_CREATED, aggregate_type="lead", aggregate_id=1, payload={"x": 1})
    db_session.flush()
    assert db_session.query(OutboxEvent).filter(OutboxEvent.aggregate_type == "lead", OutboxEvent.aggregate_id == "1").count() == 1

    db_session.rollback()
    assert db_session.query(OutboxEvent).filter(OutboxEvent.aggregate_type == "lead", OutboxEvent.aggregate_id == "1").count() == 0


def test_record_event_commits_alongside_caller_commit(db_session):
    record_event(db_session, event_type=EventType.REVIEW_SUBMITTED, aggregate_type="review", aggregate_id=42, payload={"rating": 5})
    db_session.commit()

    row = db_session.query(OutboxEvent).filter(OutboxEvent.aggregate_type == "review", OutboxEvent.aggregate_id == "42").one()
    assert row.status == "pending"
    assert row.published_at is None
    assert row.payload == {"rating": 5}


def test_publisher_marks_event_published(db_session, monkeypatch):
    monkeypatch.setattr("app.tasks.outbox.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)  # the publisher closes its session; don't close the test's

    record_event(db_session, event_type=EventType.SAVED_SEARCH_CREATED, aggregate_type="saved_search", aggregate_id=7, payload={})
    db_session.commit()

    result = outbox_tasks._publish_batch()
    assert result["published"] == 1
    assert result["failed"] == 0

    row = db_session.query(OutboxEvent).filter(OutboxEvent.aggregate_type == "saved_search", OutboxEvent.aggregate_id == "7").one()
    assert row.status == "published"
    assert row.published_at is not None


def test_publisher_retries_then_marks_failed_after_max_retries(db_session, monkeypatch):
    monkeypatch.setattr("app.tasks.outbox.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    def _always_raise(event):
        raise RuntimeError("simulated handler failure")

    monkeypatch.setitem(outbox_tasks._HANDLERS, EventType.LEAD_CREATED, _always_raise)

    record_event(db_session, event_type=EventType.LEAD_CREATED, aggregate_type="lead", aggregate_id=99, payload={})
    db_session.commit()

    for _ in range(outbox_tasks.MAX_RETRIES):
        outbox_tasks._publish_batch()

    row = db_session.query(OutboxEvent).filter(OutboxEvent.aggregate_type == "lead", OutboxEvent.aggregate_id == "99").one()
    assert row.status == "failed"
    assert row.retry_count == outbox_tasks.MAX_RETRIES


def test_publisher_does_not_reprocess_already_published_events(db_session, monkeypatch):
    monkeypatch.setattr("app.tasks.outbox.SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    record_event(db_session, event_type=EventType.PAYMENT_COMPLETED, aggregate_type="payment", aggregate_id=5, payload={})
    db_session.commit()

    first = outbox_tasks._publish_batch()
    second = outbox_tasks._publish_batch()

    assert first["published"] == 1
    assert second["published"] == 0  # already published, not picked up again


def test_publish_pending_events_skips_when_lock_unavailable(monkeypatch):
    monkeypatch.setattr("app.tasks.outbox.redis_lock", lambda *a, **k: _NeverAcquired())

    result = outbox_tasks.publish_pending_events()
    assert result["locked_out"] is True
    assert result["published"] == 0


class _NeverAcquired:
    def __enter__(self):
        return False

    def __exit__(self, *exc):
        return False


# ── End-to-end: real endpoints actually emit the events they claim to ──────

def test_lead_creation_endpoint_emits_lead_created_event(client, db_session, unique_email):
    signup = client.post("/api/auth/signup", json={"email": unique_email, "password": "S3cret!23"})
    token = signup.json()["access_token"]

    resp = client.post(
        "/api/leads/",
        json={
            "area_name": "Al Yasmin", "city": "Riyadh", "customer_name": "Outbox Test",
            "customer_phone": "+966500000000", "customer_email": "outbox-lead@example.com",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    lead_id = resp.json()["id"]

    event = db_session.query(OutboxEvent).filter(
        OutboxEvent.event_type == EventType.LEAD_CREATED,
        OutboxEvent.aggregate_id == str(lead_id),
    ).one()
    assert event.status == "pending"
    assert event.payload["area_name"] == "Al Yasmin"


def test_review_submission_endpoint_emits_review_submitted_event(client, db_session, unique_email):
    from app.models.mediator import Mediator
    from app.models.user import User

    user = User(email=unique_email, hashed_password="x")
    db_session.add(user)
    db_session.flush()
    mediator = Mediator(user_id=user.id, license_number="LIC-OUTBOX-1", phone="+966500000002", subscription_status="active")
    db_session.add(mediator)
    db_session.commit()

    signup = client.post("/api/auth/signup", json={"email": f"reviewer-{unique_email}", "password": "S3cret!23"})
    token = signup.json()["access_token"]

    resp = client.post(
        "/api/reviews/",
        json={"mediator_id": mediator.id, "rating": 5, "comment": "Great service"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201
    review_id = resp.json()["id"]

    event = db_session.query(OutboxEvent).filter(
        OutboxEvent.event_type == EventType.REVIEW_SUBMITTED,
        OutboxEvent.aggregate_id == str(review_id),
    ).one()
    assert event.payload["mediator_id"] == mediator.id
