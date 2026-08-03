"""Per-request context (currently just the request/trace ID).

Populated by `RequestIDMiddleware` and read anywhere in the call stack
(route handlers, background jobs, AI call logging) via `get_request_id()`,
without having to thread the value through every function signature.
"""
from contextvars import ContextVar

_request_id_ctx_var: ContextVar[str | None] = ContextVar("request_id", default=None)

REQUEST_ID_HEADER = "X-Request-ID"


def get_request_id() -> str | None:
    return _request_id_ctx_var.get()


def set_request_id(request_id: str) -> None:
    _request_id_ctx_var.set(request_id)
