from datetime import datetime, timezone
import json

from app.api import distribution
from app.core.cms_database import get_cms_read_database
from app.core.database import get_database
from app.services.consumer_rate_limit import RateLimitResult
from tests.factories import active_curation, active_entity


class Cursor(list):
    def sort(self, key, _direction):
        return Cursor(sorted(self, key=lambda value: value.get(key, "")))

    def limit(self, amount):
        return Cursor(self[:amount])


class Collection:
    def __init__(self, documents):
        self.documents = documents

    def find_one(self, query):
        for document in self.documents:
            if all(document.get(key) == value for key, value in query.items()):
                return document
        return None

    def find(self, query, _projection=None):
        if "collectionId" in query:
            return Cursor([item for item in self.documents if item.get("collectionId") == query["collectionId"]])
        for key, value in query.items():
            if isinstance(value, dict) and "$in" in value:
                return Cursor([item for item in self.documents if item.get(key) in set(value["$in"])])
        clauses = query.get("$and", [])
        collection_id = next(value["collectionId"] for value in clauses if "collectionId" in value)
        after = next((value["curationId"]["$gt"] for value in clauses if "curationId" in value), None)
        return Cursor(
            [
                item
                for item in self.documents
                if item.get("collectionId") == collection_id and (after is None or item.get("curationId", "") > after)
            ]
        )


class Cms:
    def __init__(self):
        self.values = {
            "collections": Collection(
                [
                    {
                        "_id": "collection-1",
                        "slug": "sushi",
                        "lifecycle": "published",
                        "currentPublishedVersion": 2,
                        "publishedSelectedCount": 1,
                    }
                ]
            ),
            "collection_memberships": Collection(
                [{"collectionId": "collection-1", "curationId": "c1", "addedInVersion": 1, "removedInVersion": None}]
            ),
        }

    def collection(self, name):
        return self.values[name]


class Operational:
    def __init__(self):
        self.curations = Collection([active_curation(curation_id="c1", entity_id="e1")])
        self.entities = Collection([active_entity(entity_id="e1")])

    def __getitem__(self, _name):
        return object()


def test_distribution_page_uses_consumer_scope_and_returns_no_store(client, monkeypatch):
    cms = Cms()
    operational = Operational()
    client.app.dependency_overrides[get_cms_read_database] = lambda: cms
    client.app.dependency_overrides[get_database] = lambda: operational
    monkeypatch.setattr(
        distribution,
        "_consumer",
        lambda _authorization, _db: type(
            "P",
            (),
            {
                "application_id": "app-1",
                "credential_id": "cred-1",
                "requests_per_minute": 60,
                "allowed_collection_ids": frozenset({"collection-1"}),
            },
        )(),
    )
    monkeypatch.setattr(
        distribution.ConsumerRateLimitService,
        "consume",
        lambda *_args: RateLimitResult(True, 200, {"X-RateLimit-Limit": "60"}),
    )

    response = client.get("/api/v3/distribution/collections/sushi", headers={"Authorization": "Bearer cck_test"})

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.json()["collection"] == {"slug": "sushi", "version": 2, "selected_count": 1}
    assert response.json()["items"][0]["curation"]["id"] == "c1"


def test_distribution_dump_streams_manifest_items_and_footer(client, monkeypatch):
    cms = Cms()
    operational = Operational()
    client.app.dependency_overrides[get_cms_read_database] = lambda: cms
    client.app.dependency_overrides[get_database] = lambda: operational
    monkeypatch.setattr(
        distribution,
        "_consumer",
        lambda _authorization, _db: type(
            "P",
            (),
            {
                "application_id": "app-1",
                "credential_id": "cred-1",
                "requests_per_minute": 60,
                "allowed_collection_ids": frozenset({"collection-1"}),
            },
        )(),
    )
    monkeypatch.setattr(
        distribution.ConsumerRateLimitService,
        "consume",
        lambda *_args: RateLimitResult(True, 200, {"X-RateLimit-Limit": "60"}),
    )

    response = client.get("/api/v3/distribution/collections/sushi/dump")
    records = [json.loads(line) for line in response.content.splitlines()]

    assert response.status_code == 200
    assert [record["record_type"] for record in records] == ["manifest", "item", "footer"]
    assert records[-1]["available_count"] == 1
