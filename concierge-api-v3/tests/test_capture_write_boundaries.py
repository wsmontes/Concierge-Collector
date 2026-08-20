"""Capture must delegate catalog mutations to the canonical write services."""

import inspect
from datetime import datetime, timezone


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


def test_capture_router_has_no_direct_catalog_inserts():
    """Entity/Curation writes belong to entity_service/curation_service."""
    import app.api.capture as capture_module

    source = inspect.getsource(capture_module)
    assert "db.entities.insert_one" not in source
    assert "db.curations.insert_one" not in source


def test_confirm_new_entity_uses_canonical_entity_contract(client, in_memory_db):
    """A skeleton entity created from Capture gets normal version/timestamps."""
    from app.api.capture import _curation_id_for_capture, _idempotency_cache
    from app.core.security import create_access_token

    curator_id = "capture-writer@example.com"
    capture_id = "cap_write_boundary"
    entity_id = "ent_capture_write_boundary"
    curation_id = _curation_id_for_capture(capture_id)

    _idempotency_cache._data.clear()
    in_memory_db.users.delete_many({"email": curator_id})
    in_memory_db.capture_sessions.delete_many({"_id": capture_id})
    in_memory_db.entities.delete_many({"_id": entity_id})
    in_memory_db.curations.delete_many({"_id": curation_id})
    in_memory_db.counters.delete_many({"_id": "curations_catalog_sequence"})
    in_memory_db.users.insert_one(
        {
            "_id": "capture-writer-user",
            "email": curator_id,
            "google_id": "capture-writer-google",
            "name": "Capture Writer",
            "authorized": True,
            "role": "curator",
        }
    )
    in_memory_db.capture_sessions.insert_one(
        {
            "_id": capture_id,
            "capture_id": capture_id,
            "curator_id": curator_id,
            "status": "pending_confirmation",
            "transcription": "The room was quiet and the pasta was excellent.",
            "restaurant_name": "Boundary Bistro",
            "entities": [
                {
                    "entity_id": entity_id,
                    "name": "Boundary Bistro",
                    "type": "restaurant",
                    "location": {"city": "Victoria"},
                    "score": 0.95,
                    "source": "mongo",
                }
            ],
            "concepts": {"mood": ["quiet"]},
            "createdAt": datetime.now(timezone.utc),
        }
    )

    restore = _override_database(client, in_memory_db)
    token = create_access_token(data={"sub": curator_id, "role": "curator"})
    try:
        response = client.post(
            f"/api/v3/capture/{capture_id}/confirm",
            json={"entity_id": entity_id, "idempotency_key": "confirm-write-boundary"},
            headers={"Authorization": f"Bearer {token}"},
        )
    finally:
        restore()

    try:
        assert response.status_code == 200, response.text
        entity = in_memory_db.entities.find_one({"_id": entity_id})
        assert entity is not None
        assert entity["version"] == 1
        assert entity["createdBy"] == curator_id
        assert entity.get("createdAt") is not None
        assert entity.get("updatedAt") is not None

        curation = in_memory_db.curations.find_one({"_id": curation_id})
        assert curation is not None
        assert curation["version"] == 1
        assert isinstance(curation.get("catalog_sequence"), int)
    finally:
        in_memory_db.users.delete_many({"email": curator_id})
        in_memory_db.capture_sessions.delete_many({"_id": capture_id})
        in_memory_db.entities.delete_many({"_id": entity_id})
        in_memory_db.curations.delete_many({"_id": curation_id})
        _idempotency_cache._data.clear()
