"""Regression tests for Capture authorization and idempotency boundaries."""

from unittest.mock import MagicMock, patch


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
