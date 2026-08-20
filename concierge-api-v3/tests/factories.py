"""Small deterministic database records used by CMS boundary tests."""

from copy import deepcopy

_ACTIVE_CURATION = {
    "_id": "curation-test-id",
    "curation_id": "curation-test-id",
    "entity_id": "entity-test-id",
    "curator_id": "curator-test-id",
    "curator": {"id": "curator-test-id", "name": "Test Curator"},
    "restaurant_name": "Test Place",
    "status": "active",
    "version": 1,
    "createdAt": "2026-08-18T00:00:00Z",
    "updatedAt": "2026-08-18T00:00:00Z",
}

_ACTIVE_ENTITY = {
    "_id": "entity-test-id",
    "entity_id": "entity-test-id",
    "name": "Test Place",
    "type": "restaurant",
    "status": "active",
    "version": 1,
    "createdAt": "2026-08-18T00:00:00Z",
    "updatedAt": "2026-08-18T00:00:00Z",
}


def active_curation(**overrides):
    record = deepcopy(_ACTIVE_CURATION)
    record.update(overrides)
    record.setdefault("_id", record["curation_id"])
    return record


def active_entity(**overrides):
    record = deepcopy(_ACTIVE_ENTITY)
    record.update(overrides)
    record.setdefault("_id", record["entity_id"])
    return record


def seed_curations(db, rows):
    """Insert exactly the requested ``(catalog_sequence, curation_id)`` pairs.

    Used by the catalog_sequence tests to simulate documents already
    backfilled with a server sequence: the high-water of ``catalog_sequence``
    must seed subsequent reservations. Every row gets an eligible status
    ("active") so the sequence allocator treats it as a real Curation; only
    the provided pairs are inserted, nothing else is created.
    """
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    for sequence, curation_id in rows:
        db.curations.insert_one(
            {
                "_id": curation_id,
                "curation_id": curation_id,
                "catalog_sequence": int(sequence),
                "restaurant_name": "Seed Place",
                "curator_id": "test_catalog_curator",
                "curator": {"id": "test_catalog_curator", "name": "Test Catalog Curator"},
                "status": "active",
                "categories": {},
                "createdAt": now,
                "updatedAt": now,
                "version": 1,
            }
        )


def write_curation_through(writer, client, auth_headers, payload=None):
    """Write a curation through one of the three real write frontiers and
    return the persisted document (re-read via GET).

    ``writer`` must be one of "create", "bulk" or "capture". ``payload`` is
    the request body for the create/bulk frontiers; for capture it provides
    the ``entity_id`` the confirm request links (the capture session itself is
    seeded into the same in-memory database the ``client`` fixture serves —
    the real POST /capture would require OpenAI transcription). A client-side
    ``catalog_sequence`` in the payload must be ignored by the server.
    """
    from datetime import datetime, timezone
    from uuid import uuid4

    from app.core.database import get_database

    if writer not in ("create", "bulk", "capture"):
        raise ValueError(f"unknown writer {writer!r}; expected 'create', 'bulk' or 'capture'")

    curator_id = "test_catalog_curator"
    default_payload = {
        "curation_id": f"test_catalog_{uuid4().hex[:12]}",
        "curator_id": curator_id,
        "curator": {"id": curator_id, "name": "Test Catalog Curator"},
        "restaurant_name": "Test Catalog Place",
    }

    if writer == "capture":
        db = get_database()
        entity_id = (payload or {}).get("entity_id") or f"ent_{uuid4().hex[:12]}"
        capture_id = f"tc_{uuid4().hex[:13]}"
        db["capture_sessions"].insert_one(
            {
                "_id": capture_id,
                "capture_id": capture_id,
                "curator_id": curator_id,
                "curator": {"id": curator_id, "name": curator_id},
                "transcription": "Transcription for the catalog sequence writer test",
                "restaurant_name": "Test Catalog Place",
                "entities": [
                    {
                        "entity_id": entity_id,
                        "name": "Test Catalog Place",
                        "type": "restaurant",
                        "score": 1.0,
                        "source": "mongo",
                    }
                ],
                "concepts": {},
                "status": "pending_confirmation",
                "createdAt": datetime.now(timezone.utc),
            }
        )
        response = client.post(
            f"/api/v3/capture/{capture_id}/confirm",
            json={"entity_id": entity_id, "idempotency_key": f"ic_{uuid4().hex}"},
            headers=auth_headers,
        )
        assert response.status_code == 200, response.text
        curation_id = response.json()["curation_id"]
    elif writer == "create":
        body = default_payload if payload is None else payload
        response = client.post("/api/v3/curations", json=body, headers=auth_headers)
        assert response.status_code == 201, response.text
        curation_id = response.json()["curation_id"]
    else:  # bulk
        item = default_payload if payload is None else payload
        response = client.post("/api/v3/curations/bulk", json={"curations": [item]}, headers=auth_headers)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["errors"] == [], result
        assert result["created"] == 1, result
        curation_id = item["curation_id"]

    persisted = client.get(f"/api/v3/curations/{curation_id}", headers=auth_headers)
    assert persisted.status_code == 200, persisted.text
    return persisted.json()
