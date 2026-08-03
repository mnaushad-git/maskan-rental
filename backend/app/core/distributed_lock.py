"""Redis-backed distributed lock for work that must not run concurrently for
the same logical entity (payment webhook processing, subscription renewal,
duplicate-import prevention, recommendation recalculation, ...).

Mirrors the shape of the existing Postgres-based `app.core.locks.pg_advisory_lock`
(yields a bool the caller checks) so call sites read the same way regardless
of which backing store is used.
"""
import logging
import secrets
import time
from contextlib import contextmanager

import redis

from app.core.redis_client import get_redis_client

logger = logging.getLogger("app.locks.redis")


def _release_if_owner(client: redis.Redis, key: str, token: str) -> None:
    """Compare-and-delete via WATCH/MULTI/EXEC — a holder can never release a
    lock it no longer owns (e.g. its TTL already expired and someone else
    acquired it). Deliberately avoids EVAL/Lua scripting so this works
    against both real Redis and lightweight test doubles (fakeredis without
    the optional `lupa` scripting backend) identically."""

    def _txn(pipe):
        current = pipe.get(key)
        pipe.multi()
        if current == token:
            pipe.delete(key)

    client.transaction(_txn, key)


@contextmanager
def redis_lock(
    name: str,
    *,
    ttl_seconds: int = 30,
    blocking_timeout: float = 5.0,
    poll_interval: float = 0.1,
    job_id: str | None = None,
):
    """Yields True if the lock was acquired (caller should proceed) or False
    if it wasn't — either because another holder currently has it, or
    because Redis is unavailable. Unavailable Redis is treated as "not
    acquired" (fail safe: skip the operation rather than risk two workers
    running it at once), never as "acquired".

    The lock has a bounded TTL so a crashed holder can't deadlock it forever,
    and release uses a compare-and-delete Lua script keyed on a random token
    so a holder can never release a lock it no longer owns (e.g. after its
    own TTL already expired and someone else acquired it).
    """
    client = get_redis_client()
    key = f"maskan:lock:{name}"
    token = secrets.token_hex(16)
    acquired = False

    if client is not None:
        deadline = time.monotonic() + blocking_timeout
        try:
            while True:
                acquired = bool(client.set(key, token, nx=True, ex=ttl_seconds))
                if acquired or time.monotonic() >= deadline:
                    break
                time.sleep(poll_interval)
        except redis.RedisError as exc:
            logger.warning("redis_lock(%s, job_id=%s): error acquiring lock: %s", name, job_id, exc)
            acquired = False

    if not acquired:
        logger.info("redis_lock(%s, job_id=%s): not acquired (contended or Redis unavailable)", name, job_id)

    try:
        yield acquired
    finally:
        if acquired and client is not None:
            try:
                _release_if_owner(client, key, token)
            except redis.RedisError as exc:
                logger.warning("redis_lock(%s, job_id=%s): error releasing lock: %s", name, job_id, exc)
