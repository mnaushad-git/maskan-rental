"""Job submission helper. Every call site that wants to run work
asynchronously goes through `enqueue()` instead of calling `task.delay()`
directly, so there is one place that decides what happens when the broker is
unreachable: log loudly (this must be visible, not silently swallowed — see
Phase 17 "graceful degradation" requirements) and run the task inline,
synchronously, in the calling process instead. That preserves today's actual
behavior (this app currently has no Celery/Redis deployed anywhere, and
everything runs via in-process FastAPI BackgroundTasks) while making real
async dispatch the default the moment a broker is actually available.
"""
import logging

from celery import Task

from app.core.redis_client import is_redis_available
from app.core.request_context import get_request_id

logger = logging.getLogger("app.jobs")


def enqueue(task: Task, *args, **kwargs):
    """Submit `task` to its queue. Returns the AsyncResult on success, or the
    inline (eager) result if the broker is unreachable.

    Checks `is_redis_available()` first (a fast, bounded PING) rather than
    just trying `apply_async()` and catching the failure — Celery/kombu's own
    connection-retry machinery is tuned for a worker's long-lived connection,
    not for "fail fast inside an HTTP request", so letting a request-path
    call hit that machinery on every request while the broker is down would
    make the degraded mode itself slow."""
    request_id = get_request_id()
    if not is_redis_available():
        logger.warning("enqueue(%s): broker unavailable (trace_id=%s), running inline instead", task.name, request_id)
        return task.apply(args=args, kwargs=kwargs)

    try:
        return task.apply_async(args=args, kwargs=kwargs, headers={"trace_id": request_id})
    except Exception as exc:  # noqa: BLE001 — any broker/connection error, by design
        logger.error(
            "enqueue(%s): broker error (trace_id=%s), running inline instead: %s",
            task.name,
            request_id,
            exc,
        )
        return task.apply(args=args, kwargs=kwargs)
