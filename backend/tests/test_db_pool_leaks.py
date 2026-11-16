"""Connection-pool leak regression tests (P0, Nov 2026).

Production exhausted its SQLAlchemy QueuePool (5 + 5 overflow) because
`POST /api/ai/chat/stream` handed the request-scoped `get_db` session to the
AI tools. FastAPI closes that session *before* a StreamingResponse body runs;
tool calls made mid-stream silently re-opened it, checked out a fresh
connection, and nothing ever returned it.

These tests deliberately do NOT use the `client`/`db_session` fixtures from
conftest (those override `get_db` with a single shared connection, which
would hide exactly this class of bug). They exercise the real `get_db` and
the real engine pool, and assert on `engine.pool.checkedout()` — not on HTTP
status codes — so a genuine leak fails them.
"""
import json
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes import ai as ai_routes
from app.core import rate_limit
from app.core.ai import gateway
from app.core.config import settings
from app.core.metrics import db_pool_checked_out, db_pool_checkins_total, db_pool_checkouts_total
from app.db.session import engine
from app.main import app


def _checked_out() -> int:
    return engine.pool.checkedout()


def _wait_for(expected: int, timeout: float = 5.0) -> int:
    """Stream teardown runs in the threadpool just after the last byte is
    sent, so allow a short settle window before asserting."""
    deadline = time.monotonic() + timeout
    current = _checked_out()
    while current != expected and time.monotonic() < deadline:
        time.sleep(0.05)
        current = _checked_out()
    return current


@pytest.fixture()
def baseline():
    start = _wait_for(0)
    assert start == 0, f"pool not idle before test ({start} checked out) — another test leaked"
    return start


@pytest.fixture()
def real_client():
    # No get_db override: real request-scoped sessions against the real pool.
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture()
def fake_ai(monkeypatch):
    """Fake Anthropic tool runner that calls a real DB-backed tool mid-stream,
    exactly like the real runner does. No network calls."""
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-fake-for-test")
    monkeypatch.setattr(rate_limit, "check_rate_limit", lambda *a, **k: rate_limit.RateLimitResult(True, 1, 1, 0))
    monkeypatch.setattr(ai_routes, "check_rate_limit", lambda *a, **k: rate_limit.RateLimitResult(True, 1, 1, 0))
    monkeypatch.setattr(gateway, "log_ai_call", lambda **kwargs: None)
    behaviour = {"mode": "ok", "tool_calls": 0}

    class _Turn:
        def __init__(self, text):
            self.text_stream = iter([text])

    class _Runner:
        def __init__(self, tools):
            self.tools = {t.name: t for t in tools}

        def __iter__(self):
            self.tools["search_listings"].call({"city": "Riyadh"})
            behaviour["tool_calls"] += 1
            yield _Turn("Here are some listings. ")
            if behaviour["mode"] == "error":
                raise RuntimeError("simulated provider error mid-stream")
            if behaviour["mode"] == "slow":
                time.sleep(1.5)
            yield _Turn("Done.")

    class _Client:
        class beta:
            class messages:
                @staticmethod
                def tool_runner(*, tools, **kwargs):
                    return _Runner(tools)

    monkeypatch.setattr(gateway, "get_client", lambda: _Client())
    return behaviour


_CHAT_BODY = {"message": "find me a 2BR in Riyadh", "history": []}


# ── Successful requests ──────────────────────────────────────────────────────

def test_successful_requests_return_connections(real_client, baseline):
    checkouts_before = db_pool_checkouts_total._value.get()
    for _ in range(15):
        assert real_client.get("/api/properties/?limit=5").status_code == 200
    assert db_pool_checkouts_total._value.get() > checkouts_before, "requests never touched the pool"
    assert _wait_for(baseline) == baseline


# ── Database exceptions ──────────────────────────────────────────────────────

def test_database_exception_returns_connection(baseline):
    mini = FastAPI()

    @mini.get("/boom")
    def boom(db: Session = Depends(get_db)):
        db.execute(text("select 1"))  # connection checked out, transaction open
        db.execute(text("select * from table_that_does_not_exist_xyz"))

    client = TestClient(mini, raise_server_exceptions=False)
    for _ in range(12):  # > pool_size + max_overflow: would exhaust if leaked
        assert client.get("/boom").status_code == 500
    assert _wait_for(baseline) == baseline


# ── AI streaming (the production leak) ───────────────────────────────────────

def test_ai_stream_with_db_tool_call_returns_connection(real_client, fake_ai, baseline):
    for _ in range(12):  # > pool_size + max_overflow: old code leaked 1 per request
        resp = real_client.post("/api/ai/chat/stream", json=_CHAT_BODY)
        assert resp.status_code == 200
        assert '"type": "done"' in resp.text
    assert fake_ai["tool_calls"] == 12
    assert _wait_for(baseline) == baseline


def test_ai_stream_provider_error_returns_connection(real_client, fake_ai, baseline):
    fake_ai["mode"] = "error"
    for _ in range(12):
        resp = real_client.post("/api/ai/chat/stream", json=_CHAT_BODY)
        assert '"type": "error"' in resp.text
    assert _wait_for(baseline) == baseline


def test_ai_non_stream_provider_error_returns_connection(real_client, fake_ai, monkeypatch, baseline):
    def _fail(**kwargs):
        raise RuntimeError("simulated provider outage")

    monkeypatch.setattr(gateway, "run_chat", _fail)
    for _ in range(12):
        assert real_client.post("/api/ai/chat", json=_CHAT_BODY).status_code == 500
    assert _wait_for(baseline) == baseline


# ── Request cancellation (client disconnects mid-stream) ─────────────────────

def test_ai_stream_client_disconnect_returns_connection(fake_ai, baseline):
    import uvicorn

    fake_ai["mode"] = "slow"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started

        body = json.dumps(_CHAT_BODY).encode()
        for n in range(1, 5):
            sock = socket.create_connection(("127.0.0.1", port))
            sock.sendall(
                b"POST /api/ai/chat/stream HTTP/1.1\r\nHost: test\r\nContent-Type: application/json\r\n"
                + f"Content-Length: {len(body)}\r\n\r\n".encode()
                + body
            )
            # Disconnect only once this stream's DB tool call has really run
            # (no fixed sleep: a cold first request can take > 1s to get there).
            deadline = time.monotonic() + 15
            while fake_ai["tool_calls"] < n and time.monotonic() < deadline:
                time.sleep(0.02)
            assert fake_ai["tool_calls"] == n, "stream never reached its tool call"
            sock.close()  # client goes away mid-stream
        assert _wait_for(baseline, timeout=10) == baseline
    finally:
        server.should_exit = True
        thread.join(timeout=10)


# ── Background job failures ──────────────────────────────────────────────────

def test_background_job_failure_returns_connection(monkeypatch, baseline):
    from sqlalchemy.orm import Query

    from app.jobs.expire_assignments import expire_stale_assignments

    def _explode(self):
        raise RuntimeError("simulated DB failure inside job")

    monkeypatch.setattr(Query, "all", _explode)
    for _ in range(12):
        with pytest.raises(RuntimeError):
            expire_stale_assignments()
    assert _wait_for(baseline) == baseline


# ── Repeated concurrent requests ─────────────────────────────────────────────

def test_concurrent_requests_do_not_exhaust_pool(real_client, baseline):
    pid = real_client.get("/api/properties/?limit=1").json()[0]["id"]
    paths = ["/api/properties/?limit=5", f"/api/properties/{pid}", "/api/areas/", "/api/health/ready"] * 30

    with ThreadPoolExecutor(max_workers=12) as pool:
        codes = list(pool.map(lambda p: real_client.get(p).status_code, paths))
    assert codes.count(200) == len(paths), {c: codes.count(c) for c in set(codes)}
    assert _wait_for(baseline) == baseline


# ── Pool metrics ─────────────────────────────────────────────────────────────

def test_pool_metrics_exposed_and_track_the_pool(real_client, baseline):
    checkins_before = db_pool_checkins_total._value.get()
    real_client.get("/api/properties/?limit=1")
    assert db_pool_checkins_total._value.get() > checkins_before
    assert db_pool_checked_out.collect()[0].samples[0].value == _checked_out()

    scrape = real_client.get("/metrics").text
    for name in ("maskan_db_pool_checked_out", "maskan_db_pool_checked_in", "maskan_db_pool_overflow",
                 "maskan_db_pool_size", "maskan_db_pool_checkouts_total", "maskan_db_pool_checkins_total"):
        assert name in scrape
    assert "postgresql://" not in scrape and settings.DATABASE_URL not in scrape
