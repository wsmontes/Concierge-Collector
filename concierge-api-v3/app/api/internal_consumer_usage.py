"""Service-key-only usage sync endpoint for the Payload consumer job.

This endpoint is the boundary Payload → FastAPI for the last-use sync: it
is protected by the rotating ``X-CMS-Service-Key`` (constant-time comparison,
never a consumer credential) and pages ONLY the operational
``consumer_credential_usage`` collection by ``(updatedAt, _id)``. The cursor
is the same opaque HMAC machinery as distribution/catalog cursors, signed
with the dedicated internal-scan secret (``CATALOG_CURSOR_SECRET`` — it must
stay distinct from consumer-facing ``DISTRIBUTION_CURSOR_SECRET``).
"""

from __future__ import annotations

from datetime import datetime, timedelta
import re
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from pymongo.database import Database

from app.core.config import settings
from app.core.database import get_database
from app.core.security import verify_cms_service
from app.services.distribution_cursor import CursorError, decode_cursor, encode_cursor

router = APIRouter(prefix="/internal/consumer-usage", tags=["cms-distribution"])

_CURSOR_PURPOSE = "consumer-usage"
_CURSOR_TTL = timedelta(minutes=15)


class ConsumerUsageRecord(BaseModel):
    credentialId: str
    lastUsedAt: str  # ISO-8601 fixa com offset (ex.: 2026-08-18T12:00:05+00:00)


class ConsumerUsagePage(BaseModel):
    items: list[ConsumerUsageRecord]
    next_cursor: str | None = None


def _iso(value: object) -> str:
    """Deterministic ISO-8601 com offset — pydantic JSON mode usaria sufixo 'Z',
    divergindo do contrato do sync job (item com '+00:00')."""
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _usage_cursor_secret() -> str:
    # The catalog key is the dedicated HMAC secret for internal scan cursors;
    # consumer-facing pagination uses DISTRIBUTION_CURSOR_SECRET.
    value = settings.catalog_cursor_secret_value
    if value:
        return value
    if settings.environment == "development":
        return "development-catalog-cursor-secret"
    raise RuntimeError("CATALOG_CURSOR_SECRET not configured")


def _coerce_id(value: str) -> Any:
    """_id is an ObjectId on real Mongo and a plain string in hermetic tests."""
    if re.fullmatch(r"[0-9a-f]{24}", value):
        return ObjectId(value)
    return value


def _after_query(decoded: dict[str, Any]) -> dict:
    last_updated_raw = decoded.get("lastUpdatedAt")
    last_id = decoded.get("lastId")
    if not isinstance(last_updated_raw, str) or not isinstance(last_id, str):
        raise CursorError("invalid usage cursor")
    try:
        last_updated = datetime.fromisoformat(last_updated_raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CursorError("invalid usage cursor") from exc
    return {
        "$or": [
            {"updatedAt": {"$gt": last_updated}},
            {"updatedAt": last_updated, "_id": {"$gt": _coerce_id(last_id)}},
        ]
    }


def _next_cursor(rows: list[dict]) -> str:
    last = rows[-1]
    updated = last.get("updatedAt")
    return encode_cursor(
        {
            "purpose": _CURSOR_PURPOSE,
            "lastUpdatedAt": updated.isoformat() if hasattr(updated, "isoformat") else str(updated),
            "lastId": str(last.get("_id")),
        },
        _usage_cursor_secret(),
        ttl=_CURSOR_TTL,
    )


@router.get("", include_in_schema=False)
def list_consumer_usage(
    after: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=500),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> ConsumerUsagePage:
    """Page aggregated consumer usage ordered by (updatedAt, _id).

    Only ``credentialId``/``lastUsedAt`` are exposed — never a hash, secret
    or CMS state. Retrying a page is safe (the job applies ``$max``).
    """
    query: dict = {}
    if after:
        try:
            decoded = decode_cursor(after, _usage_cursor_secret(), expected={"purpose": _CURSOR_PURPOSE})
            query = _after_query(decoded)
        except CursorError as exc:
            raise HTTPException(status_code=409, detail="Invalid usage cursor") from exc
    rows = list(
        db["consumer_credential_usage"]
        .find(query, {"_id": 1, "credentialId": 1, "lastUsedAt": 1, "updatedAt": 1})
        .sort([("updatedAt", 1), ("_id", 1)])
        .limit(limit + 1)
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    items = [
        ConsumerUsageRecord(credentialId=str(row["credentialId"]), lastUsedAt=_iso(row["lastUsedAt"])) for row in rows
    ]
    return ConsumerUsagePage(items=items, next_cursor=_next_cursor(rows) if has_more and rows else None)
