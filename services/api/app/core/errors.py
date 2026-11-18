"""RFC 7807 Problem Details for every error the API can produce.

Rules (docs/16-error-handling.md):
* Clients always receive ``application/problem+json`` with a stable ``type`` URI, a human
  ``title``, the HTTP ``status``, an optional ``detail`` and the request's ``traceId``.
* Internal details (stack traces, SQL, file paths) are logged server-side, never returned.
* Validation errors include a field → messages map so the UI can highlight inputs.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("sentinel.errors")
PROBLEM_BASE = "https://sentinel.example.org/problems/"
MEDIA_TYPE = "application/problem+json"


class DomainError(Exception):
    """Base class for expected, client-facing failures."""

    status = 400
    slug = "bad-request"
    title = "Bad request"

    def __init__(self, detail: str | None = None, *, headers: dict[str, str] | None = None):
        super().__init__(detail or self.title)
        self.detail = detail
        self.headers = headers


class NotFound(DomainError):
    status, slug, title = 404, "not-found", "Resource not found"


class Conflict(DomainError):
    status, slug, title = 409, "conflict", "Conflict with current state"


class Unauthorized(DomainError):
    status, slug, title = 401, "unauthorized", "Authentication required"


class Forbidden(DomainError):
    status, slug, title = 403, "forbidden", "Not permitted for your role"


class TooManyRequests(DomainError):
    status, slug, title = 429, "rate-limited", "Too many requests"


class UpstreamUnavailable(DomainError):
    status, slug, title = 503, "upstream-unavailable", "A dependent service is unavailable"


def _trace_id(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def problem(request: Request, status: int, slug: str, title: str, detail: str | None = None,
            errors: dict | None = None, headers: dict[str, str] | None = None) -> JSONResponse:
    body = {
        "type": PROBLEM_BASE + slug,
        "title": title,
        "status": status,
        "instance": request.url.path,
        "traceId": _trace_id(request),
    }
    if detail:
        body["detail"] = detail
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type=MEDIA_TYPE, headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain(request: Request, exc: DomainError):
        return problem(request, exc.status, exc.slug, exc.title, exc.detail, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        errors: dict[str, list[str]] = {}
        for e in exc.errors():
            loc = ".".join(str(p) for p in e.get("loc", []) if p not in ("body", "query", "path"))
            errors.setdefault(loc or "_", []).append(e.get("msg", "invalid"))
        return problem(request, 422, "validation", "Request validation failed", errors=errors)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        slug = {404: "not-found", 405: "method-not-allowed", 401: "unauthorized", 403: "forbidden"}.get(
            exc.status_code, "http-error")
        return problem(request, exc.status_code, slug, str(exc.detail), headers=getattr(exc, "headers", None))

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        # Full detail goes to the log with the trace id; the client gets a safe, generic message.
        log.exception("unhandled error", extra={"request_id": _trace_id(request), "path": request.url.path})
        return problem(request, 500, "internal", "Internal server error",
                       "An unexpected error occurred. Quote the traceId when contacting support.")
