"""Response-boundary sanitization for provider-backed partial-success APIs.

Some orchestration endpoints intentionally return HTTP 200 with per-item errors.
Those errors bypass the global 5xx exception sanitizer, so provider response
bodies and internal exception strings must be normalized before leaving the API.
"""

from __future__ import annotations

import json
from typing import Any

from starlette.requests import Request
from starlette.responses import Response

PLACES_ORCHESTRATE_PATH = "/api/v3/places/orchestrate"
_SAFE_PROVIDER_MESSAGE = "Google Places request failed"
_SAFE_OPERATION_MESSAGE = "Places operation failed"


def _sanitize_partial_error(error: Any) -> dict[str, Any]:
    if not isinstance(error, dict):
        return {"code": "dependency_error", "message": _SAFE_OPERATION_MESSAGE}

    if "status_code" in error:
        sanitized: dict[str, Any] = {
            "code": "provider_error",
            "message": _SAFE_PROVIDER_MESSAGE,
        }
        if error.get("place_id") is not None:
            sanitized["place_id"] = error["place_id"]
        try:
            sanitized["status_code"] = int(error["status_code"])
        except (TypeError, ValueError):
            sanitized["status_code"] = 502
        return sanitized

    operation = error.get("operation")
    if isinstance(operation, dict):
        operation = operation.get("operation") or "unknown"
    if not isinstance(operation, str) or not operation:
        operation = "unknown"
    return {
        "operation": operation,
        "code": "dependency_error",
        "message": _SAFE_OPERATION_MESSAGE,
    }


def sanitize_places_payload(status_code: int, payload: Any) -> tuple[int, Any]:
    """Return a safe status/payload pair for the Places orchestrator."""
    if not isinstance(payload, dict):
        return status_code, payload

    detail = payload.get("detail")
    if status_code < 500 and isinstance(detail, str) and detail.startswith("Places API error:"):
        return 502, {"detail": _SAFE_PROVIDER_MESSAGE}

    if status_code == 200 and isinstance(payload.get("errors"), list):
        sanitized = dict(payload)
        sanitized["errors"] = [_sanitize_partial_error(error) for error in payload["errors"]]
        return status_code, sanitized

    return status_code, payload


async def places_provider_response_middleware(request: Request, call_next):
    """Sanitize only the JSON response of the Places orchestration boundary."""
    response = await call_next(request)
    if request.url.path != PLACES_ORCHESTRATE_PATH:
        return response

    content_type = response.headers.get("content-type", "")
    if "application/json" not in content_type.lower():
        return response

    chunks = [chunk async for chunk in response.body_iterator]
    body = b"".join(chunk if isinstance(chunk, bytes) else chunk.encode("utf-8") for chunk in chunks)
    try:
        payload = json.loads(body)
    except (TypeError, ValueError, UnicodeDecodeError):
        return Response(
            content=body,
            status_code=response.status_code,
            headers=dict(response.headers),
            media_type="application/json",
        )

    status_code, payload = sanitize_places_payload(response.status_code, payload)
    headers = dict(response.headers)
    headers.pop("content-length", None)
    return Response(
        content=json.dumps(payload, separators=(",", ":"), ensure_ascii=False),
        status_code=status_code,
        headers=headers,
        media_type="application/json",
    )
