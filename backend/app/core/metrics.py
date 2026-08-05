"""Prometheus-compatible metrics. Business code calls these small helper
functions (record_cache_event, record_ai_call, ...) rather than importing
`prometheus_client` directly everywhere — that keeps the metrics backend
swappable and keeps route/task code from needing to know Prometheus's API.

Scope note: everything here is backend-observable. Client-side metrics the
platform plan also lists (mobile screen-load time, Web Core Vitals, AI
first-token time as perceived by the client, image-load failures) need a
telemetry SDK shipping events *from* the mobile/web apps to some ingestion
endpoint — that's a separate, much larger initiative and out of scope here.
"""
from prometheus_client import Counter, Gauge, Histogram

# ── HTTP ─────────────────────────────────────────────────────────────────
http_requests_total = Counter(
    "maskan_http_requests_total", "Total HTTP requests", ["method", "route", "status"]
)
http_request_duration_seconds = Histogram(
    "maskan_http_request_duration_seconds", "HTTP request latency", ["method", "route"]
)

# ── Database ─────────────────────────────────────────────────────────────
db_query_duration_seconds = Histogram(
    "maskan_db_query_duration_seconds", "Raw SQL statement latency"
)

# ── Cache ────────────────────────────────────────────────────────────────
cache_operations_total = Counter(
    "maskan_cache_operations_total", "Cache operations", ["result"]  # hit | miss | error | set | invalidate
)

# ── Search ───────────────────────────────────────────────────────────────
search_queries_total = Counter("maskan_search_queries_total", "Search queries executed", ["endpoint"])
search_duration_seconds = Histogram("maskan_search_duration_seconds", "Search query latency", ["endpoint"])
search_results_count = Histogram("maskan_search_results_count", "Result count per search query", ["endpoint"])

# ── AI ───────────────────────────────────────────────────────────────────
ai_calls_total = Counter("maskan_ai_calls_total", "AI model calls", ["feature", "status"])
ai_call_duration_seconds = Histogram("maskan_ai_call_duration_seconds", "AI model call latency", ["feature"])
ai_tokens_total = Counter("maskan_ai_tokens_total", "AI tokens consumed", ["feature", "direction"])  # direction: input | output
ai_cost_usd_total = Counter("maskan_ai_cost_usd_total", "Estimated AI cost in USD", ["feature"])

# ── Jobs ─────────────────────────────────────────────────────────────────
job_executions_total = Counter("maskan_job_executions_total", "Background job executions", ["task", "outcome"])  # outcome: success | failure | inline_fallback

# ── Business events ──────────────────────────────────────────────────────
leads_created_total = Counter("maskan_leads_created_total", "Leads created")
properties_published_total = Counter("maskan_properties_published_total", "Properties published")
payment_webhooks_total = Counter("maskan_payment_webhooks_total", "Payment webhook events processed", ["event_type"])

# ── Saved search alerts / notifications ─────────────────────────────────────
saved_searches_created_total = Counter("maskan_saved_searches_created_total", "Saved searches created")
alerts_generated_total = Counter("maskan_alerts_generated_total", "Saved-search matches generated", ["change_type"])
notifications_created_total = Counter("maskan_notifications_created_total", "Notifications created", ["type"])
notifications_opened_total = Counter("maskan_notifications_opened_total", "Notifications marked read/opened", ["type"])
notification_delivery_total = Counter("maskan_notification_delivery_total", "Notification delivery attempts", ["channel", "status"])
digest_delivered_total = Counter("maskan_digest_delivered_total", "Digests delivered", ["period"])
digest_failed_total = Counter("maskan_digest_failed_total", "Digest runs that failed", ["period"])

# ── Notification platform (Phase 16) ────────────────────────────────────────
push_attempted_total = Counter("maskan_push_attempted_total", "Push sends attempted", ["provider"])
push_accepted_total = Counter("maskan_push_accepted_total", "Push sends accepted by the provider", ["provider"])
push_failed_total = Counter("maskan_push_failed_total", "Push sends that failed", ["provider", "reason"])
push_invalid_token_total = Counter("maskan_push_invalid_token_total", "Push sends rejected for an invalid/unregistered token", ["provider"])
push_delivery_latency_seconds = Histogram("maskan_push_delivery_latency_seconds", "Push provider round-trip latency", ["provider"])
notification_stream_connections = Gauge("maskan_notification_stream_connections", "Currently-open SSE notification stream connections")
notification_stream_reconnects_total = Counter("maskan_notification_stream_reconnects_total", "SSE stream reconnect attempts observed server-side")
digest_generated_total = Counter("maskan_digest_generated_total", "Digest runs that produced at least one notification", ["period"])
lead_notifications_total = Counter("maskan_lead_notifications_total", "Generic lead notifications created", ["event_type"])
notification_job_retries_total = Counter("maskan_notification_job_retries_total", "Notification-related Celery task retries", ["task"])
notification_deep_link_failures_total = Counter("maskan_notification_deep_link_failures_total", "Client-reported deep-link resolution failures", ["platform"])
device_registration_total = Counter("maskan_device_registration_total", "Device registrations", ["platform"])
active_devices_total = Gauge("maskan_active_devices_total", "Currently-enabled devices", ["platform"])


def record_cache_event(result: str) -> None:
    cache_operations_total.labels(result=result).inc()


def record_ai_call(*, feature: str, status: str, latency_ms: float, input_tokens: int | None, output_tokens: int | None, cost_usd: float | None) -> None:
    ai_calls_total.labels(feature=feature, status=status).inc()
    ai_call_duration_seconds.labels(feature=feature).observe(latency_ms / 1000)
    if input_tokens is not None:
        ai_tokens_total.labels(feature=feature, direction="input").inc(input_tokens)
    if output_tokens is not None:
        ai_tokens_total.labels(feature=feature, direction="output").inc(output_tokens)
    if cost_usd is not None:
        ai_cost_usd_total.labels(feature=feature).inc(cost_usd)


def record_search(*, endpoint: str, duration_ms: float, result_count: int) -> None:
    search_queries_total.labels(endpoint=endpoint).inc()
    search_duration_seconds.labels(endpoint=endpoint).observe(duration_ms / 1000)
    search_results_count.labels(endpoint=endpoint).observe(result_count)


def record_job_execution(*, task: str, outcome: str) -> None:
    job_executions_total.labels(task=task, outcome=outcome).inc()
