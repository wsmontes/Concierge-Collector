"""Durable idempotency and processing lease for Capture.

A capture can invoke multiple paid providers (Whisper, chat completions and
Google Places). The actor-scoped capture id is therefore claimed in Mongo
*before* any provider call. The unique ``_id`` plus a renewable processing
lease makes one request the worker while concurrent duplicates fail fast and
can retry after a crashed worker stops heartbeating. Completed sessions remain
the durable idempotency result.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import secrets
from typing import Any

from fastapi import HTTPException, status
from pymongo import ReturnDocument
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

CAPTURE_PROCESSING_LEASE_SECONDS = 300
CAPTURE_LEASE_HEARTBEAT_SECONDS = 60


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


def _lost_lease() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Capture processing lease was lost",
    )


def _completed_session(collection, capture_id: str, curator_id: str) -> dict[str, Any] | None:
    existing = collection.find_one({"_id": capture_id, "curator_id": curator_id})
    if existing and existing.get("status") in {"pending_confirmation", "confirmed"}:
        return existing
    return None


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
    collection = db["capture_sessions"]

    # Fast durable retry path. This read is not the concurrency primitive; it
    # only avoids a no-op upsert for captures that are already complete.
    completed = _completed_session(collection, capture_id, curator_id)
    if completed is not None:
        return CaptureSessionClaim(acquired=False, existing_session=completed)

    try:
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
    except DuplicateKeyError:
        # Two absent-session upserts can race on the unique _id. The loser
        # observes the winner below and is treated exactly like any duplicate.
        result = None

    if result is not None and result.upserted_id is not None:
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

    # Worker crashed or stopped heartbeating. CAS on the expired timestamp so
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


def renew_capture_session(
    db: Database,
    *,
    capture_id: str,
    curator_id: str,
    processing_token: str,
    now: datetime | None = None,
) -> datetime:
    """Extend an active lease only for the worker that still owns its token."""
    renewed_at = now or _utc_now()
    processing_expires_at = renewed_at + timedelta(seconds=CAPTURE_PROCESSING_LEASE_SECONDS)
    result = db["capture_sessions"].update_one(
        {
            "_id": capture_id,
            "curator_id": curator_id,
            "status": "processing",
            "processing_token": processing_token,
        },
        {"$set": {"processing_expires_at": processing_expires_at}},
    )
    if result.matched_count != 1:
        raise _lost_lease()
    return processing_expires_at


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
    collection = db["capture_sessions"]
    result = collection.update_one(
        {
            "_id": capture_id,
            "curator_id": curator_id,
            "status": "processing",
            "processing_token": processing_token,
        },
        {"$set": update_fields},
    )
    if result.matched_count != 1:
        raise _lost_lease()
    return collection.find_one({"_id": capture_id, "curator_id": curator_id})


def abandon_capture_session(
    db: Database,
    *,
    capture_id: str,
    curator_id: str,
    processing_token: str,
) -> None:
    """Release only this worker's unfinished claim so a retry can start."""
    db["capture_sessions"].delete_one(
        {
            "_id": capture_id,
            "curator_id": curator_id,
            "status": "processing",
            "processing_token": processing_token,
        }
    )
