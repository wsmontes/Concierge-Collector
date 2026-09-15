"""Universal record reads for the Admin Inspector (CMS boundary).

The Inspector must render 100% of a stored Curation/Entity, so these tests
pin the guarantees it depends on: unknown and legacy keys survive, BSON-only
values never reach the wire, pagination and counts are scoped, and the
service-key/actor boundary is enforced.
"""

import json
import struct
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from bson import Binary, ObjectId
from bson.decimal128 import Decimal128

from app.core.config import settings
from tests.factories import active_curation, active_entity

ACTOR_ID = "cms-admin-test"
OWNER_ID = "curator-test-id"
RECORD_PATHS = (
    "/api/v3/catalog/curations/c1/record",
    "/api/v3/catalog/entities",
    "/api/v3/catalog/entities/e1/record",
    "/api/v3/catalog/entities/e1/curations",
)
WRITE_PATHS = (
    "/api/v3/catalog/curations/c1",
    "/api/v3/catalog/entities/e1",
)


def _headers() -> dict[str, str]:
    return {"X-CMS-Service-Key": settings.cms_service_key_value, "X-CMS-Actor-Id": ACTOR_ID}


def _write_headers(
    *,
    actor: str | None = OWNER_ID,
    role: str | None = None,
    if_match: str | None = "1",
) -> dict[str, str]:
    headers = {"X-CMS-Service-Key": settings.cms_service_key_value}
    if actor is not None:
        headers["X-CMS-Actor-Id"] = actor
    if role is not None:
        headers["X-CMS-Actor-Role"] = role
    if if_match is not None:
        headers["If-Match"] = if_match
    return headers


def _seed_cms_admin(db) -> None:
    db.users.insert_one({"_id": ACTOR_ID, "email": f"{ACTOR_ID}@example.com", "authorized": True, "role": "admin"})


@pytest.mark.asyncio
async def test_record_routes_require_an_actor(async_client, in_memory_db):
    in_memory_db._collections.clear()

    for path in RECORD_PATHS:
        response = await async_client.get(path, headers={"X-CMS-Service-Key": settings.cms_service_key_value})
        assert response.status_code == 401, path
        assert response.json()["detail"] == "CMS actor is required"


@pytest.mark.asyncio
async def test_record_routes_require_the_service_credential(async_client, in_memory_db):
    in_memory_db._collections.clear()

    for path in RECORD_PATHS:
        response = await async_client.get(
            path, headers={"X-CMS-Service-Key": "not-the-cms-key", "X-CMS-Actor-Id": ACTOR_ID}
        )
        assert response.status_code == 401, path
        assert response.json()["detail"] == "Invalid CMS service credential"


@pytest.mark.asyncio
async def test_missing_curation_and_entity_records_return_404(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)

    curation = await async_client.get("/api/v3/catalog/curations/absent-curation/record", headers=_headers())
    assert curation.status_code == 404

    entity = await async_client.get("/api/v3/catalog/entities/absent-entity/record", headers=_headers())
    assert entity.status_code == 404


@pytest.mark.asyncio
async def test_unknown_and_legacy_keys_survive_the_round_trip(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(
            curation_id="c-legacy",
            _id="c-legacy",
            transcript="raw capture transcript",
            legacy_provenance={"imported_by": "batch-2019", "raw": [1, "two", {"three": 3}]},
            data={"weird_key": {"nested": ["kept"]}},
        )
    )
    in_memory_db.entities.insert_one(
        active_entity(
            entity_id="e-legacy",
            _id="e-legacy",
            metadata=[{"source": "legacy-import", "data": {"place_id": "ChIJ-legacy"}}],
            sync={"provider": "osm", "cursor": {"page": 7}},
        )
    )

    curation = await async_client.get("/api/v3/catalog/curations/c-legacy/record", headers=_headers())
    assert curation.status_code == 200
    record = curation.json()["record"]
    assert record["id"] == "c-legacy"
    assert "_id" not in record
    assert record["transcript"] == "raw capture transcript"
    assert record["legacy_provenance"] == {"imported_by": "batch-2019", "raw": [1, "two", {"three": 3}]}
    assert record["data"]["weird_key"] == {"nested": ["kept"]}

    entity = await async_client.get("/api/v3/catalog/entities/e-legacy/record", headers=_headers())
    assert entity.status_code == 200
    entity_record = entity.json()["record"]
    assert entity_record["metadata"] == [{"source": "legacy-import", "data": {"place_id": "ChIJ-legacy"}}]
    assert entity_record["sync"] == {"provider": "osm", "cursor": {"page": 7}}


@pytest.mark.asyncio
async def test_stored_bson_values_are_rendered_json_safe(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(
            curation_id="c-bson",
            _id=ObjectId("507f1f77bcf86cd799439011"),
            updatedAt=datetime(2026, 8, 18, 12, 30, tzinfo=timezone.utc),
            price=Decimal128("19.90"),
            legacy_ref=ObjectId("507f1f77bcf86cd799439012"),
        )
    )

    response = await async_client.get("/api/v3/catalog/curations/c-bson/record", headers=_headers())
    assert response.status_code == 200
    record = json.loads(response.text)["record"]

    assert record["id"] == "507f1f77bcf86cd799439011"
    assert record["updatedAt"] == "2026-08-18T12:30:00+00:00"
    assert record["price"] == "19.90"
    assert record["legacy_ref"] == "507f1f77bcf86cd799439012"


@pytest.mark.asyncio
async def test_naive_bson_datetimes_are_reported_as_utc(async_client, in_memory_db):
    """The driver returns BSON datetimes without tzinfo even though they are UTC.

    Emitting them verbatim drops the offset, so the Admin parses them as local
    time and every rendered date is shifted by the viewer's UTC offset.
    """
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(
            curation_id="c-naive-record",
            _id="c-naive-record",
            updatedAt=datetime(2026, 8, 18, 12, 30),
            createdAt=datetime(2026, 8, 1, 9, 5, 30, 250000),
        )
    )

    response = await async_client.get("/api/v3/catalog/curations/c-naive-record/record", headers=_headers())
    assert response.status_code == 200
    record = json.loads(response.text)["record"]

    assert record["updatedAt"] == "2026-08-18T12:30:00+00:00"
    assert record["createdAt"] == "2026-08-01T09:05:30.250000+00:00"


@pytest.mark.asyncio
async def test_embeddings_are_summarised_and_never_returned_as_bytes(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    packed = struct.pack("<3f", 0.5, -1.5, 2.0)
    in_memory_db.curations.insert_one(
        active_curation(
            curation_id="c-packed",
            _id="c-packed",
            embeddings=[{"vector": Binary(packed, subtype=0), "model": "text-embedding-3-small"}],
        )
    )
    in_memory_db.curations.insert_one(
        active_curation(_id="c-doubles", curation_id="c-doubles", embeddings=[[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
    )

    binary_response = await async_client.get("/api/v3/catalog/curations/c-packed/record", headers=_headers())
    assert binary_response.status_code == 200
    assert packed not in binary_response.content
    assert binary_response.json()["record"]["embeddings"] == [
        {"vector": {"format": "binary-float32", "byte_length": 12}, "model": "text-embedding-3-small"}
    ]

    list_response = await async_client.get("/api/v3/catalog/curations/c-doubles/record", headers=_headers())
    assert list_response.status_code == 200
    assert list_response.json()["record"]["embeddings"] == {
        "format": "float-array",
        "vector_count": 2,
        "dimensions": 3,
    }


@pytest.mark.asyncio
async def test_entity_city_follows_the_domain_location_chain(async_client, in_memory_db):
    """Every shape the domain writes must resolve, in the documented order:
    top-level `city`, then the parsed location/address chain, then `data.city`."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.entities.insert_one(
        active_entity(_id="top", entity_id="top", name="Top", city="Canonical", data={"city": "Ignored"})
    )
    in_memory_db.entities.insert_one(
        active_entity(_id="nested", entity_id="nested", name="Nested", data={"location": {"city": "Victoria"}})
    )
    in_memory_db.entities.insert_one(
        active_entity(_id="flat", entity_id="flat", name="Flat", data={"city": "São Paulo"})
    )
    in_memory_db.entities.insert_one(
        active_entity(_id="none", entity_id="none", name="None", data={"phone": "+1 250 555"})
    )

    response = await async_client.get("/api/v3/catalog/entities?limit=5", headers=_headers())

    assert response.status_code == 200
    cities = {item["id"]: item["city"] for item in response.json()["items"]}
    assert cities == {"top": "Canonical", "nested": "Victoria", "flat": "São Paulo", "none": None}


@pytest.mark.asyncio
async def test_entity_rows_report_naive_bson_datetimes_as_utc(async_client, in_memory_db):
    """The Entity list has the same obligation as the Curation list: a BSON
    datetime is UTC, so the serialized value must carry the offset."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.entities.insert_one(
        active_entity(_id="naive", entity_id="naive", name="Naive", updatedAt=datetime(2026, 9, 11, 21, 45)),
    )

    response = await async_client.get("/api/v3/catalog/entities?limit=5", headers=_headers())

    assert response.status_code == 200
    updated_at = response.json()["items"][0]["updated_at"]
    assert datetime.fromisoformat(updated_at).utcoffset() == timedelta(0)
    assert updated_at.startswith("2026-09-11T21:45")


@pytest.mark.asyncio
async def test_entity_list_pages_by_after_id_and_counts_curations(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    for entity_id in ("a", "b", "c"):
        in_memory_db.entities.insert_one(
            active_entity(_id=entity_id, entity_id=entity_id, name=f"Place {entity_id}", data={"city": "São Paulo"})
        )
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1", entity_id="a"))
    in_memory_db.curations.insert_one(active_curation(_id="c2", curation_id="c2", entity_id="a"))
    in_memory_db.curations.insert_one(active_curation(_id="c3", curation_id="c3", entity_id="b", status="deleted"))

    first_page = await async_client.get("/api/v3/catalog/entities?limit=2", headers=_headers())
    assert first_page.status_code == 200
    body = first_page.json()
    assert [item["id"] for item in body["items"]] == ["a", "b"]
    assert body["next_cursor"] == "b"
    assert body["total"] == 3
    assert {item["id"]: item["curations_count"] for item in body["items"]} == {"a": 2, "b": 0}
    # The ids travel for the CMS-side membership join: one per Curation of the
    # Entity, the deleted tombstone excluded, and an empty list for an Entity
    # no Curation references — never a missing key.
    assert {item["id"]: item["curation_ids"] for item in body["items"]} == {"a": ["c1", "c2"], "b": []}
    assert body["items"][0]["city"] == "São Paulo"
    assert body["items"][0]["name"] == "Place a"
    assert body["items"][0]["status"] == "active"
    assert body["items"][0]["version"] == 1
    assert body["items"][0]["updated_at"] == "2026-08-18T00:00:00Z"

    second_page = await async_client.get("/api/v3/catalog/entities?limit=2&after_id=b", headers=_headers())
    assert second_page.status_code == 200
    assert [item["id"] for item in second_page.json()["items"]] == ["c"]
    assert second_page.json()["items"][0]["curation_ids"] == []
    assert second_page.json()["next_cursor"] is None


@pytest.mark.asyncio
async def test_entity_curation_ids_follow_every_reference_shape(async_client, in_memory_db):
    """A Curation references its Entity by string ``_id``, by an ObjectId
    ``_id`` written by a bulk import, or by the ``entity_id`` slug. The page
    joins all three in ONE query and keys the ids back to the row the Admin
    renders."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    bulk_entity_id = ObjectId()
    in_memory_db.entities.insert_one(active_entity(_id=bulk_entity_id, entity_id="bulk-slug", name="Bulk Place"))
    # `_id` and `curation_id` differ on purpose: the CMS identity — what the
    # membership ledger references — is `curation_id`.
    in_memory_db.curations.insert_one(
        active_curation(_id="raw-object-id", curation_id="c-object-id", entity_id=bulk_entity_id)
    )
    in_memory_db.curations.insert_one(
        active_curation(_id="raw-string-id", curation_id="c-string-id", entity_id=str(bulk_entity_id))
    )
    in_memory_db.curations.insert_one(active_curation(_id="raw-slug", curation_id="c-slug", entity_id="bulk-slug"))
    in_memory_db.curations.insert_one(active_curation(_id="raw-other", curation_id="c-other", entity_id="elsewhere"))

    response = await async_client.get("/api/v3/catalog/entities?limit=5", headers=_headers())

    assert response.status_code == 200
    item = response.json()["items"][0]
    assert item["id"] == str(bulk_entity_id)
    # Every reference shape resolves to the one row, and no id is duplicated.
    assert sorted(item["curation_ids"]) == ["c-object-id", "c-slug", "c-string-id"]


@pytest.mark.asyncio
async def test_entity_list_filters_by_query_type_and_status(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.entities.insert_one(
        active_entity(
            _id="junction-42",
            entity_id="junction-42",
            name="Corner Cafe",
            type="cafe",
            status="active",
            externalId="ChIJ-junction-42",
        )
    )
    in_memory_db.entities.insert_one(
        active_entity(_id="pizza-b", entity_id="pizza-b", name="Pizza House", type="restaurant", status="archived")
    )

    by_name = await async_client.get("/api/v3/catalog/entities?q=pizza", headers=_headers())
    assert [item["id"] for item in by_name.json()["items"]] == ["pizza-b"]
    assert by_name.json()["total"] == 1

    by_entity_id = await async_client.get("/api/v3/catalog/entities?q=junction", headers=_headers())
    assert [item["id"] for item in by_entity_id.json()["items"]] == ["junction-42"]

    by_external_id = await async_client.get("/api/v3/catalog/entities?q=chij-junction", headers=_headers())
    assert [item["id"] for item in by_external_id.json()["items"]] == ["junction-42"]

    by_type = await async_client.get("/api/v3/catalog/entities?type=cafe", headers=_headers())
    assert [item["id"] for item in by_type.json()["items"]] == ["junction-42"]

    by_status = await async_client.get("/api/v3/catalog/entities?status=archived", headers=_headers())
    assert [item["id"] for item in by_status.json()["items"]] == ["pizza-b"]


@pytest.mark.asyncio
async def test_entity_curations_are_scoped_ordered_and_paged(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.entities.insert_one(active_entity(_id="ent-a", entity_id="ent-a"))
    in_memory_db.curations.insert_one(
        active_curation(_id="older", curation_id="older", entity_id="ent-a", updatedAt="2026-08-01T00:00:00+00:00")
    )
    in_memory_db.curations.insert_one(
        active_curation(
            _id="newer",
            curation_id="newer",
            entity_id="ent-a",
            updatedAt="2026-09-01T00:00:00+00:00",
            legacy_leg="kept",
        )
    )
    in_memory_db.curations.insert_one(
        active_curation(_id="other", curation_id="other", entity_id="ent-b", updatedAt="2026-10-01T00:00:00+00:00")
    )

    response = await async_client.get("/api/v3/catalog/entities/ent-a/curations", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["id"] for item in body["items"]] == ["newer", "older"]
    assert body["items"][0]["legacy_leg"] == "kept"

    first_page = await async_client.get("/api/v3/catalog/entities/ent-a/curations?limit=1", headers=_headers())
    assert [item["id"] for item in first_page.json()["items"]] == ["newer"]

    second_page = await async_client.get(
        "/api/v3/catalog/entities/ent-a/curations?limit=1&after_id=newer", headers=_headers()
    )
    assert second_page.status_code == 200
    assert [item["id"] for item in second_page.json()["items"]] == ["older"]

    unresolvable_cursor = await async_client.get(
        "/api/v3/catalog/entities/ent-a/curations?after_id=not-a-curation", headers=_headers()
    )
    assert unresolvable_cursor.status_code == 409

    missing_entity = await async_client.get("/api/v3/catalog/entities/absent/curations", headers=_headers())
    assert missing_entity.status_code == 404


# ── CMS write boundary (plan §32/§33/§45) ─────────────────────────────────

CURATION_SYSTEM_KEYS = (
    "_id",
    "id",
    "curation_id",
    "version",
    "createdAt",
    "updatedAt",
    "createdBy",
    "updatedBy",
    "catalog_sequence",
    "embeddings",
    "embeddings_metadata",
)
ENTITY_SYSTEM_KEYS = ("_id", "id", "entity_id", "version", "createdAt", "updatedAt", "createdBy", "updatedBy")


@pytest.mark.asyncio
async def test_write_routes_require_an_actor(async_client, in_memory_db):
    in_memory_db._collections.clear()

    for path in WRITE_PATHS:
        response = await async_client.patch(
            path, json={"restaurant_name": "Renamed"}, headers=_write_headers(actor=None)
        )
        assert response.status_code == 401, path
        assert response.json()["detail"] == "CMS actor is required"


@pytest.mark.asyncio
async def test_write_routes_require_if_match(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1"))
    in_memory_db.entities.insert_one(active_entity(_id="e1", entity_id="e1"))

    for path in WRITE_PATHS:
        response = await async_client.patch(path, json={"name": "Renamed"}, headers=_write_headers(if_match=None))
        assert response.status_code == 428, path
        assert response.json()["detail"] == "If-Match header required"


@pytest.mark.asyncio
async def test_write_routes_refuse_a_viewer_role(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1"))
    in_memory_db.entities.insert_one(active_entity(_id="e1", entity_id="e1"))

    for path in WRITE_PATHS:
        response = await async_client.patch(path, json={"name": "Renamed"}, headers=_write_headers(role="viewer"))
        assert response.status_code == 403, path
        assert "viewer" in response.json()["detail"]


@pytest.mark.asyncio
async def test_write_routes_report_the_stale_version(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1"))
    in_memory_db.entities.insert_one(active_entity(_id="e1", entity_id="e1"))

    curation = await async_client.patch(
        "/api/v3/catalog/curations/c1", json={"restaurant_name": "Renamed"}, headers=_write_headers(if_match="9")
    )
    assert curation.status_code == 409
    assert curation.json()["detail"] == "Version conflict: current=1, requested=9"

    entity = await async_client.patch(
        "/api/v3/catalog/entities/e1", json={"name": "Renamed"}, headers=_write_headers(if_match="9")
    )
    assert entity.status_code == 409
    assert entity.json()["detail"] == "Version conflict or not found"

    absent = await async_client.patch(
        "/api/v3/catalog/curations/absent", json={"restaurant_name": "Renamed"}, headers=_write_headers()
    )
    assert absent.status_code == 404
    assert absent.json()["detail"] == "Curation not found"


@pytest.mark.asyncio
async def test_curation_write_follows_the_domain_ownership_rules(async_client, in_memory_db):
    """The CMS actor is resolved through the SAME ownership helpers: a curator
    may not touch another curator's Curation, an admin may."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1"))
    before = deepcopy(in_memory_db.curations.find_one({"curation_id": "c1"}))

    other_curator = await async_client.patch(
        "/api/v3/catalog/curations/c1",
        json={"restaurant_name": "Renamed"},
        headers=_write_headers(actor="another-curator"),
    )
    assert other_curator.status_code == 403
    assert other_curator.json()["detail"] == {
        "code": "curation_owner_mismatch",
        "message": "Cannot modify another curator's curation",
    }
    assert in_memory_db.curations.find_one({"curation_id": "c1"}) == before

    admin = await async_client.patch(
        "/api/v3/catalog/curations/c1",
        json={"restaurant_name": "Renamed"},
        headers=_write_headers(actor=ACTOR_ID, role="admin"),
    )
    assert admin.status_code == 200, admin.text
    assert admin.json()["record"]["updatedBy"] == f"{ACTOR_ID}@example.com"


@pytest.mark.asyncio
async def test_write_actor_resolves_to_its_operational_subject(async_client, in_memory_db):
    """Payload forwards the opaque ``user_id``; ownership and ``updatedBy`` are
    bound to the stable email subject, so the id has to resolve to it."""
    in_memory_db._collections.clear()
    in_memory_db.users.insert_one(
        {
            "_id": "507f1f77bcf86cd799439011",
            "email": "wagner@example.com",
            "authorized": True,
            "role": "curator",
        }
    )
    in_memory_db.curations.insert_one(
        active_curation(
            _id="c1",
            curation_id="c1",
            curator_id="wagner@example.com",
            curator={"id": "wagner@example.com", "name": "Wagner"},
        )
    )

    response = await async_client.patch(
        "/api/v3/catalog/curations/c1",
        json={"restaurant_name": "Renamed"},
        headers=_write_headers(actor="507f1f77bcf86cd799439011"),
    )

    assert response.status_code == 200, response.text
    assert response.json()["record"]["updatedBy"] == "wagner@example.com"


@pytest.mark.asyncio
async def test_system_managed_keys_are_rejected_and_the_document_is_untouched(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1"))
    in_memory_db.entities.insert_one(active_entity(_id="e1", entity_id="e1"))
    curation_before = deepcopy(in_memory_db.curations.find_one({"curation_id": "c1"}))
    entity_before = deepcopy(in_memory_db.entities.find_one({"entity_id": "e1"}))

    for key in CURATION_SYSTEM_KEYS:
        response = await async_client.patch(
            "/api/v3/catalog/curations/c1", json={key: "attempted"}, headers=_write_headers()
        )
        assert response.status_code == 422, key
        assert key in response.json()["detail"]

    for key in ENTITY_SYSTEM_KEYS:
        response = await async_client.patch(
            "/api/v3/catalog/entities/e1", json={key: "attempted"}, headers=_write_headers()
        )
        assert response.status_code == 422, key
        assert key in response.json()["detail"]

    assert in_memory_db.curations.find_one({"curation_id": "c1"}) == curation_before
    assert in_memory_db.entities.find_one({"entity_id": "e1"}) == entity_before


@pytest.mark.asyncio
async def test_undeclared_root_keys_round_trip_and_stay_visible(async_client, in_memory_db):
    """The whole point of the boundary: a legacy key no editor declared can be
    edited and is readable back through the universal record route."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1"))
    in_memory_db.entities.insert_one(active_entity(_id="e1", entity_id="e1"))

    curated = await async_client.patch(
        "/api/v3/catalog/curations/c1",
        json={"legacy_provenance": {"batch": 7}, "restaurant_name": "Renamed"},
        headers=_write_headers(),
    )
    assert curated.status_code == 200, curated.text
    record = curated.json()["record"]
    assert record["legacy_provenance"] == {"batch": 7}
    assert record["restaurant_name"] == "Renamed"
    assert record["version"] == 2
    assert record["updatedBy"] == OWNER_ID

    shown = await async_client.get("/api/v3/catalog/curations/c1/record", headers=_headers())
    assert shown.status_code == 200
    assert shown.json()["record"]["legacy_provenance"] == {"batch": 7}

    entity = await async_client.patch(
        "/api/v3/catalog/entities/e1",
        json={"legacy_flag": True, "name": "Renamed Place"},
        headers=_write_headers(),
    )
    assert entity.status_code == 200, entity.text
    entity_record = entity.json()["record"]
    assert entity_record["legacy_flag"] is True
    assert entity_record["name"] == "Renamed Place"
    assert entity_record["version"] == 2

    entity_shown = await async_client.get("/api/v3/catalog/entities/e1/record", headers=_headers())
    assert entity_shown.status_code == 200
    assert entity_shown.json()["record"]["legacy_flag"] is True


@pytest.mark.asyncio
async def test_domain_patch_routes_keep_their_strict_contract(async_client, in_memory_db, auth_headers):
    """Only the CMS models relax: the domain routes still reject invalid values
    and still ignore keys they never declared."""
    in_memory_db._collections.clear()
    in_memory_db.curations.insert_one(active_curation(_id="c1", curation_id="c1"))
    in_memory_db.entities.insert_one(active_entity(_id="e1", entity_id="e1"))

    invalid = await async_client.patch("/api/v3/curations/c1", json={"status": "nonsense"}, headers=auth_headers)
    assert invalid.status_code == 422

    undeclared = await async_client.patch(
        "/api/v3/curations/c1", json={"legacy_provenance": {"batch": 7}}, headers=auth_headers
    )
    assert undeclared.status_code == 200, undeclared.text
    assert "legacy_provenance" not in in_memory_db.curations.find_one({"curation_id": "c1"})

    entity_undeclared = await async_client.patch(
        "/api/v3/entities/e1", json={"legacy_flag": True}, headers={**auth_headers, "If-Match": "1"}
    )
    assert entity_undeclared.status_code == 200, entity_undeclared.text
    assert "legacy_flag" not in in_memory_db.entities.find_one({"entity_id": "e1"})


# ── Batch reads: Curation summaries and content health (plan §37) ────────────

BATCH_PATHS = (
    ("/api/v3/catalog/curations/summaries", {"curation_ids": ["c1"]}),
    ("/api/v3/catalog/content-health", {"member_curation_ids": []}),
)


@pytest.mark.asyncio
async def test_batch_routes_require_the_service_credential_and_an_actor(async_client, in_memory_db):
    in_memory_db._collections.clear()

    for path, payload in BATCH_PATHS:
        no_actor = await async_client.post(
            path, json=payload, headers={"X-CMS-Service-Key": settings.cms_service_key_value}
        )
        assert no_actor.status_code == 401, path
        assert no_actor.json()["detail"] == "CMS actor is required"

        bad_key = await async_client.post(
            path, json=payload, headers={"X-CMS-Service-Key": "not-the-cms-key", "X-CMS-Actor-Id": ACTOR_ID}
        )
        assert bad_key.status_code == 401, path
        assert bad_key.json()["detail"] == "Invalid CMS service credential"


@pytest.mark.asyncio
async def test_batch_routes_require_a_live_admin_actor(async_client, in_memory_db):
    in_memory_db._collections.clear()
    in_memory_db.users.insert_one(
        {"_id": "curator-1", "email": "curator-1@example.com", "authorized": True, "role": "curator"}
    )

    for path, payload in BATCH_PATHS:
        unknown = await async_client.post(path, json=payload, headers={**_headers(), "X-CMS-Actor-Id": "ghost"})
        assert unknown.status_code == 401, path
        assert unknown.json()["detail"] == "CMS actor was not found"

        unprivileged = await async_client.post(
            path, json=payload, headers={**_headers(), "X-CMS-Actor-Id": "curator-1"}
        )
        assert unprivileged.status_code == 403, path
        assert unprivileged.json()["detail"] == "CMS admin access is required"


@pytest.mark.asyncio
async def test_curation_summaries_preserve_order_omit_unknown_and_match_the_list_rows(async_client, in_memory_db):
    """Humanizing a Collection member must serve the exact row the list serves:
    one builder, requested order, unknown ids omitted instead of rejected."""
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(
            _id="s-rich",
            curation_id="s-rich",
            catalog_sequence=1,
            status="active",
            categories={"Mood": ["Casual"]},
            sources={"image": [{"url": "a"}, {"url": "b"}]},
            transcript="captured",
            version=4,
        )
    )
    in_memory_db.curations.insert_one(
        active_curation(_id="s-bare", curation_id="s-bare", catalog_sequence=2, status="draft")
    )
    in_memory_db.curations.insert_one(
        active_curation(_id="s-unsequenced", curation_id="s-unsequenced", status="active")
    )

    response = await async_client.post(
        "/api/v3/catalog/curations/summaries",
        json={"curation_ids": ["s-bare", "absent-curation", "s-rich", "s-unsequenced", "s-bare"]},
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [item["curation_id"] for item in items] == ["s-bare", "s-rich"]

    listed = await async_client.get("/api/v3/catalog/curations?limit=10", headers=_headers())
    list_rows = {item["curation_id"]: item for item in listed.json()["items"]}
    assert {item["curation_id"]: item for item in items} == {
        "s-rich": list_rows["s-rich"],
        "s-bare": list_rows["s-bare"],
    }
    assert items[1]["concepts"] == ["Casual"]
    assert items[1]["image_count"] == 2
    assert items[1]["has_transcript"] is True
    assert items[1]["version"] == 4


@pytest.mark.asyncio
async def test_curation_summaries_bound_is_validated(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)

    over = await async_client.post(
        "/api/v3/catalog/curations/summaries",
        json={"curation_ids": [f"c{index}" for index in range(201)]},
        headers=_headers(),
    )
    assert over.status_code == 422

    empty = await async_client.post(
        "/api/v3/catalog/curations/summaries", json={"curation_ids": []}, headers=_headers()
    )
    assert empty.status_code == 422


def _health_fixtures() -> list[dict]:
    """One Curation per counter shape, plus a deleted one that must be ignored.

    The tombstone is unlinked, synthetic, image-less, transcript-less and not a
    member: if the non-deleted scope ever broke, several counters move.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    recent = now - timedelta(hours=2)
    stale = now - timedelta(days=10)
    rows = [
        active_curation(
            _id="h-linked",
            curation_id="h-linked",
            catalog_sequence=1,
            status="active",
            entity_id="ent-1",
            curator_type="human",
            updatedAt=recent,
            sources={"image": [{"url": "a"}], "audio": [{"url": "b"}]},
            transcript="captured",
        ),
        active_curation(
            _id="h-orphan-draft",
            curation_id="h-orphan-draft",
            catalog_sequence=2,
            status="draft",
            curator_type="synthetic",
            updatedAt=stale,
            transcript="",
        ),
        active_curation(
            _id="h-empty-entity",
            curation_id="h-empty-entity",
            catalog_sequence=3,
            status="active",
            entity_id="",
            curator_type="human",
            updatedAt=stale,
            sources={"image": [{"url": "a"}]},
            transcript="",
        ),
        active_curation(
            _id="h-blank-entity",
            curation_id="h-blank-entity",
            catalog_sequence=4,
            status="active",
            entity_id="   ",
            curator_type="human",
            updatedAt=recent,
            sources={"image": {"url": "single"}},
            transcript="present",
        ),
        active_curation(
            _id="h-deleted",
            curation_id="h-deleted",
            catalog_sequence=5,
            status="deleted",
            curator_type="synthetic",
            updatedAt=recent,
            transcript="",
        ),
    ]
    del rows[1]["entity_id"]  # the "no key at all" orphan shape
    del rows[4]["entity_id"]  # the tombstone is an orphan too
    return rows


@pytest.mark.asyncio
async def test_content_health_counts_every_card_and_skips_deleted_curations(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    for row in _health_fixtures():
        in_memory_db.curations.insert_one(row)

    response = await async_client.post(
        "/api/v3/catalog/content-health",
        json={"member_curation_ids": ["h-linked", "h-empty-entity", "h-linked"]},
        headers=_headers(),
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "total": 4,
        "unlinked": 3,
        "synthetic_drafts": 1,
        "without_images": 2,
        "without_transcript": 2,
        "updated_today": 2,
        "without_collections": 2,
    }


@pytest.mark.asyncio
async def test_unlinked_counter_matches_the_listing_it_links_to(async_client, in_memory_db):
    """The overview card links to the filtered list, so the number it shows and
    the rows behind that link come from the SAME predicate.

    The card counts the editorial set (non-deleted), which the deep link can
    scope exactly with the very condition machinery this boundary publishes —
    and the only row the two differ by is the tombstone.
    """
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)
    for row in _health_fixtures():
        in_memory_db.curations.insert_one(row)

    health = await async_client.post(
        "/api/v3/catalog/content-health", json={"member_curation_ids": []}, headers=_headers()
    )
    editorial = await async_client.get(
        "/api/v3/catalog/curations",
        params=[
            ("unlinked", "true"),
            ("where", json.dumps({"field": "status", "op": "not_equals", "value": "deleted"})),
        ],
        headers=_headers(),
    )
    unfiltered = await async_client.get("/api/v3/catalog/curations?unlinked=true", headers=_headers())

    assert health.status_code == 200 and editorial.status_code == 200 and unfiltered.status_code == 200
    editorial_ids = {item["curation_id"] for item in editorial.json()["items"]}
    assert len(editorial_ids) == health.json()["unlinked"] == 3
    assert editorial_ids == {"h-orphan-draft", "h-empty-entity", "h-blank-entity"}
    assert {item["curation_id"] for item in unfiltered.json()["items"]} - editorial_ids == {"h-deleted"}


@pytest.mark.asyncio
async def test_content_health_rejects_more_members_than_the_bound(async_client, in_memory_db):
    in_memory_db._collections.clear()
    _seed_cms_admin(in_memory_db)

    response = await async_client.post(
        "/api/v3/catalog/content-health",
        json={"member_curation_ids": [f"c{index}" for index in range(10001)]},
        headers=_headers(),
    )

    assert response.status_code == 413
    assert "10000" in response.json()["detail"]
