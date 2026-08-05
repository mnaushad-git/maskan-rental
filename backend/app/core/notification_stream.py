"""Live notification refresh transport (Phase 6).

Redis pub/sub is a *transient signal only* — publishing here never blocks on
subscribers and never persists anything. The durable notification record
always lives in Postgres (see app.models.notification); a client that misses
a pub/sub message (disconnected, reconnecting, cold start) simply fetches
current state from the REST API, which is always correct regardless of
whether it saw the signal. This module's only job is "wake up any
connected client for this user so it re-fetches sooner than its next poll".
"""
import json
import logging
from collections.abc import Iterator

import redis

from app.core.redis_client import get_redis_client

logger = logging.getLogger("app.notifications.stream")

CHANNEL_PREFIX = "maskan:notifications:stream:"
HEARTBEAT_SECONDS = 20


def channel_for(user_id: int) -> str:
    return f"{CHANNEL_PREFIX}{user_id}"


def publish_invalidate(user_id: int, *, reason: str = "notification_created") -> None:
    """Best-effort. A publish failure (or no subscribers) never affects the
    notification write it's signaling about — that already committed to
    Postgres before this is called."""
    client = get_redis_client()
    if client is None:
        return
    try:
        client.publish(channel_for(user_id), json.dumps({"event": "invalidate", "reason": reason}))
    except redis.RedisError as exc:
        logger.warning("publish_invalidate(user=%s): Redis error: %s", user_id, exc)


def subscribe_events(user_id: int, *, heartbeat_seconds: int = HEARTBEAT_SECONDS) -> Iterator[str]:
    """Sync generator of SSE-formatted frames for this user's channel. Yields
    a heartbeat comment frame every `heartbeat_seconds` when no message
    arrives, so intermediary proxies (Caddy) and the browser's own
    connection-liveness detection don't treat an idle-but-healthy stream as
    dead. Yields nothing at all (caller falls back to polling) if Redis is
    unavailable — this must never raise into the HTTP response."""
    client = get_redis_client()
    if client is None:
        return
    pubsub = client.pubsub()
    try:
        pubsub.subscribe(channel_for(user_id))
        yield "event: connected\ndata: {}\n\n"
        while True:
            try:
                message = pubsub.get_message(timeout=heartbeat_seconds, ignore_subscribe_messages=True)
            except redis.RedisError as exc:
                logger.warning("subscribe_events(user=%s): Redis error, ending stream: %s", user_id, exc)
                return
            if message is None:
                yield ": heartbeat\n\n"
                continue
            data = message.get("data")
            yield f"event: invalidate\ndata: {data}\n\n"
    finally:
        try:
            pubsub.unsubscribe(channel_for(user_id))
            pubsub.close()
        except redis.RedisError:
            pass
