"""SQLAlchemy engine instrumentation: per-statement latency into the
Prometheus histogram, plus a slow-query warning log above a threshold.
Registered once against the shared engine (see app/db/session.py).
"""
import logging
import time

from sqlalchemy import Engine

from app.core.metrics import db_query_duration_seconds

logger = logging.getLogger("app.db.slow_query")

SLOW_QUERY_THRESHOLD_SECONDS = 0.5


def register_engine_metrics(engine: Engine) -> None:
    from sqlalchemy import event

    @event.listens_for(engine, "before_cursor_execute")
    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        context._query_start_time = time.monotonic()

    @event.listens_for(engine, "after_cursor_execute")
    def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        started = getattr(context, "_query_start_time", None)
        if started is None:
            return
        duration = time.monotonic() - started
        db_query_duration_seconds.observe(duration)
        if duration >= SLOW_QUERY_THRESHOLD_SECONDS:
            logger.warning("Slow query (%.0fms): %s", duration * 1000, statement.replace("\n", " ")[:300])
