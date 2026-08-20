"""Shared fixtures and helpers for consumer distribution tests.

``operational_db`` and everything depending on it are opt-in Mongo aliases
(mirroring the existing ``test_db`` convention); hermetic in-memory coverage
lives in the test modules themselves. ``active_curation``/``active_entity``
are imported from ``tests.factories`` — never redefined here.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal

import pytest

from app.core.cms_database import CmsReadOnlyDatabase, get_cms_read_database
from app.core.database import get_database
from app.models.distribution_api import PublicCurationItemV1
from app.services.consumer_auth_service import ConsumerPrincipal
from app.services.consumer_rate_limit import ConsumerRateLimitService
from app.services.distribution_cursor import encode_cursor
from app.services.distribution_dump import encode_record
from app.services.distribution_service import DistributionDependencyError, HydrationBatch
from tests.factories import active_curation, active_entity

# Fixed instant used by every time-sensitive distribution assertion.
MINUTE = datetime(2026, 8, 18, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def operational_db(test_db):
    """Hermetic alias of the operational test database (opt-in --run-mongo)."""
    return test_db


class ConsumerPrincipalFactory:
    """Principal factory with defaults and explicit overrides."""

    def __call__(
        self,
        *,
        allowed_collection_ids: list[str] | None = None,
        credential_id: str = "cred-1",
        application_id: str = "app-1",
    ) -> ConsumerPrincipal:
        return ConsumerPrincipal(
            credential_id=credential_id,
            application_id=application_id,
            allowed_collection_ids=frozenset(allowed_collection_ids or []),
            requests_per_minute=60,
        )


@pytest.fixture
def consumer_principal() -> ConsumerPrincipalFactory:
    return ConsumerPrincipalFactory()


@pytest.fixture
def consumer_headers(seeded_consumer_credential) -> dict[str, str]:
    """Bearer headers of the seeded consumer credential."""
    return {"Authorization": f"Bearer {seeded_consumer_credential.raw}"}


@pytest.fixture
def rate_limit_service(operational_db) -> ConsumerRateLimitService:
    """Real fixed-window quota service over the operational test database."""
    return ConsumerRateLimitService(operational_db)


def verify_logical_sha(records: list[dict]) -> bool:
    """Recalculate the canonical dump digest over item records and compare it
    with the footer's ``sha256`` — the definition of a complete dump."""
    digest = hashlib.sha256()
    for record in records:
        if record.get("record_type") == "item":
            digest.update(encode_record({"record_type": "item", "item": record["item"]}))
    return (
        bool(records) and records[-1].get("record_type") == "footer" and records[-1].get("sha256") == digest.hexdigest()
    )


def consume_partial_stream(client, headers: dict[str, str]) -> list[dict]:
    """Consume valid NDJSON chunks until the simulated failure ends the stream."""
    records: list[dict] = []
    with client.stream("GET", "/api/v3/distribution/collections/sushi/dump", headers=headers) as stream:
        for line in stream.iter_lines():
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                break
    return records


@pytest.fixture
def fail_on_second_batch():
    """Stateful callable: the first batch is valid, the second raises
    ``DistributionDependencyError`` — the stream must then end without footer."""

    def _first_valid_batch(_db: Any, curation_ids: list[str]) -> HydrationBatch:
        return HydrationBatch(
            items=[
                PublicCurationItemV1.from_documents(active_curation(curation_id=cid), active_entity())
                for cid in curation_ids
            ],
            unavailable=[],
        )

    calls = {"count": 0}

    def fail_on_second_batch(db: Any, curation_ids: list[str]) -> HydrationBatch:
        calls["count"] += 1
        if calls["count"] > 1:
            raise DistributionDependencyError("simulated live source failure")
        return _first_valid_batch(db, curation_ids)

    return fail_on_second_batch


class DistributionClient:
    """Seeds the matching CMS/operational records through the privileged
    fixtures, then drives HTTP requests through the TestClient with the
    seeded consumer credential."""

    def __init__(self, http_client, cms_writer, cms_db, operational_db, seeded_consumer_credential):
        self._client = http_client
        self._cms_writer = cms_writer
        self._cms = cms_db
        self._operational = operational_db
        self._seed = seeded_consumer_credential

    def get(self, path: str, *, headers: dict[str, str] | None = None):
        return self._client.get(
            f"/api/v3/distribution{path}",
            headers={"Authorization": f"Bearer {self._seed.raw}", **(headers or {})},
        )

    def _seed_collection(self, **overrides) -> str:
        collection = {
            "_id": "collection-a",
            "slug": "sushi",
            "lifecycle": "published",
            "currentPublishedVersion": 1,
            "publishedSelectedCount": 1,
        }
        collection.update(overrides)
        self._cms_writer.collections.insert_one(collection)
        collection_id = str(collection["_id"])
        self._cms_writer.collection_versions.insert_one(
            {"collectionId": collection_id, "version": 1, "status": "published", "selectedCount": 1}
        )
        self._cms_writer.collection_memberships.insert_one(
            {"collectionId": collection_id, "curationId": "c1", "addedInVersion": 1, "removedInVersion": None}
        )
        self._operational.curations.insert_one(active_curation(curation_id="c1", entity_id="e1"))
        self._operational.entities.insert_one(active_entity(entity_id="e1"))
        return collection_id

    def request_case(
        self,
        case: Literal["missing_key", "bad_key", "out_of_scope", "missing_slug", "archived", "foreign_cursor"],
    ):
        if case == "missing_key":
            return self._client.get("/api/v3/distribution/collections/sushi")
        if case == "bad_key":
            return self._client.get(
                "/api/v3/distribution/collections/sushi",
                headers={"Authorization": "Bearer cck_bbbbbbbbbbbb_NotARealSecret"},
            )
        if case == "out_of_scope":
            # The seeded credential allows only collection-a; this sushi
            # belongs to collection-b, so it is indistinguishable from missing.
            self._seed_collection(_id="collection-b")
            return self.get("/collections/sushi")
        if case == "missing_slug":
            return self.get("/collections/nope")
        if case == "archived":
            self._seed_collection(lifecycle="archived")
            return self.get("/collections/sushi")
        if case == "foreign_cursor":
            # A cursor signed with a different context/secret must be rejected.
            foreign = encode_cursor({"purpose": "consumer-usage", "lastId": "x"}, "wrong-secret")
            return self.get("/collections/sushi", headers={"cursor": foreign})
        raise ValueError(f"unknown case {case!r}")


@pytest.fixture
def distribution_client(client, cms_writer, operational_db, seeded_consumer_credential) -> DistributionClient:
    """TestClient bound to the seeded CMS projection and the operational test
    database; restores every dependency override afterwards."""
    cms_db = CmsReadOnlyDatabase(cms_writer)
    previous_db = client.app.dependency_overrides.get(get_database)
    previous_cms = client.app.dependency_overrides.get(get_cms_read_database)
    client.app.dependency_overrides[get_database] = lambda: operational_db
    client.app.dependency_overrides[get_cms_read_database] = lambda: cms_db
    try:
        yield DistributionClient(client, cms_writer, cms_db, operational_db, seeded_consumer_credential)
    finally:
        if previous_db is None:
            client.app.dependency_overrides.pop(get_database, None)
        else:
            client.app.dependency_overrides[get_database] = previous_db
        if previous_cms is None:
            client.app.dependency_overrides.pop(get_cms_read_database, None)
        else:
            client.app.dependency_overrides[get_cms_read_database] = previous_cms
