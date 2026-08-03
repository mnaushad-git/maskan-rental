"""Exception handlers that layer a consistent envelope on top of FastAPI's
default error responses, WITHOUT changing the shape of the `detail` field —
existing frontend/mobile clients parse `detail` as either a string or a
Pydantic validation-error array (see `frontend/src/lib/api/maskan.ts`), so
that field must stay exactly as FastAPI would have produced it. `code` and
`trace_id` are purely additive.
"""
import logging

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.request_context import get_request_id

logger = logging.getLogger("app.errors")

_STATUS_CODE_SLUGS = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthorized",
    status.HTTP_403_FORBIDDEN: "forbidden",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "validation_error",
    status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
}


def _slug_for(status_code: int) -> str:
    return _STATUS_CODE_SLUGS.get(status_code, "http_error" if status_code < 500 else "internal_error")


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "code": _slug_for(exc.status_code),
                "trace_id": get_request_id(),
            },
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": jsonable_encoder(exc.errors()),
                "code": "validation_error",
                "trace_id": get_request_id(),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        trace_id = get_request_id()
        logger.exception("Unhandled exception (trace_id=%s)", trace_id)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": "Internal server error",
                "code": "internal_error",
                "trace_id": trace_id,
            },
        )
