"""Tests for collector-specific image metrics endpoint."""

import pytest


@pytest.mark.asyncio
async def test_collector_stats_endpoint_keeps_legacy_stats_separate(monkeypatch):
    from app.api import og_image

    expected = {"requests": 2, "candidates_discovered": 7}
    monkeypatch.setattr(og_image, "get_image_collector_stats", lambda: expected)
    assert await og_image.og_image_collector_stats(auth={"role": "curator"}) == expected
