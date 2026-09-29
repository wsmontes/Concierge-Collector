"""Security and high-water tests for the internal CMS catalog scan."""

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
