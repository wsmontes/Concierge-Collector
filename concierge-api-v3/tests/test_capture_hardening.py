"""Regression tests for Capture authorization and idempotency boundaries."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException


def _override_database(client, database):
    from app.core.database import get_database

    sentinel = object()
    previous = client.app.dependency_overrides.get(get_database, sentinel)
    client.app.dependency_overrides[get_database] = lambda: database

    def restore():
        if previous is sentinel:
            client.app.dependency_overrides.pop(get_database, None)
        else:
            client.app.dependency_overrides[get_database] = previous

    return restore


def test_capture_session_id_scopes_same_client_key_by_curator():
    from app.api.capture import _capture_session_id

    alice = _capture_session_id("alice@example.com", "shared-key")
    bob = _capture_session_id("bob@example.com", "shared-key")

    assert alice.startswith("cap_")
    assert bob.startswith("cap_")
    assert alice != bob
    assert alice == _capture_session_id("alice@example.com", "shared-key")


def test_new_capture_curation_id_uses_full_server_capture_identity():
    from app.api.capture import _curation_id_for_capture

    first = _curation_id_for_capture("cap_0123456789abcdefAAAA")
    second = _curation_id_for_capture("cap_0123456789abcdefBBBB")

    assert first.startswith("cur_")
    assert second.startswith("cur_")
    assert first != second
    # Legacy sessions keep the historical derivation so a retry after deploy
    # cannot create a second curation under a new identifier.
    assert _curation_id_for_capture("legacy-capture-123456789") == "cur_legacy-capture-1"


def test_capture_reuses_persisted_scoped_session_before_ai(client):
    from app.api.capture import _capture_session_id, _idempotency_cache
    from app.core.security import create_access_token

    _idempotency_cache._data.clear()
    capture_id = _capture_session_id("alice@example.com", "retry-key")
    persisted = {
        "_id": capture_id,
        "capture_id": capture_id,
        "curator_id": "alice@example.com",
        "transcription": "already persisted",
        "restaurant_name": "Persisted Place",
        "entities": [],
        "concepts": {},
        "status": "pending_confirmation",
    }
    db = MagicMock()
    db.__getitem__.return_value.find_one.return_value = persisted
    restore = _override_database(client, db)
    token = create_access_token(data={"sub": "alice@example.com", "role": "curator"})
    try:
        with patch("app.api.capture._transcribe", return_value="must not run") as transcribe:
            response = client.post(
                "/api/v3/capture",
                json={
                    "audio": "AA==",
                    "idempotency_key": "retry-key",
                    "curator_id": "alice@example.com",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
    finally:
        restore()
        _idempotency_cache._data.clear()

    assert response.status_code == 200
    assert response.json()["capture_id"] == capture_id
    assert response.json()["transcription"] == "already persisted"
    transcribe.assert_not_called()


def test_capture_processing_session_returns_conflict_before_paid_ai(client, in_memory_db):
    """A duplicate request must not start a second Whisper/GPT pipeline."""
    from app.api.capture import _capture_session_id, _idempotency_cache
    from app.core.security import create_access_token

    _idempotency_cache._data.clear()
    curator_id = "alice@example.com"
    idempotency_key = "processing-key"
    capture_id = _capture_session_id(curator_id, idempotency_key)
    now = datetime.now(timezone.utc)
    in_memory_db.capture_sessions.delete_many({"_id": capture_id})
    in_memory_db.capture_sessions.insert_one(
        {
            "_id": capture_id,
            "capture_id": capture_id,
            "curator_id": curator_id,
            "idempotency_key": idempotency_key,
            "status": "processing",
            "processing_token": "worker-one",
            "processing_expires_at": now + timedelta(minutes=5),
            "createdAt": now,
        }
    )
    restore = _override_database(client, in_memory_db)
    token = create_access_token(data={"sub": curator_id, "role": "curator"})
    try:
        with patch("app.api.capture._transcribe", return_value="must not run") as transcribe:
            response = client.post(
                "/api/v3/capture",
                json={
                    "audio": "AA==",
                    "idempotency_key": idempotency_key,
                    "curator_id": curator_id,
                },
                headers={"Authorization": f"Bearer {token}"},
            )
    finally:
        restore()
        in_memory_db.capture_sessions.delete_many({"_id": capture_id})
        _idempotency_cache._data.clear()

    assert response.status_code == 409
    assert response.headers.get("Retry-After") == "2"
    transcribe.assert_not_called()


def test_confirm_validates_owner_before_returning_cached_result(client):
    from app.api.capture import _confirm_cache_key, _idempotency_cache
    from app.core.security import create_access_token

    _idempotency_cache._data.clear()
    capture_id = "cap_owner_boundary"
    _idempotency_cache.set(
        _confirm_cache_key(capture_id, "same-confirm-key"),
        {"curation_id": "cur_cached", "entity_id": "ent_1", "status": "created"},
    )
    db = MagicMock()
    db.__getitem__.return_value.find_one.return_value = {
        "_id": capture_id,
        "capture_id": capture_id,
        "curator_id": "alice@example.com",
        "transcription": "private",
        "entities": [],
        "concepts": {},
    }
    restore = _override_database(client, db)
    token = create_access_token(data={"sub": "bob@example.com", "role": "curator"})
    try:
        response = client.post(
            f"/api/v3/capture/{capture_id}/confirm",
            json={"entity_id": "ent_1", "idempotency_key": "same-confirm-key"},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        restore()
        _idempotency_cache._data.clear()

    assert response.status_code == 403
    assert "does not belong" in response.json()["detail"]


def test_capture_processing_claim_allows_only_one_active_worker(in_memory_db):
    """The same capture cannot start two paid AI pipelines concurrently."""
    from app.services.capture_session_service import claim_capture_session

    collection = in_memory_db.capture_sessions
    collection.delete_many({})
    now = datetime.now(timezone.utc)
    first = claim_capture_session(
        in_memory_db,
        capture_id="cap_atomic",
        curator_id="alice@example.com",
        idempotency_key="same-key",
        now=now,
    )

    assert first.acquired is True
    assert first.processing_token

    with pytest.raises(HTTPException) as duplicate:
        claim_capture_session(
            in_memory_db,
            capture_id="cap_atomic",
            curator_id="alice@example.com",
            idempotency_key="same-key",
            now=now,
        )
    assert duplicate.value.status_code == 409


def test_capture_processing_claim_can_take_over_expired_worker(in_memory_db):
    from app.services.capture_session_service import claim_capture_session

    collection = in_memory_db.capture_sessions
    collection.delete_many({})
    now = datetime.now(timezone.utc)
    collection.insert_one(
        {
            "_id": "cap_expired",
            "capture_id": "cap_expired",
            "curator_id": "alice@example.com",
            "idempotency_key": "same-key",
            "status": "processing",
            "processing_token": "dead-worker",
            "processing_expires_at": now - timedelta(seconds=1),
            "createdAt": now - timedelta(minutes=10),
        }
    )

    takeover = claim_capture_session(
        in_memory_db,
        capture_id="cap_expired",
        curator_id="alice@example.com",
        idempotency_key="same-key",
        now=now,
    )

    assert takeover.acquired is True
    assert takeover.processing_token != "dead-worker"
    stored = collection.find_one({"_id": "cap_expired"})
    assert stored["processing_token"] == takeover.processing_token
    assert stored["processing_expires_at"] > now


def test_completed_capture_claim_returns_existing_session(in_memory_db):
    from app.services.capture_session_service import claim_capture_session

    collection = in_memory_db.capture_sessions
    collection.delete_many({})
    now = datetime.now(timezone.utc)
    collection.insert_one(
        {
            "_id": "cap_done",
            "capture_id": "cap_done",
            "curator_id": "alice@example.com",
            "idempotency_key": "same-key",
            "status": "pending_confirmation",
            "transcription": "already paid for",
            "restaurant_name": "Existing",
            "entities": [],
            "concepts": {},
            "createdAt": now,
        }
    )

    claim = claim_capture_session(
        in_memory_db,
        capture_id="cap_done",
        curator_id="alice@example.com",
        idempotency_key="same-key",
        now=now,
    )

    assert claim.acquired is False
    assert claim.existing_session["transcription"] == "already paid for"
