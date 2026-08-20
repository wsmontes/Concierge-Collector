"""Opaque HMAC cursors for version-bound Collection distribution pages."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from typing import Any


class CursorError(ValueError):
    """A cursor is malformed, expired, tampered or outside its request context."""


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise CursorError("invalid cursor") from exc


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8")


def encode_cursor(
    payload: dict[str, Any], secret: str, *, now: datetime | None = None, ttl: timedelta = timedelta(minutes=15)
) -> str:
    if not secret:
        raise ValueError("cursor secret is required")
    now = now or datetime.now(timezone.utc)
    document = {**payload, "exp": int((now + ttl).timestamp())}
    body = _canonical(document)
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    return f"{_b64(body)}.{_b64(signature)}"


def decode_cursor(
    cursor: str, secret: str, *, now: datetime | None = None, expected: dict[str, Any] | None = None
) -> dict[str, Any]:
    if not secret:
        raise CursorError("invalid cursor")
    try:
        body_part, signature_part = cursor.split(".")
    except ValueError as exc:
        raise CursorError("invalid cursor") from exc
    body = _unb64(body_part)
    supplied = _unb64(signature_part)
    expected_signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    if not hmac.compare_digest(supplied, expected_signature):
        raise CursorError("invalid cursor")
    try:
        payload = json.loads(body)
    except (TypeError, ValueError) as exc:
        raise CursorError("invalid cursor") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("exp"), int):
        raise CursorError("invalid cursor")
    now = now or datetime.now(timezone.utc)
    if payload["exp"] < int(now.timestamp()):
        raise CursorError("invalid cursor")
    for key, value in (expected or {}).items():
        if payload.get(key) != value:
            raise CursorError("invalid cursor")
    return payload
