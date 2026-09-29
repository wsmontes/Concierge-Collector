"""Correlation and low-cardinality operational metrics for the API."""

from __future__ import annotations

from contextvars import ContextVar
import logging
import re
import secrets
import time
import uuid

from fastapi import HTTPException, Request
from prometheus_client import Counter, Histogram

from app.core.config import settings

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
request_id_var: ContextVar[str] = ContextVar("request_id", default="")

# Never use URLs, user identifiers, curation ids or exception text as labels.
http_requests_total = Counter(
    "concierge_api_http_requests_total",
    "HTTP requests handled by the Concierge API",
    ("method", "route", "status"),
)
http_request_duration_seconds = Histogram(
    "concierge_api_http_request_duration_seconds",
    "HTTP request duration by stable route",
    ("method", "route", "status"),
)

_SENSITIVE = re.compile(
    r"(?i)(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+|"
    r"(x-(?:api|cms-service|metrics)-key\s*[:=]\s*)[^\s,;]+|"
    r"((?:token|secret|password)\s*[:=]\s*)[^\s,;]+"
)


def redact_text(value: object) -> str:
    """Return a string safe for operational logs without parsing request bodies."""

    return _SENSITIVE.sub(r"\1\2\3[REDACTED]", str(value))


class SecretRedactionFilter(logging.Filter):
    """Redact the message at handler time, including third-party loggers."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact_text(record.getMessage())
        record.args = ()
        return True


def install_log_redaction() -> None:
    root = logging.getLogger()
    if any(isinstance(item, SecretRedactionFilter) for item in root.filters):
        return
    root.addFilter(SecretRedactionFilter())


def request_id_from_request(request: Request) -> str:
    candidate = request.headers.get("x-request-id", "")
    return candidate if REQUEST_ID_RE.fullmatch(candidate) else str(uuid.uuid4())


def _metric_route(request: Request) -> str:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    return path if isinstance(path, str) else "unmatched"


async def request_context_middleware(request: Request, call_next):
    request_id = request_id_from_request(request)
    token = request_id_var.set(request_id)
    started = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-Id"] = request_id
        return response
    finally:
        elapsed = max(0.0, time.perf_counter() - started)
        labels = {"method": request.method, "route": _metric_route(request), "status": str(status)}
        http_requests_total.labels(**labels).inc()
        http_request_duration_seconds.labels(**labels).observe(elapsed)
        request_id_var.reset(token)


def metrics_authorized(request: Request) -> None:
    supplied = request.headers.get("x-metrics-key", "")
    if not supplied or not secrets.compare_digest(supplied, settings.metrics_key_value):
        raise HTTPException(status_code=401, detail="Metrics authorization required")
