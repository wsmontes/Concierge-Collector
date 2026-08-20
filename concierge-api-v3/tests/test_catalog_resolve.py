"""Contract tests for the bounded CMS catalog resolution endpoint."""

import pytest

from app.core.config import settings
from tests.factories import active_curation


def _service_headers(actor_id="cms-admin-test"):
    return {
        "X-CMS-Service-Key": settings.cms_service_key_value,
        "X-CMS-Actor-Id": actor_id,
    }


def _seed_admin(test_db):
    test_db.users.insert_one(
        {
            "_id": "cms-admin-test",
            "email": "cms-admin-test@example.com",
            "name": "CMS Admin",
            "authorized": True,
            "role": "admin",
        }
    )


@pytest.mark.asyncio
async def test_resolve_accepts_selectable_statuses_and_rejects_archived(async_client, in_memory_db):
    _seed_admin(in_memory_db)
    in_memory_db.curations.insert_one(active_curation(curation_id="c-active", status="active"))
    in_memory_db.curations.insert_one(active_curation(curation_id="c-draft", status="draft"))
    in_memory_db.curations.insert_one(active_curation(curation_id="c-old", status="archived"))

    response = await async_client.post(
        "/api/v3/catalog/curations/resolve",
        headers=_service_headers(),
        json={"curation_ids": ["c-active", "c-draft", "c-old", "missing"]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "eligible_ids": ["c-active", "c-draft"],
        "rejected": [
            {"curation_id": "c-old", "reason": "ineligible_status"},
            {"curation_id": "missing", "reason": "not_found"},
        ],
    }


@pytest.mark.asyncio
async def test_resolve_deduplicates_and_requires_a_current_admin(async_client, in_memory_db):
    in_memory_db.users.insert_one(
        {
            "_id": "cms-curator-test",
            "email": "cms-curator-test@example.com",
            "name": "CMS Curator",
            "authorized": True,
            "role": "curator",
        }
    )
    in_memory_db.curations.insert_one(active_curation(curation_id="c-active"))

    response = await async_client.post(
        "/api/v3/catalog/curations/resolve",
        headers=_service_headers("cms-curator-test"),
        json={"curation_ids": ["c-active", "c-active"]},
    )

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_resolve_limits_the_internal_batch_to_500(async_client, in_memory_db):
    _seed_admin(in_memory_db)

    response = await async_client.post(
        "/api/v3/catalog/curations/resolve",
        headers=_service_headers(),
        json={"curation_ids": [f"c-{index}" for index in range(501)]},
    )

    assert response.status_code == 422
