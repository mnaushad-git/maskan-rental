from contextlib import contextmanager

from sqlalchemy import text
from sqlalchemy.orm import Session


@contextmanager
def pg_advisory_lock(session: Session, key: int):
    """
    Session-scoped Postgres advisory lock, used to make sure only one
    uvicorn/gunicorn worker actually runs a given APScheduler job when a
    cron trigger fires — the scheduler itself starts once per worker
    process, so without this every job would run N times per trigger.

    Yields True if the lock was acquired (caller should proceed) or False
    if another worker already holds it (caller should skip this run).
    """
    acquired = bool(session.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": key}).scalar())
    try:
        yield acquired
    finally:
        if acquired:
            session.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
