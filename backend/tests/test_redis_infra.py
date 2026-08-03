"""Redis infrastructure tests. Uses `fakeredis` (in-memory, Redis-protocol
compatible) since no real Redis server is available in this dev environment
— the app must work identically against either. Fallback behavior (Redis
unavailable / erroring) is tested by pointing at a client that always raises,
not just by unsetting REDIS_URL, so the actual except-and-degrade code paths
run.
"""
import fakeredis
import pytest
import redis as redis_lib

from app.core.cache import CacheService
from app.core.distributed_lock import redis_lock
from app.core.idempotency import IdempotencyConflict, IdempotencyStore
from app.core.rate_limit import check_rate_limit


@pytest.fixture()
def fake_client():
    return fakeredis.FakeStrictRedis(decode_responses=True)


class _BrokenClient:
    """Stands in for `redis.Redis` when the server is unreachable — every
    method raises, like a real connection failure would."""

    def __getattr__(self, name):
        def _raise(*args, **kwargs):
            raise redis_lib.ConnectionError("simulated Redis outage")
        return _raise


# ── Cache ──────────────────────────────────────────────────────────────────

def test_cache_set_then_get(fake_client):
    cache = CacheService(client=fake_client)
    cache.set("areas", "riyadh", {"score": 82}, ttl_seconds=60)
    assert cache.get("areas", "riyadh") == {"score": 82}


def test_cache_miss_returns_default(fake_client):
    cache = CacheService(client=fake_client)
    assert cache.get("areas", "nonexistent", default="fallback") == "fallback"


def test_cache_delete(fake_client):
    cache = CacheService(client=fake_client)
    cache.set("areas", "riyadh", {"score": 82}, ttl_seconds=60)
    cache.delete("areas", "riyadh")
    assert cache.get("areas", "riyadh") is None


def test_cache_delete_namespace_bulk_invalidate(fake_client):
    cache = CacheService(client=fake_client)
    cache.set("mediator", "1", {"name": "Yasmin"}, ttl_seconds=60)
    cache.set("mediator", "2", {"name": "Olaya"}, ttl_seconds=60)
    deleted = cache.delete_namespace("mediator")
    assert deleted == 2
    assert cache.get("mediator", "1") is None
    assert cache.get("mediator", "2") is None


def test_cache_get_or_set_computes_once_and_caches(fake_client):
    cache = CacheService(client=fake_client)
    calls = []

    def loader():
        calls.append(1)
        return {"computed": True}

    first = cache.get_or_set("area-summary", "riyadh", ttl_seconds=60, loader=loader)
    second = cache.get_or_set("area-summary", "riyadh", ttl_seconds=60, loader=loader)
    assert first == second == {"computed": True}
    assert len(calls) == 1  # second call was a cache hit, loader not invoked again


def test_cache_falls_back_to_default_when_redis_down():
    cache = CacheService(client=_BrokenClient())
    assert cache.get("areas", "riyadh", default="fallback") == "fallback"


def test_cache_set_is_a_safe_noop_when_redis_down():
    cache = CacheService(client=_BrokenClient())
    assert cache.set("areas", "riyadh", {"score": 1}, ttl_seconds=60) is False


def test_cache_get_or_set_still_computes_when_redis_down():
    cache = CacheService(client=_BrokenClient())
    value = cache.get_or_set("areas", "riyadh", ttl_seconds=60, loader=lambda: {"computed": True})
    assert value == {"computed": True}


# ── Rate limiting ────────────────────────────────────────────────────────

def test_rate_limit_allows_within_budget(fake_client, monkeypatch):
    monkeypatch.setattr("app.core.rate_limit.get_redis_client", lambda: fake_client)
    result = check_rate_limit("login", "1.2.3.4", limit=5, window_seconds=60)
    assert result.allowed is True
    assert result.remaining == 4


def test_rate_limit_blocks_over_budget(fake_client, monkeypatch):
    monkeypatch.setattr("app.core.rate_limit.get_redis_client", lambda: fake_client)
    for _ in range(3):
        check_rate_limit("login", "5.5.5.5", limit=3, window_seconds=60)
    result = check_rate_limit("login", "5.5.5.5", limit=3, window_seconds=60)
    assert result.allowed is False
    assert result.retry_after_seconds > 0


def test_rate_limit_fails_open_when_redis_down(monkeypatch):
    monkeypatch.setattr("app.core.rate_limit.get_redis_client", lambda: _BrokenClient())
    result = check_rate_limit("login", "1.2.3.4", limit=1, window_seconds=60)
    assert result.allowed is True


# ── Distributed lock ─────────────────────────────────────────────────────

def test_redis_lock_acquires_when_free(fake_client, monkeypatch):
    monkeypatch.setattr("app.core.distributed_lock.get_redis_client", lambda: fake_client)
    with redis_lock("test-job", ttl_seconds=10) as acquired:
        assert acquired is True


def test_redis_lock_blocks_second_holder(fake_client, monkeypatch):
    monkeypatch.setattr("app.core.distributed_lock.get_redis_client", lambda: fake_client)
    with redis_lock("test-job", ttl_seconds=10, blocking_timeout=0.2) as first:
        assert first is True
        with redis_lock("test-job", ttl_seconds=10, blocking_timeout=0.2) as second:
            assert second is False


def test_redis_lock_released_after_context_exits(fake_client, monkeypatch):
    monkeypatch.setattr("app.core.distributed_lock.get_redis_client", lambda: fake_client)
    with redis_lock("test-job", ttl_seconds=10):
        pass
    with redis_lock("test-job", ttl_seconds=10, blocking_timeout=0.2) as acquired:
        assert acquired is True  # lock was released, so this one can acquire it


def test_redis_lock_not_acquired_when_redis_down(monkeypatch):
    monkeypatch.setattr("app.core.distributed_lock.get_redis_client", lambda: _BrokenClient())
    with redis_lock("test-job", ttl_seconds=10, blocking_timeout=0.1) as acquired:
        assert acquired is False  # fails safe, not open


# ── Idempotency ───────────────────────────────────────────────────────────

def test_idempotency_first_call_returns_none(fake_client):
    store = IdempotencyStore(client=fake_client)
    assert store.begin("lead-create", "key-1", {"email": "a@b.com"}) is None


def test_idempotency_replays_completed_response(fake_client):
    store = IdempotencyStore(client=fake_client)
    payload = {"email": "a@b.com"}
    store.begin("lead-create", "key-1", payload)
    store.complete("lead-create", "key-1", payload, status_code=201, body={"id": 42})

    replay = store.begin("lead-create", "key-1", payload)
    assert replay is not None
    assert replay.status_code == 201
    assert replay.body == {"id": 42}


def test_idempotency_conflict_on_different_payload_same_key(fake_client):
    store = IdempotencyStore(client=fake_client)
    store.begin("lead-create", "key-1", {"email": "a@b.com"})
    store.complete("lead-create", "key-1", {"email": "a@b.com"}, status_code=201, body={"id": 42})

    with pytest.raises(IdempotencyConflict):
        store.begin("lead-create", "key-1", {"email": "different@b.com"})


def test_idempotency_no_protection_when_redis_down():
    store = IdempotencyStore(client=_BrokenClient())
    assert store.begin("lead-create", "key-1", {"email": "a@b.com"}) is None
    store.complete("lead-create", "key-1", {"email": "a@b.com"}, status_code=201, body={})  # must not raise
