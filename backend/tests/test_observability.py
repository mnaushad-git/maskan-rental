"""Observability tests: /metrics is scrapeable and reflects real traffic,
structured JSON logging emits valid JSON with request-id correlation, and
DB query metrics are recorded."""
import json
import logging

from app.core.db_metrics import SLOW_QUERY_THRESHOLD_SECONDS
from app.core.logging_config import JsonFormatter
from app.core.metrics import db_query_duration_seconds, http_requests_total
from app.core.request_context import set_request_id


def test_metrics_endpoint_is_scrapeable(client):
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert b"maskan_http_requests_total" in resp.content


def test_metrics_reflect_real_request_traffic(client):
    before = http_requests_total.labels(method="GET", route="/api/health", status=200)._value.get()

    client.get("/api/health")
    client.get("/api/health")

    after = http_requests_total.labels(method="GET", route="/api/health", status=200)._value.get()
    assert after >= before + 2


def test_metrics_endpoint_not_in_openapi_schema(client):
    schema = client.get("/openapi.json").json()
    assert "/metrics" not in schema["paths"]


def _histogram_observation_count(histogram) -> float:
    for metric in histogram.collect():
        for sample in metric.samples:
            if sample.name.endswith("_count"):
                return sample.value
    return 0.0


def test_db_query_metrics_recorded_on_real_query(client):
    # Use the observation count via the public collect() API, not the summed
    # duration — a trivial local query can legitimately round to 0.0s on
    # Windows' coarser monotonic clock resolution, so the sum isn't a
    # reliable "did this fire" signal.
    before = _histogram_observation_count(db_query_duration_seconds)
    client.get("/api/properties/", params={"limit": 1})
    after = _histogram_observation_count(db_query_duration_seconds)
    assert after > before


def test_json_formatter_produces_valid_json_with_request_id():
    set_request_id("test-trace-abc")
    record = logging.LogRecord(
        name="app.test", level=logging.INFO, pathname=__file__, lineno=1,
        msg="hello %s", args=("world",), exc_info=None,
    )
    formatted = JsonFormatter().format(record)
    parsed = json.loads(formatted)

    assert parsed["message"] == "hello world"
    assert parsed["level"] == "INFO"
    assert parsed["logger"] == "app.test"
    assert parsed["request_id"] == "test-trace-abc"


def test_json_formatter_includes_exception_info():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys
        record = logging.LogRecord(
            name="app.test", level=logging.ERROR, pathname=__file__, lineno=1,
            msg="failed", args=(), exc_info=sys.exc_info(),
        )
    formatted = JsonFormatter().format(record)
    parsed = json.loads(formatted)
    assert "ValueError: boom" in parsed["exception"]


def test_slow_query_threshold_is_reasonable():
    assert 0 < SLOW_QUERY_THRESHOLD_SECONDS < 5
