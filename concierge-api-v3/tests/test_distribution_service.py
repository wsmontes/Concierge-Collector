"""Availability rules for Collection distribution hydration."""

from unittest.mock import MagicMock

import pytest
from pymongo.errors import AutoReconnect

from app.services.distribution_service import (
    DistributionDependencyError,
    evaluate_public_item,
    hydrate_public_items,
)
from app.core.config import settings
from tests.factories import active_curation, active_entity


def test_distribution_availability_requires_active_curation_and_entity():
    result = evaluate_public_item(
        {"curation_id": "c1", "status": "draft", "entity_id": "e1"},
        {"entity_id": "e1", "status": "active", "name": "Place"},
    )

    assert result.item is None
    assert result.reason == "curation_not_public"


def test_distribution_rejects_missing_or_inactive_entity():
    curation = active_curation(curation_id="c1", entity_id="e1")

    assert evaluate_public_item(curation, None).reason == "missing_entity"
    assert (
        evaluate_public_item(curation, active_entity(entity_id="e1", status="inactive")).reason == "entity_not_public"
    )


def test_distribution_uses_an_allowlisted_public_shape_only():
    result = evaluate_public_item(
        active_curation(curation_id="c1", entity_id="e1", notes={"public": "A note", "private": "never expose"}),
        active_entity(entity_id="e1", name="Place", internal_score=99),
    )

    assert result.reason is None
    assert result.item.model_dump() == {
        "curation_id": "c1",
        "entity_id": "e1",
        "name": "Place",
        "curation_note": "A note",
    }


def test_transient_failure_is_not_unavailable():
    failing_db = MagicMock()
    failing_db.curations.find.side_effect = AutoReconnect("transient test failure")

    with pytest.raises(DistributionDependencyError):
        hydrate_public_items(failing_db, ["c1"])


@pytest.mark.asyncio
async def test_internal_hydration_is_service_key_only_and_reports_counts(async_client, in_memory_db):
    in_memory_db.curations.insert_one(active_curation(curation_id="c1", entity_id="e1"))
    in_memory_db.curations.insert_one(active_curation(curation_id="c2", entity_id="missing", status="draft"))
    in_memory_db.entities.insert_one(active_entity(entity_id="e1", name="Place"))

    forbidden = await async_client.post("/api/v3/internal/curations/hydrate", json={"curation_ids": ["c1"]})
    assert forbidden.status_code == 401

    response = await async_client.post(
        "/api/v3/internal/curations/hydrate",
        headers={"X-CMS-Service-Key": settings.cms_service_key_value},
        json={"curation_ids": ["c1", "c2", "missing", "c1"]},
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [{"curation_id": "c1", "entity_id": "e1", "name": "Place", "curation_note": None}],
        "unavailable": [
            {"curation_id": "c2", "reason": "curation_not_public"},
            {"curation_id": "missing", "reason": "curation_missing"},
        ],
        "selected_count": 3,
        "available_count": 1,
        "unavailable_count": 2,
    }
