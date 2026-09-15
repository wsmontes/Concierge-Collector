"""Security and high-water tests for the internal CMS catalog scan."""

from datetime import datetime, timezone
import json

import pytest

from app.core.config import settings
from tests.factories import active_curation


def _headers() -> dict[str, str]:
    return {
        "X-CMS-Service-Key": settings.cms_service_key_value,
        "X-CMS-Actor-Id": "cms-admin-test",
    }


def _seed_admin(database) -> None:
    database.users.insert_one(
        {
            "_id": "cms-admin-test",
            "email": "cms-admin-test@example.com",
            "authorized": True,
            "role": "admin",
        }
    )


@pytest.mark.asyncio
async def test_scan_excludes_rows_created_above_its_high_water(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", "catalog-test-secret")
    _seed_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(curation_id="z-last", catalog_sequence=10))
    in_memory_db.curations.insert_one(active_curation(curation_id="zz-end", catalog_sequence=20))

    started = await async_client.post("/api/v3/catalog/curations/scan/start", headers=_headers(), json={"filters": {}})
    assert started.status_code == 200
    token = started.json()["scan_token"]
    assert started.json()["max_catalog_sequence"] == 20

    first = await async_client.post(
        "/api/v3/catalog/curations/scan/page",
        headers=_headers(),
        json={"scan_token": token, "limit": 1},
    )
    assert first.status_code == 200
    in_memory_db.curations.insert_one(active_curation(curation_id="a-new", catalog_sequence=21))
    second = await async_client.post(
        "/api/v3/catalog/curations/scan/page",
        headers=_headers(),
        json={"scan_token": token, "cursor": first.json()["next_cursor"], "limit": 50},
    )
    assert second.status_code == 200
    assert "a-new" not in [item["curation_id"] for item in second.json()["items"]]


@pytest.mark.asyncio
async def test_scan_page_rechecks_the_live_admin_role(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", "catalog-test-secret")
    _seed_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(curation_id="c1", catalog_sequence=1))
    started = await async_client.post("/api/v3/catalog/curations/scan/start", headers=_headers(), json={"filters": {}})
    in_memory_db.users.update_one({"_id": "cms-admin-test"}, {"$set": {"role": "curator"}})

    page = await async_client.post(
        "/api/v3/catalog/curations/scan/page",
        headers=_headers(),
        json={"scan_token": started.json()["scan_token"], "limit": 1},
    )
    assert page.status_code == 403
    in_memory_db.users.update_one({"_id": "cms-admin-test"}, {"$set": {"role": "admin"}})


@pytest.mark.asyncio
async def test_scan_materializes_in_the_requested_sort_and_keeps_the_row_contract(
    async_client, in_memory_db, monkeypatch
):
    """A bulk selection is materialized in the same order the list showed, and
    every row carries the same derived columns (one row builder, no fork)."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", "catalog-test-secret")
    _seed_admin(in_memory_db)
    in_memory_db.curations.insert_one(
        active_curation(
            _id="older",
            curation_id="older",
            catalog_sequence=1,
            status="active",
            updatedAt=datetime(2026, 9, 1, tzinfo=timezone.utc),
            categories={"Mood": ["Casual"]},
            sources={"image": [{"url": "a"}]},
            transcript="captured",
        )
    )
    in_memory_db.curations.insert_one(
        active_curation(
            _id="newer",
            curation_id="newer",
            catalog_sequence=2,
            status="active",
            updatedAt=datetime(2026, 9, 9, tzinfo=timezone.utc),
            categories={"Mood": ["Casual", "Business"]},
            sources={"audio": [{"url": "b"}]},
            transcript="",
        )
    )

    started = await async_client.post(
        "/api/v3/catalog/curations/scan/start",
        headers=_headers(),
        json={"filters": {"sort": "updated_at_desc"}},
    )
    assert started.status_code == 200, started.text
    token = started.json()["scan_token"]

    first = await async_client.post(
        "/api/v3/catalog/curations/scan/page", headers=_headers(), json={"scan_token": token, "limit": 1}
    )
    assert first.status_code == 200, first.text
    assert [item["curation_id"] for item in first.json()["items"]] == ["newer"]
    newest = first.json()["items"][0]
    assert newest["concepts"] == ["Casual", "Business"]
    assert newest["source_count"] == 1
    assert newest["audio_count"] == 1
    assert newest["image_count"] is None
    assert newest["has_transcript"] is False

    second = await async_client.post(
        "/api/v3/catalog/curations/scan/page",
        headers=_headers(),
        json={"scan_token": token, "cursor": first.json()["next_cursor"], "limit": 50},
    )
    assert second.status_code == 200, second.text
    assert [item["curation_id"] for item in second.json()["items"]] == ["older"]
    assert second.json()["items"][0]["has_transcript"] is True
    assert second.json()["items"][0]["image_count"] == 1


# ── Materialized selections carry the same conditions as the list ────────────


def _filter_rows() -> list[dict]:
    return [
        active_curation(
            _id="s-open",
            curation_id="s-open",
            catalog_sequence=1,
            status="active",
            restaurant_name="Alpha Grill",
            city="Lisbon",
            entity_id="ent-1",
            updatedAt=datetime(2026, 9, 1),
            transcript="captured",
        ),
        active_curation(
            _id="s-orphan",
            curation_id="s-orphan",
            catalog_sequence=2,
            status="active",
            restaurant_name="Beta Diner",
            city="Lisbon",
            entity_id="",
            updatedAt=datetime(2026, 9, 10),
            transcript="",
        ),
        active_curation(
            _id="s-other",
            curation_id="s-other",
            catalog_sequence=3,
            status="active",
            restaurant_name="Gamma Bistro",
            city="Porto",
            entity_id="ent-2",
            updatedAt=datetime(2026, 9, 20),
        ),
    ]


_FILTER_CASES = (
    ({"where": [{"field": "city", "op": "equals", "value": "Lisbon"}]}, {"s-open", "s-orphan"}),
    ({"where": [{"field": "transcript", "op": "is_empty"}]}, {"s-orphan", "s-other"}),
    ({"where": [{"field": "restaurant_name", "op": "contains", "value": "grill"}]}, {"s-open"}),
    ({"unlinked": True}, {"s-orphan"}),
    ({"unlinked": False}, {"s-open", "s-other"}),
    (
        {
            "where": [{"field": "updatedAt", "op": "after", "value": "2026-09-05T00:00:00Z"}],
            "unlinked": True,
        },
        {"s-orphan"},
    ),
)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "filters,expected",
    _FILTER_CASES,
    ids=["where-equals", "where-is_empty", "where-contains", "unlinked-true", "unlinked-false", "where-and-unlinked"],
)
async def test_scan_applies_the_same_conditions_as_the_list(filters, expected, async_client, in_memory_db, monkeypatch):
    """A materialized selection must be the listing: same ids, same predicate."""
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", "catalog-test-secret")
    _seed_admin(in_memory_db)
    for row in _filter_rows():
        in_memory_db.curations.insert_one(row)

    params: list[tuple[str, str]] = [("where", json.dumps(condition)) for condition in filters.get("where", [])]
    if "unlinked" in filters:
        params.append(("unlinked", "true" if filters["unlinked"] else "false"))

    listed = await async_client.get("/api/v3/catalog/curations", params=params, headers=_headers())
    assert listed.status_code == 200, listed.text
    started = await async_client.post(
        "/api/v3/catalog/curations/scan/start", headers=_headers(), json={"filters": filters}
    )
    assert started.status_code == 200, started.text
    scanned = await async_client.post(
        "/api/v3/catalog/curations/scan/page",
        headers=_headers(),
        json={"scan_token": started.json()["scan_token"], "limit": 100},
    )
    assert scanned.status_code == 200, scanned.text

    listed_ids = {item["curation_id"] for item in listed.json()["items"]}
    scanned_ids = {item["curation_id"] for item in scanned.json()["items"]}
    assert listed_ids == scanned_ids == expected


@pytest.mark.asyncio
async def test_scan_start_refuses_an_unaddressable_condition(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", "catalog-test-secret")
    _seed_admin(in_memory_db)

    response = await async_client.post(
        "/api/v3/catalog/curations/scan/start",
        headers=_headers(),
        json={"filters": {"where": [{"field": "sources.a.b.c.d", "op": "exists"}]}},
    )

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail[0]["loc"] == ["body", "filters", "where", 0, "field"]
    assert "sources.a.b.c.d" in detail[0]["msg"]
