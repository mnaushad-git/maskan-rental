import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.metrics import http_request_duration_seconds, http_requests_total
from app.core.request_context import REQUEST_ID_HEADER, set_request_id


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Accepts an inbound X-Request-ID (from a caller or an upstream proxy),
    or generates one, and echoes it back on the response so client, server,
    and future log/job/AI-call correlation all share the same ID.
    """

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
        set_request_id(request_id)
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request_id
        return response


class MetricsMiddleware(BaseHTTPMiddleware):
    """Records request count + latency labeled by (method, route template,
    status) — the route *template* (e.g. `/api/properties/{property_id}`),
    not the raw path, so a metric label doesn't fan out into one series per
    property ID."""

    async def dispatch(self, request: Request, call_next):
        started = time.monotonic()
        response = await call_next(request)
        duration = time.monotonic() - started

        route = request.scope.get("route")
        route_template = route.path if route is not None else request.url.path

        http_requests_total.labels(method=request.method, route=route_template, status=response.status_code).inc()
        http_request_duration_seconds.labels(method=request.method, route=route_template).observe(duration)
        return response
