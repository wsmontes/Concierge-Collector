"""Regression coverage for bounded Collection membership pagination."""

import pytest

from app.api import distribution
from app.core.cms_database import get_cms_read_database
from app.core.database import get_database
from app.services.consumer_rate_limit import RateLimitResult
from tests.factories import active_curation, active_entity
from tests.test_distribution_api import Cms, Collection, Operational


@pytest.fixture(autouse=True)
def _restore_db_overrides(client):
    sentinel = object()
    previous_db = client.app.dependency_overrides.get(get_database, sentinel)
    previous_cms = client.app.dependency_overrides.get(get_cms_read_database, sentinel)
    yield
    if previous_db is sentinel:
        client.app.dependency_overrides.pop(get_database, None)
    else:
        client.app.dependency_overrides[get_database] = previous_db
    if previous_cms is sentinel:
        client.app.dependency_overrides.pop(get_cms_read_database, None)
    else:
        client.app.dependency_overrides[get_cms_read_database] = previous_cms


def _principal():
    return type(
        "P",
        (),
        {
            "application_id": "app-1",
            "credential_id": "cred-1",
            "requests_per_minute": 60,
            "allowed_collection_ids": frozenset({"collection-1"}),
        },
    )()


def _four_memberships_with_only_last_available():
    cms = Cms()
    cms.values["collections"].documents[0]["publishedSelectedCount"] = 4
    cms.values["collection_versions"].documents[0]["selectedCount"] = 4
    cms.values["collection_versions"].documents[1]["selectedCount"] = 4
    cms.values["collection_memberships"] = Collection(
        [
            {"collectionId": "collection-1", "curationId": curation_id, "addedInVersion": 1, "removedInVersion": None}
            for curation_id in ("c1", "c2", "c3", "c4")
        ]
    )
    operational = Operational()
    operational.curations = Collection([active_curation(curation_id="c4", entity_id="e4")])
    operational.entities = Collection([active_entity(entity_id="e4")])
    return cms, operational


def _install(client, monkeypatch, cms, operational):
    client.app.dependency_overrides[get_cms_read_database] = lambda: cms
    client.app.dependency_overrides[get_database] = lambda: operational
    monkeypatch.setattr(distribution, "_consumer", lambda _authorization, _db: _principal())
    monkeypatch.setattr(
        distribution.ConsumerRateLimitService,
        "consume",
        lambda *_args: RateLimitResult(True, 200, {"X-RateLimit-Limit": "60"}),
    )


@pytest.mark.parametrize(
    "path",
    [
        "/api/v3/distribution/collections/sushi",
        "/api/v3/distribution/collections/sushi/versions/1",
    ],
)
def test_page_limit_bounds_memberships_even_when_items_are_unavailable(client, monkeypatch, path):
    cms, operational = _four_memberships_with_only_last_available()
    _install(client, monkeypatch, cms, operational)

    first = client.get(f"{path}?limit=2", headers={"Authorization": "Bearer cck_test"})
    assert first.status_code == 200
    first_body = first.json()

    # Page capacity is membership-based: unavailable entries consume the same
    # bounded slot as hydrated items instead of causing an unbounded scan.
    assert first_body["items"] == []
    assert [entry["curation_id"] for entry in first_body["unavailable"]] == ["c1", "c2"]
    assert first_body["available_count"] + first_body["unavailable_count"] == 2
    assert first_body["next_cursor"]

    second = client.get(
        f"{path}?limit=2&cursor={first_body['next_cursor']}",
        headers={"Authorization": "Bearer cck_test"},
    )
    assert second.status_code == 200
    second_body = second.json()
    assert [entry["curation_id"] for entry in second_body["unavailable"]] == ["c3"]
    assert [entry["curation"]["id"] for entry in second_body["items"]] == ["c4"]
    assert second_body["available_count"] + second_body["unavailable_count"] == 2
    assert second_body["next_cursor"] is None
