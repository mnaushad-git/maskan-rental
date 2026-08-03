"""Lazy Redis client singleton.

Every consumer (cache, rate limiter, lock, idempotency store) goes through
`get_redis_client()` rather than constructing its own connection, so there is
exactly one pool per process and one place that knows how Redis is
configured. Returns `None` when `REDIS_URL` isn't set — callers must treat
that (and any `redis.RedisError` raised on actual use) as "Redis is
unavailable" and fall back gracefully; nothing in this app may treat Redis
as required for correctness.
"""
import logging

import redis

from app.core.config import settings

logger = logging.getLogger("app.redis")

_client: redis.Redis | None = None
_client_built = False


def get_redis_client() -> redis.Redis | None:
    global _client, _client_built
    if not settings.REDIS_URL:
        return None
    if not _client_built:
        _client = redis.Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=0.3,
            socket_timeout=0.3,
            health_check_interval=30,
        )
        _client_built = True
    return _client


def is_redis_available() -> bool:
    client = get_redis_client()
    if client is None:
        return False
    try:
        return bool(client.ping())
    except redis.RedisError as exc:
        logger.warning("Redis unavailable: %s", exc)
        return False
