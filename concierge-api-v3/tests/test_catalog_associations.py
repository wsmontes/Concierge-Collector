"""Published Collection association boundary stays small and archive-safe."""

from app.core.security import create_access_token


def _bearer(subject: str, role: str = "viewer") -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': subject, 'role': role})}"}


def test_associations_return_only_published_minimum(client, in_memory_db):
    in_memory_db.curations.delete_many({})
    in_memory_db.collections.delete_many({})
    in_memory_db.collection_memberships.delete_many({})
    in_memory_db.curations.insert_one({"curation_id": "c1"})
    in_memory_db.collections.insert_one(
        {
            "_id": "collection-1",
            "slug": "visible",
            "title": "Visible",
            "lifecycle": "published",
            "currentPublishedVersion": 2,
        }
    )
    in_memory_db.collections.insert_one(
        {
            "_id": "collection-2",
            "slug": "hidden",
            "title": "Hidden",
            "lifecycle": "archived",
            "currentPublishedVersion": 2,
        }
    )
    in_memory_db.collection_memberships.insert_one(
        {"collectionId": "collection-1", "curationId": "c1", "addedInVersion": 1, "removedInVersion": None}
    )
    in_memory_db.collection_memberships.insert_one(
        {"collectionId": "collection-2", "curationId": "c1", "addedInVersion": 1, "removedInVersion": None}
    )

    response = client.get("/api/v3/curations/c1/collections", headers=_bearer("viewer@example.test"))

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json() == {
        "items": [
            {"collection_id": "collection-1", "slug": "visible", "title": "Visible", "current_published_version": 2}
        ]
    }


def test_associations_require_an_interactive_session(client, in_memory_db):
    in_memory_db.curations.delete_many({})
    in_memory_db.curations.insert_one({"curation_id": "c1"})

    assert client.get("/api/v3/curations/c1/collections").status_code == 401
