"""Semantic truth: Entity facts are canonical; Curation city/type are projections."""

from datetime import datetime, timezone

import pytest


@pytest.mark.mongo
def test_entity_patch_refreshes_linked_curation_city_and_type(client, test_db, auth_headers):
    entity_id = "semantic_projection_entity"
    curation_id = "semantic_projection_curation"
    now = datetime.now(timezone.utc)

    test_db.entities.insert_one(
        {
            "_id": entity_id,
            "entity_id": entity_id,
            "name": "Projection Place",
            "type": "restaurant",
            "status": "active",
            "data": {"location": {"city": "Victoria"}},
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
    )
    test_db.curations.insert_one(
        {
            "_id": curation_id,
            "curation_id": curation_id,
            "entity_id": entity_id,
            "restaurant_name": "Captured Projection Place",
            "status": "draft",
            "city": "Victoria",
            "type": "restaurant",
            "categories": {},
            "sources": {"manual": [{}]},
            "curator_id": "test_curator",
            "curator": {"id": "test_curator", "name": "Test"},
            "curator_type": "human",
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
    )

    try:
        response = client.patch(
            f"/api/v3/entities/{entity_id}",
            json={
                "type": "bar",
                "data": {"location": {"city": "Vancouver"}},
            },
            headers={**auth_headers, "If-Match": "1"},
        )
        assert response.status_code == 200, response.text

        stored = test_db.curations.find_one({"_id": curation_id})
        assert stored["city"] == "Vancouver"
        assert stored["type"] == "bar"
        # Working-name provenance is unrelated to canonical Entity identity.
        assert stored["restaurant_name"] == "Captured Projection Place"
    finally:
        test_db.curations.delete_one({"_id": curation_id})
        test_db.entities.delete_one({"_id": entity_id})


@pytest.mark.mongo
def test_entity_patch_refreshes_curations_linked_by_entity_slug_or_object_identity(client, test_db, auth_headers):
    """Fanout must use all accepted Entity identity variants, not only one shape."""
    entity_id = "semantic_projection_slug"
    curation_id = "semantic_projection_slug_curation"
    now = datetime.now(timezone.utc)

    test_db.entities.insert_one(
        {
            "_id": entity_id,
            "entity_id": entity_id,
            "name": "Slug Projection",
            "type": "cafe",
            "status": "active",
            "data": {"location": {"city": "Victoria"}},
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
    )
    test_db.curations.insert_one(
        {
            "_id": curation_id,
            "curation_id": curation_id,
            "entity_id": entity_id,
            "restaurant_name": "Slug Projection",
            "status": "draft",
            "city": "Victoria",
            "type": "cafe",
            "categories": {},
            "sources": {"manual": [{}]},
            "curator_id": "test_curator",
            "curator": {"id": "test_curator", "name": "Test"},
            "curator_type": "human",
            "createdAt": now,
            "updatedAt": now,
            "version": 1,
        }
    )

    try:
        response = client.patch(
            f"/api/v3/entities/{entity_id}",
            json={"data": {"location": {"city": "Nanaimo"}}},
            headers={**auth_headers, "If-Match": "1"},
        )
        assert response.status_code == 200, response.text
        assert test_db.curations.find_one({"_id": curation_id})["city"] == "Nanaimo"
    finally:
        test_db.curations.delete_one({"_id": curation_id})
        test_db.entities.delete_one({"_id": entity_id})
