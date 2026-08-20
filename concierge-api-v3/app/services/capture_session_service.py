"""Durable idempotency and processing lease for Capture.

A capture can invoke multiple paid providers (Whisper, chat completions and
Google Places). The actor-scoped capture id is therefore claimed in Mongo
*before* any provider call. The unique ``_id`` plus an expiring processing
lease makes one request the worker while concurrent duplicates fail fast and
can retry later. Completed sessions remain the durable idempotency result.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import secrets
from typing import Any

from fastapi import HTTPException, status
from pymongo import ReturnDocument
from pymongo.database import Database

CAPTURE_PROCESSING_LEASE_SECONDS = 300


@dataclass(frozen=True)
class CaptureSessionClaim:
    acquired: bool
    processing_token: str | None = None
    existing_session: dict[str, Any] | None = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _processing_conflict() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Capture is already being processed",
        headers={"Retry-After": "2"},
    )


def claim_capture_session(
    db: Database,
    *,
    capture_id: str,
    curator_id: str,
    idempotency_key: str,
    now: datetime | None = None,
) -> CaptureSessionClaim:
    """Claim one capture before paid work, or return its completed result."""
    claimed_at = now or _utc_now()
    processing_token = secrets.token_urlsafe(24)
    processing_expires_at = claimed_at + timedelta(seconds=CAPTURE_PROCESSING_LEASE_SECONDS)
    collection = db.capture_sessions

    result = collection.update_one(
        {"_id": capture_id},
        {
            "$setOnInsert": {
                "capture_id": capture_id,
                "curator_id": curator_id,
                "idempotency_key": idempotency_key,
                "status": "processing",
                "processing_token": processing_token,
                "processing_expires_at": processing_expires_at,
                "createdAt": claimed_at,
            }
        },
        upsert=True,
    )
    if result.upserted_id is not None:
        return CaptureSessionClaim(acquired=True, processing_token=processing_token)

    existing = collection.find_one({"_id": capture_id, "curator_id": curator_id})
    if existing is None:
        # A server-derived capture id includes curator_id, so an _id collision
        # with another owner indicates corrupt state rather than a valid retry.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Capture identity conflict",
        )

    if existing.get("status") in {"pending_confirmation", "confirmed"}:
        return CaptureSessionClaim(acquired=False, existing_session=existing)

    if existing.get("status") != "processing":
        raise _processing_conflict()

    expires_at = existing.get("processing_expires_at")
    if isinstance(expires_at, datetime) and expires_at > claimed_at:
        raise _processing_conflict()

    # Worker crashed or exceeded the lease. CAS on the expired timestamp so
    # only one retry can take ownership of the abandoned pipeline.
    takeover = collection.find_one_and_update(
        {
            "_id": capture_id,
            "curator_id": curator_id,
            "status": "processing",
            "processing_expires_at": {"$lte": claimed_at},
        },
        {
            "$set": {
                "processing_token": processing_token,
                "processing_expires_at": processing_expires_at,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if takeover is None:
        raise _processing_conflict()
    return CaptureSessionClaim(acquired=True, processing_token=processing_token)


def complete_capture_session(
    db: Database,
    *,
    capture_id: str,
    curator_id: str,
    processing_token: str,
    result_fields: dict[str, Any],
) -> dict[str, Any]:
    """Persist the paid result only if this request still owns the lease."""
    update_fields = dict(result_fields)
    update_fields.update(
        {
            "status": "pending_confirmation",
            "processing_token": None,
            "processing_expires_at": None,
        }
    )
    result = db.capture_sessions.update_one(
        {
            "_id": capture_id,
            "curator_id": curator_id,
            "status": "processing",
            "processing_token": processing_token,
        },
        {"$set": update_fields},
    )
    if result.matched_count != 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Capture processing lease was lost",
        )
    return db.capture_sessions.find_one({"_id": capture_id, "curator_id": curator_id})


def abandon_capture_session(
    db: Database,
    *,
    capture_id: str,
    curator_id: str,
    processing_token: str,
) -> None:
    """Release only this worker's unfinished claim so a retry can start."""
    db.capture_sessions.delete_one(
        {
            "_id": capture_id,
            "curator_id": curator_id,
            "status": "processing",
            "processing_token": processing_token,
        }
    )
