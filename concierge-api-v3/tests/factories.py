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
