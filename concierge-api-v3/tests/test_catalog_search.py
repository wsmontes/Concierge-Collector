"""Allowlisted, cursor-paginated search for the CMS Curation Explorer."""

import pytest

from app.core.config import settings
from tests.factories import active_curation


def _headers() -> dict[str, str]:
    return {"X-CMS-Service-Key": settings.cms_service_key_value, "X-CMS-Actor-Id": "cms-admin-test"}


@pytest.mark.asyncio
async def test_search_is_allowlisted_and_uses_a_cursor_bound_to_filters(async_client, in_memory_db, monkeypatch):
    in_memory_db._collections.clear()
    monkeypatch.setattr(settings, "catalog_cursor_secret", "catalog-test-secret")
    in_memory_db.users.insert_one(
        {"_id": "cms-admin-test", "email": "cms-admin-test@example.com", "authorized": True, "role": "admin"}
    )
    first = active_curation(curation_id="c1", catalog_sequence=1, restaurant_name="Sushi Jun", status="active")
    first["transcript"] = "private transcript"
    first["embeddings"] = [{"vector": [1, 2, 3]}]
    in_memory_db.curations.insert_one(first)
    in_memory_db.curations.insert_one(
        active_curation(curation_id="c2", catalog_sequence=2, restaurant_name="Sushi Zen", status="active")
    )
    in_memory_db.curations.insert_one(
        active_curation(curation_id="c3", catalog_sequence=3, restaurant_name="Pizza House", status="active")
    )

    page_one = await async_client.get("/api/v3/catalog/curations?q=sushi&limit=1", headers=_headers())
    assert page_one.status_code == 200
    assert [item["curation_id"] for item in page_one.json()["items"]] == ["c1"]
    assert "transcript" not in page_one.json()["items"][0]
    assert "embeddings" not in page_one.json()["items"][0]

    page_two = await async_client.get(
        f"/api/v3/catalog/curations?q=sushi&cursor={page_one.json()['next_cursor']}", headers=_headers()
    )
    assert [item["curation_id"] for item in page_two.json()["items"]] == ["c2"]
    mismatch = await async_client.get(
        f"/api/v3/catalog/curations?q=pizza&cursor={page_one.json()['next_cursor']}", headers=_headers()
    )
    assert mismatch.status_code == 409
