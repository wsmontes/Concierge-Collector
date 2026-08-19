from datetime import datetime, timezone
import json

from app.api import distribution
from app.core.cms_database import get_cms_read_database
from app.core.database import get_database
from app.services.consumer_rate_limit import RateLimitResult
from tests.factories import active_curation, active_entity


class Cursor(list):
    def sort(self, key, direction):
        return Cursor(sorted(self, key=lambda value: value.get(key, ""), reverse=direction < 0))

    def limit(self, amount):
        return Cursor(self[:amount])


class Collection:
    def __init__(self, documents):
        self.documents = documents

    def find_one(self, query):
        for document in self.documents:
            if self._matches(document, query):
                return document
        return None

    def find(self, query, _projection=None):
        return Cursor([item for item in self.documents if self._matches(item, query)])

    @staticmethod
    def _matches(document, query):
        for key, value in query.items():
            if key == "$and":
                if not all(Collection._matches(document, clause) for clause in value):
                    return False
                continue
            if key == "$or":
                if not any(Collection._matches(document, clause) for clause in value):
                    return False
                continue
            actual = document.get(key)
            if isinstance(value, dict):
                if "$in" in value and actual not in set(value["$in"]):
                    return False
                if "$lt" in value and not (actual < value["$lt"]):
                    return False
                if "$lte" in value and not (actual <= value["$lte"]):
                    return False
                if "$gt" in value and not (actual > value["$gt"]):
                    return False
                continue
            if actual != value:
                return False
        return True


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
            "collection_versions": Collection(
                [
                    {"collectionId": "collection-1", "version": 2, "status": "published", "selectedCount": 1},
                    {"collectionId": "collection-1", "version": 1, "status": "published", "selectedCount": 1},
                ]
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


def test_exact_version_keeps_membership_but_hydrates_live_content(client, monkeypatch):
    cms = Cms()
    operational = Operational()
    operational.curations.documents[0]["notes"] = {"public": "Before"}
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

    before = client.get("/api/v3/distribution/collections/sushi/versions/1").json()
    operational.curations.documents[0]["notes"]["public"] = "After"
    after = client.get("/api/v3/distribution/collections/sushi/versions/1").json()

    assert before["collection"]["version"] == after["collection"]["version"] == 1
    assert before["items"][0]["curation"]["description"] == "Before"
    assert after["items"][0]["curation"]["description"] == "After"


def test_version_history_uses_a_distinct_cursor_context(client, monkeypatch):
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

    first = client.get("/api/v3/distribution/collections/sushi/versions?limit=1")
    assert first.status_code == 200
    assert [item["version"] for item in first.json()["versions"]] == [2]
    second = client.get(f"/api/v3/distribution/collections/sushi/versions?cursor={first.json()['next_cursor']}")
    assert second.status_code == 200
    assert [item["version"] for item in second.json()["versions"]] == [1]

    item_cursor = client.get("/api/v3/distribution/collections/sushi?limit=1").json()["next_cursor"]
    assert client.get(f"/api/v3/distribution/collections/sushi/versions?cursor={item_cursor}").status_code == 409


def test_exact_version_dump_uses_the_path_version(client, monkeypatch):
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

    response = client.get("/api/v3/distribution/collections/sushi/versions/1/dump")
    records = [json.loads(line) for line in response.content.splitlines()]
    assert response.status_code == 200
    assert records[0]["collection"] == {"slug": "sushi", "version": 1}
