"""Celery application. Redis-backed (broker + result backend), with work
split across dedicated queues so one slow/bursty workload (e.g. AI
generation) can't starve another (e.g. payment webhook follow-up).

Run a worker for a given queue with:
    celery -A app.core.celery_app worker -Q default,notifications -l info
Run the beat scheduler (if/when periodic tasks move here from APScheduler):
    celery -A app.core.celery_app beat -l info

Nothing in this app is allowed to treat a Celery/Redis outage as data loss —
see `app.core.jobs.enqueue()`, which is how every call site submits work; it
falls back to running the task inline if the broker is unreachable.
"""
from celery import Celery

from app.core.config import settings

QUEUE_DEFAULT = "default"
QUEUE_NOTIFICATIONS = "notifications"
QUEUE_DATA_INGESTION = "data_ingestion"
QUEUE_AI = "ai"
QUEUE_ANALYTICS = "analytics"
QUEUE_PAYMENTS = "payments"
QUEUE_SCHEDULED_JOBS = "scheduled_jobs"

ALL_QUEUES = [
    QUEUE_DEFAULT,
    QUEUE_NOTIFICATIONS,
    QUEUE_DATA_INGESTION,
    QUEUE_AI,
    QUEUE_ANALYTICS,
    QUEUE_PAYMENTS,
    QUEUE_SCHEDULED_JOBS,
]

celery_app = Celery(
    "maskan",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["app.tasks.leads", "app.tasks.area_intelligence"],
)

celery_app.conf.update(
    task_default_queue=QUEUE_DEFAULT,
    task_routes={
        "app.tasks.leads.*": {"queue": QUEUE_DEFAULT},
        "app.tasks.area_intelligence.*": {"queue": QUEUE_DATA_INGESTION},
    },
    # A task that's already running when its worker is killed goes back on
    # the queue instead of being silently lost.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Fail fast on a dead broker rather than hanging the calling request —
    # app.core.jobs.enqueue() already has its own fallback (run inline), so
    # Celery's own publish-retry layer would only add redundant delay on top
    # of that.
    broker_connection_timeout=1,
    broker_connection_retry_on_startup=False,
    task_publish_retry=False,
    result_expires=24 * 60 * 60,
    timezone="Asia/Riyadh",
)
