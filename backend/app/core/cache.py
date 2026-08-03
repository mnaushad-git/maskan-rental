"""Redis-backed cache service: namespaced keys, JSON values, configurable
TTL, safe invalidation, and graceful fallback to "cache miss" whenever Redis
is unavailable — callers always fall through to Postgres in that case, so a
Redis outage degrades performance, never correctness.

Candidates for use: property detail responses, search filter master data,
city/district lists, area-intelligence summaries, rental benchmarks,
mediator public profiles/ratings, landing-page aggregates. Do not cache
anything without a clear invalidation policy (see module docstrings at each
call site for that policy).
"""
import json
import logging
from collections.abc import Callable
from typing import Any

import redis

from app.core.config import settings
from app.core.distributed_lock import redis_lock
from app.core.redis_client import get_redis_client

logger = logging.getLogger("app.cache")

_MISSING = object()


class CacheStats:
    """Process-local counters. Exported via the metrics endpoint (Phase 15)."""

    def __init__(self) -> None:
        self.hits = 0
        self.misses = 0
        self.errors = 0
        self.sets = 0

    def as_dict(self) -> dict[str, int]:
        return {"hits": self.hits, "misses": self.misses, "errors": self.errors, "sets": self.sets}


stats = CacheStats()


class CacheService:
    def __init__(self, client: "redis.Redis | None" = None, version: str | None = None):
        self._client = client
        self._version = version or settings.CACHE_VERSION

    def _resolve_client(self):
        return self._client if self._client is not None else get_redis_client()

    def _key(self, namespace: str, key: str) -> str:
        return f"maskan:cache:{self._version}:{namespace}:{key}"

    def get(self, namespace: str, key: str, default: Any = None) -> Any:
        client = self._resolve_client()
        if client is None:
            return default
        try:
            raw = client.get(self._key(namespace, key))
        except redis.RedisError as exc:
            logger.warning("cache.get(%s/%s): Redis error, treating as miss: %s", namespace, key, exc)
            stats.errors += 1
            return default
        if raw is None:
            stats.misses += 1
            return default
        stats.hits += 1
        return json.loads(raw)

    def set(self, namespace: str, key: str, value: Any, ttl_seconds: int) -> bool:
        client = self._resolve_client()
        if client is None:
            return False
        try:
            client.set(self._key(namespace, key), json.dumps(value, default=str), ex=ttl_seconds)
            stats.sets += 1
            return True
        except redis.RedisError as exc:
            logger.warning("cache.set(%s/%s): Redis error, skipping cache write: %s", namespace, key, exc)
            stats.errors += 1
            return False

    def delete(self, namespace: str, key: str) -> None:
        client = self._resolve_client()
        if client is None:
            return
        try:
            client.delete(self._key(namespace, key))
        except redis.RedisError as exc:
            logger.warning("cache.delete(%s/%s): Redis error: %s", namespace, key, exc)
            stats.errors += 1

    def delete_namespace(self, namespace: str) -> int:
        """Bulk-invalidate every key under a namespace (e.g. after a mediator
        profile update). Uses SCAN, not KEYS, so it never blocks Redis on a
        large keyspace."""
        client = self._resolve_client()
        if client is None:
            return 0
        pattern = self._key(namespace, "*")
        deleted = 0
        try:
            for k in client.scan_iter(match=pattern, count=200):
                client.delete(k)
                deleted += 1
        except redis.RedisError as exc:
            logger.warning("cache.delete_namespace(%s): Redis error: %s", namespace, exc)
            stats.errors += 1
        return deleted

    def get_or_set(
        self,
        namespace: str,
        key: str,
        ttl_seconds: int,
        loader: Callable[[], Any],
        *,
        stampede_lock_seconds: int = 5,
    ) -> Any:
        """Read-through cache. On a miss, briefly holds a per-key lock while
        computing so a burst of concurrent requests for the same cold key
        doesn't all hit Postgres at once (cache stampede) — any request that
        loses the lock race just computes its own value rather than blocking
        indefinitely, so this degrades to "no stampede protection" rather
        than deadlocking if contention is unexpectedly high."""
        cached = self.get(namespace, key, default=_MISSING)
        if cached is not _MISSING:
            return cached

        with redis_lock(f"cache-compute:{namespace}:{key}", ttl_seconds=stampede_lock_seconds, blocking_timeout=stampede_lock_seconds):
            # Re-check: whoever held the lock may have just populated it.
            cached = self.get(namespace, key, default=_MISSING)
            if cached is not _MISSING:
                return cached
            value = loader()
            self.set(namespace, key, value, ttl_seconds)
            return value
