"""Redis-backed rate limiting: a fixed-window counter per (bucket, identifier).

`bucket` groups a family of actions sharing one limit (e.g. "login",
"ai_chat", "lead_create"); `identifier` scopes it to whoever is being limited
(IP address, user ID). Fails OPEN when Redis is unavailable — rate limiting
is defense-in-depth, not a correctness guarantee, and a Redis outage must
never be able to take down real traffic. `rate_limit_dependency()` wraps this
as a FastAPI dependency that raises a standardized 429 with a Retry-After
header.
"""
import logging
import time
from dataclasses import dataclass

import redis
from fastapi import HTTPException, Request, status
from jose import JWTError, jwt

from app.core.config import settings
from app.core.redis_client import get_redis_client

logger = logging.getLogger("app.ratelimit")


@dataclass
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    retry_after_seconds: int


def check_rate_limit(bucket: str, identifier: str, *, limit: int, window_seconds: int) -> RateLimitResult:
    client = get_redis_client()
    if client is None:
        return RateLimitResult(True, limit, limit, 0)

    window = int(time.time()) // window_seconds
    key = f"maskan:ratelimit:{bucket}:{identifier}:{window}"
    try:
        count = client.incr(key)
        if count == 1:
            client.expire(key, window_seconds)
            ttl = window_seconds
        else:
            ttl = client.ttl(key)
            if not ttl or ttl < 0:
                ttl = window_seconds
    except redis.RedisError as exc:
        logger.warning("check_rate_limit(%s/%s): Redis error, failing open: %s", bucket, identifier, exc)
        return RateLimitResult(True, limit, limit, 0)

    allowed = count <= limit
    remaining = max(0, limit - count)
    return RateLimitResult(allowed, limit, remaining, 0 if allowed else ttl)


def _client_identifier(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit_dependency(bucket: str, *, limit: int, window_seconds: int, by_user: bool = False):
    """FastAPI dependency factory. `by_user=True` scopes the limit per
    authenticated user (falls back to IP for anonymous requests) instead of
    per IP — use for endpoints where the caller is always authenticated
    (e.g. AI advisor chat) so one user can't exhaust another's quota."""

    def _dependency(request: Request):
        identifier = _client_identifier(request)
        if by_user:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header[7:]
                try:
                    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
                    if payload.get("sub"):
                        identifier = f"user:{payload['sub']}"
                except JWTError:
                    pass  # invalid/expired token — fall back to IP, auth itself will reject the request
        result = check_rate_limit(bucket, identifier, limit=limit, window_seconds=window_seconds)
        if not result.allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(result.retry_after_seconds)},
            )

    return _dependency
