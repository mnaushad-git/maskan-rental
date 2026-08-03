"""Redis-assisted idempotency for selected write APIs (lead creation, payment
initiation, webhook processing, property publishing, data import submission,
review creation). Callers pass an `Idempotency-Key` header; the store
remembers the request fingerprint, processing status, and final response for
a configurable period so a retried request (client timeout + retry, double
form submit, webhook redelivery) replays the original result instead of
re-executing the write.

When Redis is unavailable, `begin()` always reports "not previously seen" —
idempotency protection is best-effort. The write itself must never fail just
because Redis is down.
"""
import hashlib
import json
import logging
from dataclasses import dataclass
from typing import Any

import redis

from app.core.redis_client import get_redis_client

logger = logging.getLogger("app.idempotency")


class IdempotencyConflict(Exception):
    """Same Idempotency-Key reused with a different request body — a client
    bug (or key collision). Never silently replay the wrong response."""


@dataclass
class IdempotencyRecord:
    status_code: int
    body: Any


def _fingerprint(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


class IdempotencyStore:
    def __init__(self, client: "redis.Redis | None" = None, ttl_seconds: int = 24 * 60 * 60):
        self._client = client
        self._ttl = ttl_seconds

    def _resolve_client(self):
        return self._client if self._client is not None else get_redis_client()

    def begin(self, scope: str, idempotency_key: str, request_payload: dict) -> IdempotencyRecord | None:
        """Call before processing a write. Returns the previously-completed
        response if this key was already handled (caller should replay it
        verbatim, not re-execute), or None if this is a new request."""
        client = self._resolve_client()
        if client is None:
            return None

        key = f"maskan:idempotency:{scope}:{idempotency_key}"
        fingerprint = _fingerprint(request_payload)
        try:
            raw = client.get(key)
        except redis.RedisError as exc:
            logger.warning("idempotency.begin(%s/%s): Redis error, proceeding without protection: %s", scope, idempotency_key, exc)
            return None

        if raw is None:
            return None

        record = json.loads(raw)
        if record.get("fingerprint") != fingerprint:
            raise IdempotencyConflict(
                f"Idempotency-Key '{idempotency_key}' was already used with a different request body"
            )
        if record.get("status") != "completed":
            return None  # a previous attempt started but never completed — allow this one to run
        return IdempotencyRecord(status_code=record["status_code"], body=record["body"])

    def complete(self, scope: str, idempotency_key: str, request_payload: dict, status_code: int, body: Any) -> None:
        client = self._resolve_client()
        if client is None:
            return
        key = f"maskan:idempotency:{scope}:{idempotency_key}"
        record = {
            "fingerprint": _fingerprint(request_payload),
            "status": "completed",
            "status_code": status_code,
            "body": body,
        }
        try:
            client.set(key, json.dumps(record, default=str), ex=self._ttl)
        except redis.RedisError as exc:
            logger.warning("idempotency.complete(%s/%s): Redis error storing result: %s", scope, idempotency_key, exc)
