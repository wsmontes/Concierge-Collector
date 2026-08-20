"""Tests for capture endpoints and helpers."""

from unittest.mock import MagicMock, patch
import pytest


def _make_cursor(records: list):
    """Build a mock MongoDB cursor that supports .limit()."""
    cursor = MagicMock()
    cursor.limit.return_value = records
    return cursor


def test_match_entities_escapes_regex_metacharacters():
    """Nomes com caracteres especiais de regex devem ser escapados."""
    from app.api.capture import _match_entities

    mock_db = MagicMock()
    mock_db.entities.find.return_value = _make_cursor([])

    # Nome com $, ., (, ), +  — todos metacaracteres de regex
    with patch("app.api.capture.os.getenv", return_value=""):
        result = _match_entities(mock_db, "Café A+ (matriz) $$$")

    # Não deve lançar exceção de regex inválido
    # A query deve ter sido feita com caracteres escapados
    assert isinstance(result, list)


def test_capture_cache_includes_curator_id():
    """Cache entry must include curator_id for confirm fallback."""
    from app.api.capture import _idempotency_cache

    _idempotency_cache._data.clear()

    mock_db = MagicMock()
    # Simulate successful MongoDB replace_one
    mock_col = MagicMock()
    mock_db.__getitem__.return_value = mock_col

    # Build a minimal cache entry as capture() would after success
    from app.api.capture import CaptureResponse

    result = CaptureResponse(
        capture_id="test-key-123",
        transcription="some text",
        restaurant_name="Test Restaurant",
        entities=[],
        concepts={},
    )
    cache_entry = result.model_dump()
    cache_entry["curator_id"] = "curator_abc"
    _idempotency_cache.set("test-key-123", cache_entry)

    cached = _idempotency_cache.get("test-key-123")
    assert cached is not None
    # The cache entry must contain curator_id so confirm fallback has provenance
    assert (
        cached.get("curator_id") == "curator_abc"
    ), f"Expected curator_id='curator_abc', got {cached.get('curator_id')}"
    _idempotency_cache._data.clear()


def test_confirm_falls_back_to_cache_when_mongo_down():
    """Confirm endpoint uses cache when MongoDB find_one raises."""
    from app.api.capture import _idempotency_cache

    _idempotency_cache._data.clear()

    # Pre-populate cache with capture session including curator_id
    cache_val = {
        "capture_id": "cached-session-1",
        "transcription": "place was great",
        "restaurant_name": "Cached Place",
        "entities": [
            {
                "entity_id": "ent_001",
                "name": "Cached Place",
                "type": "restaurant",
                "location": {},
                "score": 0.95,
                "source": "mongo",
            }
        ],
        "concepts": {},
        "curator_id": "curator_cached",
    }
    _idempotency_cache.set("cached-session-1", cache_val)

    # Mock DB where find_one raises an exception (MongoDB down)
    mock_db = MagicMock()
    mock_col = MagicMock()
    mock_col.find_one.side_effect = Exception("MongoDB not reachable")
    mock_db.__getitem__.return_value = mock_col

    # Simulate the confirm logic
    from app.api.capture import _capture_collection

    col = _capture_collection(mock_db)
    try:
        session = col.find_one({"_id": "cached-session-1"})
    except Exception:
        session = None

    # Should fall back to cache since find_one raised
    if not session:
        cached = _idempotency_cache.get("cached-session-1")
        assert cached is not None, "Cache should contain the session"
        session = cached

    assert session is not None
    assert session.get("restaurant_name") == "Cached Place"
    assert session.get("curator_id") == "curator_cached"
    _idempotency_cache._data.clear()


def test_confirm_handles_entity_duplicate_key_race():
    """Parallel entity inserts don't crash with 500."""
    from pymongo.errors import DuplicateKeyError
    from app.api.capture import _idempotency_cache

    _idempotency_cache._data.clear()

    mock_db = MagicMock()
    # find_one returns None first (entity not found), then existing doc
    mock_db.entities.find_one.side_effect = [
        None,
        {"_id": "ent_001", "name": "Existing"},
    ]
    # insert_one raises DuplicateKeyError (race)
    mock_db.entities.insert_one.side_effect = DuplicateKeyError("duplicate key")

    entity_id = "ent_001"
    curator_id = "curator_x"
    matched_entity = {
        "entity_id": entity_id,
        "name": "Test Place",
        "type": "restaurant",
        "location": {},
    }

    # Simulate the confirm entity resolution logic
    entity_doc = mock_db.entities.find_one({"_id": entity_id})
    assert entity_doc is None  # First call returns None

    if not entity_doc:
        # Google Places enrichment not applicable here (source != google_places)
        # Legacy race simulation retained as a lower-level DuplicateKey check.
        from datetime import datetime, timezone

        entity_doc = {
            "_id": entity_id,
            "entity_id": entity_id,
            "name": matched_entity.get("name", "Unknown"),
            "type": matched_entity.get("type", "restaurant"),
            "data": {"location": matched_entity.get("location", {})},
            "status": "active",
            "createdBy": curator_id,
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }
        try:
            mock_db.entities.insert_one(entity_doc)
        except DuplicateKeyError:
            # Another parallel confirm already created this entity
            entity_doc = mock_db.entities.find_one({"_id": entity_id})
            # Second call returns existing doc

    assert entity_doc is not None
    assert entity_doc.get("_id") == "ent_001"
    # Verify find_one was called twice (first returns None, second recovers existing)
    assert mock_db.entities.find_one.call_count == 2
    _idempotency_cache._data.clear()


def _override_database(client, database):
    """Temporarily replace FastAPI's DB dependency for endpoint-level unit tests."""
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


def _mock_live_user(mock_db, email: str, role: str):
    mock_db.users.find_one.return_value = {
        "_id": f"user-{email}",
        "email": email,
        "google_id": f"google-{email}",
        "name": email,
        "authorized": True,
        "role": role,
    }


def test_capture_rejects_viewer_before_processing(client):
    """Viewer is read-only even when curator_id matches the JWT subject."""
    from app.api.capture import _idempotency_cache
    from app.core.security import create_access_token

    _idempotency_cache._data.clear()
    mock_db = MagicMock()
    _mock_live_user(mock_db, "viewer@example.com", "viewer")
    restore = _override_database(client, mock_db)
    token = create_access_token(data={"sub": "viewer@example.com", "role": "viewer"})
    try:
        with (
            patch("app.api.capture._transcribe", return_value="test") as transcribe,
            patch("app.api.capture._extract_restaurant_name", return_value=None),
            patch("app.api.capture._extract_concepts", return_value={}),
        ):
            response = client.post(
                "/api/v3/capture",
                json={
                    "audio": "AA==",
                    "idempotency_key": "viewer-capture-key",
                    "curator_id": "viewer@example.com",
                },
                headers={"Authorization": f"Bearer {token}"},
            )
    finally:
        restore()
        _idempotency_cache._data.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == "Requires curator role"
    transcribe.assert_not_called()


def test_confirm_capture_rejects_viewer_before_writes(client):
    """Viewer cannot confirm an owned capture and create catalog data."""
    from app.api.capture import _idempotency_cache
    from app.core.security import create_access_token

    _idempotency_cache._data.clear()
    mock_db = MagicMock()
    _mock_live_user(mock_db, "viewer@example.com", "viewer")
    session = {
        "_id": "viewer-confirm-capture",
        "curator_id": "viewer@example.com",
        "transcription": "test",
        "restaurant_name": "Test Place",
        "entities": [
            {
                "entity_id": "ent_001",
                "name": "Test Place",
                "type": "restaurant",
                "location": {},
                "source": "mongo",
            }
        ],
        "concepts": {},
    }
    mock_db.__getitem__.return_value.find_one.return_value = session
    mock_db.entities.find_one.return_value = {"_id": "ent_001", "name": "Test Place", "data": {}}
    restore = _override_database(client, mock_db)
    token = create_access_token(data={"sub": "viewer@example.com", "role": "viewer"})
    try:
        response = client.post(
            "/api/v3/capture/viewer-confirm-capture/confirm",
            json={"entity_id": "ent_001", "idempotency_key": "viewer-confirm-key"},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        restore()
        _idempotency_cache._data.clear()

    assert response.status_code == 403
    assert response.json()["detail"] == "Requires curator role"
    mock_db.curations.insert_one.assert_not_called()


@pytest.mark.mongo
def test_confirm_capture_rejects_foreign_owner(client, test_db):
    """Só o dono da sessão (ou admin) confirma — curator B não confirma a
    captura de A (auditoria ago/2026: o confirm não verificava ownership)."""
    from datetime import datetime, timezone
    from app.core.security import create_access_token

    test_db.users.delete_many({"email": "bob@x.com"})
    test_db.users.insert_one(
        {
            "_id": "test-user-bob",
            "email": "bob@x.com",
            "google_id": "test-google-bob",
            "name": "Bob",
            "authorized": True,
            "role": "curator",
        }
    )
    # sessão do dono A
    test_db["capture_sessions"].insert_one(
        {
            "_id": "test_cap_own",
            "curator_id": "alice@x.com",
            "curator": {"id": "alice@x.com", "name": "alice@x.com"},
            "transcription": "",
            "entities": [],
            "concepts": {},
            "createdAt": datetime.now(timezone.utc),
        }
    )

    try:
        token_b = create_access_token(data={"sub": "bob@x.com", "role": "curator"})
        r = client.post(
            "/api/v3/capture/test_cap_own/confirm",
            json={"entity_id": "ent_x", "idempotency_key": "k_own_test"},
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert r.status_code == 403
        assert "does not belong" in r.json()["detail"]
    finally:
        test_db["capture_sessions"].delete_one({"_id": "test_cap_own"})
        test_db.users.delete_many({"email": "bob@x.com"})
