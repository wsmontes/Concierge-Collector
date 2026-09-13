"""Full-record reads and the fenced field writer for the CMS content inspector."""

import pytest

from app.core.config import settings
from tests.factories import active_curation, active_entity


def _headers() -> dict[str, str]:
    return {"X-CMS-Service-Key": settings.cms_service_key_value, "X-CMS-Actor-Id": "cms-admin-test"}


@pytest.fixture(autouse=True)
def _isolated_db(in_memory_db):
    in_memory_db._collections.clear()
    yield
    in_memory_db._collections.clear()


def _seed_actor(in_memory_db, *, authorized: bool = True, subject: str = "cms-admin-test") -> None:
    in_memory_db.users.insert_one(
        {
            "_id": subject,
            "email": f"{subject}@example.com",
            "name": "CMS Admin",
            "authorized": authorized,
            "role": "admin" if authorized else "viewer",
        }
    )


def _curation_doc(**overrides) -> dict:
    return active_curation(
        curation_id="curation-records-1",
        _id="curation-records-1",
        catalog_sequence=1,
        restaurant_name="Record Place",
        status="active",
        **overrides,
    )


def _seed_curation(in_memory_db, **overrides) -> dict:
    doc = _curation_doc(**overrides)
    in_memory_db.curations.insert_one(doc)
    return doc


@pytest.mark.asyncio
async def test_curation_record_returns_the_full_document_with_an_embedding_summary(async_client, in_memory_db):
    _seed_curation(
        in_memory_db,
        legacy_payload={"nested": {"unknown_field": "keep-me"}},
        notes={"private": "internal only", "public": "visible"},
        embeddings=[
            {"vector": [1, 2, 3], "model": "text-embedding-3-small", "created_at": "2026-01-01T00:00:00Z"},
            {"embedding": [4, 5]},
        ],
    )

    response = await async_client.get("/api/v3/catalog/curations/curation-records-1", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "curation"
    assert body["id"] == "curation-records-1"
    record = body["record"]
    # Unknown/legacy fields and privacy-scoped notes survive untouched.
    assert record["legacy_payload"] == {"nested": {"unknown_field": "keep-me"}}
    assert record["notes"] == {"private": "internal only", "public": "visible"}
    assert record["_id"] == "curation-records-1"
    assert record["status"] == "active"
    # Vectors are replaced by a summary; the raw payload never leaves the API.
    assert record["embeddings"] == [
        {"model": "text-embedding-3-small", "dimensions": 3, "created_at": "2026-01-01T00:00:00Z"},
        {"model": None, "dimensions": 2, "created_at": None},
    ]
    assert "vector" not in response.text


@pytest.mark.asyncio
async def test_entity_record_returns_the_full_document(async_client, in_memory_db):
    in_memory_db.entities.insert_one(
        active_entity(
            entity_id="entity-records-1",
            _id="entity-records-1",
            legacy_source={"provider": "legacy", "unknown": [1, 2]},
            embeddings=[{"vector": [0.1, 0.2]}],
        )
    )

    response = await async_client.get("/api/v3/catalog/entities/entity-records-1", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "entity"
    assert body["id"] == "entity-records-1"
    assert body["record"]["legacy_source"] == {"provider": "legacy", "unknown": [1, 2]}
    assert body["record"]["embeddings"] == [{"model": None, "dimensions": 2, "created_at": None}]


@pytest.mark.asyncio
async def test_unknown_records_return_404(async_client):
    curation = await async_client.get("/api/v3/catalog/curations/missing-curation", headers=_headers())
    assert curation.status_code == 404
    assert curation.json()["detail"] == "Curation missing-curation not found"

    entity = await async_client.get("/api/v3/catalog/entities/missing-entity", headers=_headers())
    assert entity.status_code == 404
    assert entity.json()["detail"] == "Entity missing-entity not found"


@pytest.mark.asyncio
async def test_records_require_the_service_key(async_client):
    curation = await async_client.get("/api/v3/catalog/curations/curation-records-1")
    assert curation.status_code == 401
    entity = await async_client.get("/api/v3/catalog/entities/entity-records-1")
    assert entity.status_code == 401


@pytest.mark.asyncio
async def test_search_route_is_not_shadowed_by_the_record_route(async_client, in_memory_db, monkeypatch):
    monkeypatch.setattr(settings, "catalog_cursor_secret", "catalog-test-secret")
    in_memory_db.users.insert_one(
        {"_id": "cms-admin-test", "email": "cms-admin-test@example.com", "authorized": True, "role": "admin"}
    )
    _seed_curation(in_memory_db)

    response = await async_client.get("/api/v3/catalog/curations?q=record", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert [item["curation_id"] for item in body["items"]] == ["curation-records-1"]
    assert body["next_cursor"] is None


async def _patch(async_client, fields, *, if_match="4", headers=None, curation_id="curation-records-1"):
    merged = _headers() if headers is None else headers
    if if_match is not None:
        merged = {**merged, "If-Match": if_match}
    return await async_client.patch(
        f"/api/v3/catalog/curations/{curation_id}",
        json={"fields": fields},
        headers=merged,
    )


@pytest.mark.asyncio
async def test_patch_updates_fields_and_increments_version(async_client, in_memory_db):
    _seed_actor(in_memory_db)
    _seed_curation(in_memory_db, version=4, notes={"private": "old", "public": "keep"})

    response = await _patch(async_client, {"notes.private": "new", "notes.public": None, "restaurant_name": "Renamed"})
    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "curation"
    assert body["id"] == "curation-records-1"
    record = body["record"]
    # The sibling of the patched leaves survives, and null clears a field.
    assert record["notes"] == {"private": "new", "public": None}
    assert record["restaurant_name"] == "Renamed"
    assert record["version"] == 5
    assert record["updatedBy"] == "cms-admin-test@example.com"

    stored = in_memory_db.curations.find_one({"_id": "curation-records-1"})
    assert stored["notes"] == {"private": "new", "public": None}
    assert stored["version"] == 5


@pytest.mark.asyncio
async def test_patch_accepts_a_status_value_and_rejects_an_unknown_one(async_client, in_memory_db):
    _seed_actor(in_memory_db)
    _seed_curation(in_memory_db, version=4)

    accepted = await _patch(async_client, {"status": "archived"})
    assert accepted.status_code == 200
    assert accepted.json()["record"]["status"] == "archived"

    rejected = await _patch(async_client, {"status": "published"}, if_match="5")
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "invalid_request"
    assert in_memory_db.curations.find_one({"_id": "curation-records-1"})["status"] == "archived"


@pytest.mark.asyncio
async def test_patch_with_a_stale_if_match_leaves_the_document_untouched(async_client, in_memory_db):
    _seed_actor(in_memory_db)
    _seed_curation(in_memory_db, version=4, notes={"private": "old"})

    response = await _patch(async_client, {"notes.private": "stale-write"}, if_match="99")
    assert response.status_code == 409
    assert response.json()["detail"] == "Version conflict"

    stored = in_memory_db.curations.find_one({"_id": "curation-records-1"})
    assert stored["version"] == 4
    assert stored["notes"] == {"private": "old"}


@pytest.mark.asyncio
async def test_patch_requires_a_numeric_if_match(async_client, in_memory_db):
    _seed_actor(in_memory_db)
    _seed_curation(in_memory_db, version=4)

    missing = await _patch(async_client, {"restaurant_name": "No fence"}, if_match=None)
    assert missing.status_code == 400
    assert missing.json()["detail"] == "Invalid If-Match header format"

    malformed = await _patch(async_client, {"restaurant_name": "No fence"}, if_match="latest")
    assert malformed.status_code == 400
    assert malformed.json()["detail"] == "Invalid If-Match header format"


@pytest.mark.asyncio
async def test_patch_rejects_server_owned_and_denormalized_fields(async_client, in_memory_db):
    _seed_actor(in_memory_db)
    _seed_curation(in_memory_db, version=4, notes={"private": "old"})

    for fields in (
        {"version": 99},
        {"city": "Rio de Janeiro"},
        {"type": "bar"},
        {"curation_id": "other"},
        {"embeddings": []},
        {"notes.$set": "x"},
    ):
        response = await _patch(async_client, fields)
        assert response.status_code == 400, fields
        assert response.json()["detail"] == "invalid_request"

    stored = in_memory_db.curations.find_one({"_id": "curation-records-1"})
    assert stored["version"] == 4
    assert stored["notes"] == {"private": "old"}
    assert "city" not in stored


@pytest.mark.asyncio
async def test_patch_rejects_an_unauthorized_or_unknown_actor(async_client, in_memory_db):
    _seed_actor(in_memory_db, authorized=False, subject="cms-viewer-test")
    _seed_curation(in_memory_db, version=4)

    unauthorized = await _patch(
        async_client,
        {"restaurant_name": "Nope"},
        headers={**_headers(), "X-CMS-Actor-Id": "cms-viewer-test"},
    )
    assert unauthorized.status_code == 403

    unknown = await _patch(
        async_client,
        {"restaurant_name": "Nope"},
        headers={**_headers(), "X-CMS-Actor-Id": "ghost-actor"},
    )
    assert unknown.status_code == 401

    assert in_memory_db.curations.find_one({"_id": "curation-records-1"})["restaurant_name"] == "Record Place"


@pytest.mark.asyncio
async def test_patch_accepts_a_legacy_document_without_a_version(async_client, in_memory_db):
    _seed_actor(in_memory_db)
    legacy = _curation_doc()
    del legacy["version"]
    in_memory_db.curations.insert_one(legacy)

    response = await _patch(async_client, {"restaurant_name": "Legacy Renamed"})
    assert response.status_code == 200
    record = response.json()["record"]
    # The absent-version snapshot is claimed exactly once, then versioned.
    assert record["version"] == 1
    assert record["restaurant_name"] == "Legacy Renamed"
    assert in_memory_db.curations.find_one({"_id": "curation-records-1"})["version"] == 1


@pytest.mark.asyncio
async def test_patch_requires_the_service_key_and_an_actor(async_client, in_memory_db):
    _seed_actor(in_memory_db)
    _seed_curation(in_memory_db, version=4)

    no_service_key = await _patch(
        async_client,
        {"restaurant_name": "Nope"},
        headers={"X-CMS-Actor-Id": "cms-admin-test", "If-Match": "4"},
    )
    assert no_service_key.status_code == 401

    no_actor = await _patch(
        async_client,
        {"restaurant_name": "Nope"},
        headers={"X-CMS-Service-Key": settings.cms_service_key_value, "If-Match": "4"},
    )
    assert no_actor.status_code == 401
    assert no_actor.json()["detail"] == "CMS actor is required"
