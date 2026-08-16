"""
Unit tests for the backward-compatible entity image gallery API.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

from app.services.restaurant_image_collector import CollectedImage


def _db_with_entity(doc):
    db = MagicMock()
    db.entities.find_one.side_effect = lambda query: doc if query.get("_id") == "e1" else None
    return db


def _image(source, score, marker):
    return CollectedImage(
        jpeg_bytes=marker,
        source=source,
        width=1600,
        height=1000,
        byte_size=123456,
        score=score,
        score_components={"source": score},
        perceptual_hash=1 if source == "website_og" else 2,
    )


def test_entity_images_returns_ranked_safe_proxy_metadata():
    from app.api.entities import get_entity_images

    db = _db_with_entity(
        {
            "_id": "e1",
            "data": {
                "contact": {"website": "https://restaurant.example"},
                "place_id": "ChIJ123",
            },
        }
    )
    images = [_image("website_og", 72.5, b"one"), _image("google_places", 68.0, b"two")]

    async def run():
        with patch("app.api.entities.get_restaurant_images", new=AsyncMock(return_value=images)) as service:
            response = await get_entity_images("e1", limit=8, db=db, auth={"role": "curator"})
            return response, service

    response, service = asyncio.run(run())
    service.assert_awaited_once_with(
        page_url="https://restaurant.example",
        place_id="ChIJ123",
        limit=8,
    )
    assert response["count"] == 2
    assert response["hero_rank"] == 0
    assert [item["rank"] for item in response["images"]] == [0, 1]
    assert response["images"][1]["source"] == "google_places"
    assert response["images"][1]["image_url"] == "/api/v3/entities/e1/image?rank=1"
    assert "key=" not in str(response)
    assert "places.googleapis.com" not in str(response)


def test_entity_image_rank_uses_ranked_collector_without_breaking_default_path():
    from app.api.entities import get_entity_image

    db = _db_with_entity({"_id": "e1", "data": {"place_id": "ChIJ123"}})

    async def run():
        with patch("app.api.entities.get_og_image_bytes", new=AsyncMock()) as legacy:
            with patch(
                "app.api.entities.get_restaurant_image_bytes",
                new=AsyncMock(return_value=(b"rank-one", "image/jpeg")),
            ) as ranked:
                response = await get_entity_image("e1", rank=1, db=db, auth={"role": "curator"})
                return response, legacy, ranked

    response, legacy, ranked = asyncio.run(run())
    legacy.assert_not_awaited()
    ranked.assert_awaited_once_with(page_url=None, place_id="ChIJ123", rank=1)
    assert response.body == b"rank-one"
    assert response.headers["Cache-Control"] == "public, max-age=3600"


def test_entity_images_returns_empty_gallery_when_sources_have_no_usable_images():
    from app.api.entities import get_entity_images

    db = _db_with_entity({"_id": "e1", "data": {"place_id": "ChIJ123"}})

    async def run():
        with patch("app.api.entities.get_restaurant_images", new=AsyncMock(return_value=[])):
            return await get_entity_images("e1", limit=8, db=db, auth={"role": "curator"})

    response = asyncio.run(run())
    assert response == {"entity_id": "e1", "count": 0, "hero_rank": None, "images": []}


def test_entity_image_rank_missing_returns_404():
    from app.api.entities import get_entity_image

    db = _db_with_entity({"_id": "e1", "data": {"place_id": "ChIJ123"}})

    async def run():
        with patch("app.api.entities.get_restaurant_image_bytes", new=AsyncMock(return_value=None)):
            try:
                await get_entity_image("e1", rank=3, db=db, auth={"role": "curator"})
            except HTTPException as exc:
                return exc
        raise AssertionError("expected HTTPException")

    exc = asyncio.run(run())
    assert exc.status_code == 404
