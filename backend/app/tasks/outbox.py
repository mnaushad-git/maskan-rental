"""Outbox publisher: picks up pending `outbox_events` rows and hands each to
its registered handler (or just marks it published if there isn't one yet —
most event types don't have a real downstream consumer today; the table
exists so one can be added later without touching the code that emits the
events). Runs on the `scheduled_jobs` queue, triggered periodically by the
existing APScheduler loop in app/main.py (see `_schedule_outbox_publisher`).

A distributed lock (Redis, falls back to Postgres advisory lock's sibling —
actually just "skip this run" — when Redis is down) prevents two concurrent
publisher runs from double-processing the same batch across replicas.
`SELECT ... FOR UPDATE SKIP LOCKED` provides the same protection at the SQL
level even without the lock, so a missed lock (Redis down) degrades to "a
little redundant work," never duplicate delivery.
"""
import logging
from collections.abc import Callable
from datetime import datetime, timezone

from app.core.celery_app import celery_app
from app.core.distributed_lock import redis_lock
from app.core.outbox import EventType
from app.db.session import SessionLocal
from app.models.outbox_event import OutboxEvent

logger = logging.getLogger("app.tasks.outbox")

BATCH_SIZE = 100
MAX_RETRIES = 5

_HANDLERS: dict[str, Callable[[OutboxEvent], None]] = {}


def register_handler(event_type: str):
    """Decorator: register a handler that runs when an event of this type is
    published. A handler that raises causes that one event to be retried
    (up to MAX_RETRIES) without affecting the rest of the batch."""

    def _decorator(fn: Callable[[OutboxEvent], None]):
        _HANDLERS[event_type] = fn
        return fn

    return _decorator


@register_handler(EventType.LEAD_CREATED)
def _log_lead_created(event: OutboxEvent) -> None:
    logger.info("outbox: lead %s created (trace_id=%s)", event.aggregate_id, event.trace_id)


@register_handler(EventType.PAYMENT_COMPLETED)
def _log_payment_completed(event: OutboxEvent) -> None:
    logger.info("outbox: payment %s completed (trace_id=%s)", event.aggregate_id, event.trace_id)


@celery_app.task(name="app.tasks.outbox.publish_pending_events")
def publish_pending_events() -> dict:
    with redis_lock("outbox-publisher", ttl_seconds=60, blocking_timeout=1) as acquired:
        if not acquired:
            logger.info("publish_pending_events: another run holds the lock, skipping this tick")
            return {"published": 0, "failed": 0, "locked_out": True}
        return _publish_batch()


def _publish_batch() -> dict:
    db = SessionLocal()
    published = 0
    failed = 0
    try:
        rows = (
            db.query(OutboxEvent)
            .filter(OutboxEvent.status == "pending")
            .order_by(OutboxEvent.created_at)
            .limit(BATCH_SIZE)
            .with_for_update(skip_locked=True)
            .all()
        )
        for event in rows:
            handler = _HANDLERS.get(event.event_type)
            try:
                if handler:
                    handler(event)
                event.status = "published"
                event.published_at = datetime.now(timezone.utc)
                published += 1
            except Exception as exc:  # noqa: BLE001 — isolate one bad event from the rest of the batch
                event.retry_count += 1
                if event.retry_count >= MAX_RETRIES:
                    event.status = "failed"
                    logger.error("outbox: event %s permanently failed after %s retries: %s", event.id, event.retry_count, exc)
                else:
                    logger.warning("outbox: event %s failed (retry %s/%s): %s", event.id, event.retry_count, MAX_RETRIES, exc)
                failed += 1
            db.commit()
        return {"published": published, "failed": failed}
    finally:
        db.close()
