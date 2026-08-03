"""Structured JSON logging. Every log line is one JSON object with a stable
set of fields (timestamp, level, logger, message, request_id) — easy to ship
to any log aggregator without a parsing layer, and every line is
automatically correlated to the request that produced it via the
X-Request-ID contextvar (see app/core/request_context.py).
"""
import json
import logging
import sys

from app.core.request_context import get_request_id


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": get_request_id(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

    # Quiet the noisiest third-party loggers down to warnings-and-above so
    # structured app logs aren't drowned out by per-request access lines.
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
