import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

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
