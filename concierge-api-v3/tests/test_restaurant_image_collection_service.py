"""
Tests for bounded-concurrency image collection orchestration.
"""

import asyncio
import io

import pytest
from PIL import Image

from app.services.restaurant_image_collector import ImageCandidate
from app.services.restaurant_image_collection_service import collect_candidates


def _make_png(width=1200, height=800, color=(140, 70, 30)):
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_collect_candidates_tolerates_partial_download_failures_and_ranks_sources():
    candidates = [
        ImageCandidate("https://site/body.jpg", "website_img", 0),
        ImageCandidate("https://places/photo", "google_places", 1),
        ImageCandidate("https://site/broken.jpg", "website_og", 2),
    ]

    async def downloader(candidate):
        if candidate.url.endswith("broken.jpg"):
            return None
        if candidate.source == "google_places":
            return _make_png(color=(20, 120, 180))
        return _make_png(color=(180, 120, 20))

    result = await collect_candidates(candidates, downloader, limit=8)
    assert result.discovered == 3
    assert result.accepted == 2
    assert result.rejected == 1
    assert result.images[0].source == "google_places"


@pytest.mark.asyncio
async def test_collect_candidates_limits_concurrent_downloads():
    candidates = [ImageCandidate(f"https://site/{i}.jpg", "website_img", i) for i in range(8)]
    state = {"active": 0, "peak": 0}

    async def downloader(candidate):
        state["active"] += 1
        state["peak"] = max(state["peak"], state["active"])
        await asyncio.sleep(0.01)
        state["active"] -= 1
        return _make_png(color=(candidate.source_index * 20, 80, 120))

    await collect_candidates(candidates, downloader, limit=8, max_concurrency=3)
    assert state["peak"] <= 3


@pytest.mark.asyncio
async def test_collect_candidates_reports_visual_duplicates_removed():
    raw = _make_png()
    candidates = [
        ImageCandidate("https://site/a.jpg", "website_og", 0),
        ImageCandidate("https://cdn/a-copy.jpg", "google_places", 1),
    ]

    async def downloader(candidate):
        return raw

    result = await collect_candidates(candidates, downloader, limit=8)
    assert len(result.images) == 1
    assert result.duplicates_removed == 1


@pytest.mark.asyncio
async def test_collect_candidates_propagates_downloader_security_value_error():
    candidates = [ImageCandidate("http://127.0.0.1/private.jpg", "website_img", 0)]

    async def downloader(candidate):
        raise ValueError("destino de imagem não permitido (rede interna)")

    with pytest.raises(ValueError, match="rede interna"):
        await collect_candidates(candidates, downloader, limit=1)
