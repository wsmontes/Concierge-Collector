"""Capture processing leases must remain exclusive during long paid pipelines."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException


def test_renewal_prevents_takeover_after_original_lease_would_expire(in_memory_db):
    from app.services.capture_session_service import (
        CAPTURE_PROCESSING_LEASE_SECONDS,
        claim_capture_session,
        renew_capture_session,
    )

    collection = in_memory_db.capture_sessions
    collection.delete_many({})
    started = datetime(2026, 8, 20, 20, 0, tzinfo=timezone.utc)
    claim = claim_capture_session(
        in_memory_db,
        capture_id="cap_long_pipeline",
        curator_id="alice@example.com",
        idempotency_key="long-pipeline",
        now=started,
    )
    original_expiry = collection.find_one({"_id": "cap_long_pipeline"})["processing_expires_at"]

    renewed_at = started + timedelta(seconds=CAPTURE_PROCESSING_LEASE_SECONDS - 1)
    renewed_expiry = renew_capture_session(
        in_memory_db,
        capture_id="cap_long_pipeline",
        curator_id="alice@example.com",
        processing_token=claim.processing_token,
        now=renewed_at,
    )

    assert renewed_expiry > original_expiry
    with pytest.raises(HTTPException) as duplicate:
        claim_capture_session(
            in_memory_db,
            capture_id="cap_long_pipeline",
            curator_id="alice@example.com",
            idempotency_key="long-pipeline",
            now=started + timedelta(seconds=CAPTURE_PROCESSING_LEASE_SECONDS + 1),
        )
    assert duplicate.value.status_code == 409


def test_renewal_rejects_worker_that_lost_its_processing_token(in_memory_db):
    from app.services.capture_session_service import claim_capture_session, renew_capture_session

    collection = in_memory_db.capture_sessions
    collection.delete_many({})
    started = datetime(2026, 8, 20, 20, 0, tzinfo=timezone.utc)
    claim_capture_session(
        in_memory_db,
        capture_id="cap_wrong_worker",
        curator_id="alice@example.com",
        idempotency_key="wrong-worker",
        now=started,
    )

    with pytest.raises(HTTPException) as lost:
        renew_capture_session(
            in_memory_db,
            capture_id="cap_wrong_worker",
            curator_id="alice@example.com",
            processing_token="not-the-owner",
            now=started + timedelta(seconds=30),
        )
    assert lost.value.status_code == 409
