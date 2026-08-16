"""
Unit tests for deterministic restaurant image ranking and visual dedupe.

No network is involved here: discovery/download security remains covered by
`test_og_image.py`; this file locks the ranking contract in isolation.
"""

import io

from PIL import Image

from app.services.restaurant_image_collector import (
    ImageCandidate,
    prepare_image,
    rank_and_dedupe,
)


def _make_png(width=1200, height=800, color=(160, 80, 40)):
    img = Image.new("RGB", (width, height), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_google_places_photo_can_beat_body_image_when_quality_is_equal():
    body = prepare_image(_make_png(), ImageCandidate("https://site/x.jpg", "website_img", 0))
    places = prepare_image(
        _make_png(color=(40, 100, 160)),
        ImageCandidate("https://places/x", "google_places", 0),
    )
    ranked = rank_and_dedupe([body, places], limit=2)
    assert ranked[0].source == "google_places"


def test_og_photo_beats_body_image_when_quality_is_equal():
    body = prepare_image(
        _make_png(color=(20, 40, 80)),
        ImageCandidate("https://site/body.jpg", "website_img", 0),
    )
    og = prepare_image(
        _make_png(color=(80, 40, 20)),
        ImageCandidate("https://site/hero.jpg", "website_og", 0),
    )
    ranked = rank_and_dedupe([body, og], limit=2)
    assert ranked[0].source == "website_og"


def test_prepare_image_rejects_thin_banner():
    try:
        prepare_image(
            _make_png(635, 62),
            ImageCandidate("https://site/banner.jpg", "website_img", 0),
        )
    except ValueError as exc:
        assert "635x62" in str(exc)
    else:
        raise AssertionError("thin banner should be rejected")


def test_rank_and_dedupe_removes_near_duplicate_images():
    raw = _make_png(1000, 700, (120, 90, 70))
    first = prepare_image(raw, ImageCandidate("https://site/a.jpg", "website_og", 0))
    duplicate = prepare_image(raw, ImageCandidate("https://cdn/b.jpg", "google_places", 0))
    ranked = rank_and_dedupe([first, duplicate], limit=8)
    assert len(ranked) == 1


def test_processed_image_is_jpeg_capped_at_768_and_keeps_original_dimensions_metadata():
    image = prepare_image(
        _make_png(2000, 1200),
        ImageCandidate("https://site/hero.jpg", "website_og", 0),
    )
    decoded = Image.open(io.BytesIO(image.jpeg_bytes))
    assert image.width == 2000
    assert image.height == 1200
    assert max(decoded.size) <= 768
    assert decoded.format == "JPEG"
    assert image.score > 0
    assert "source" in image.score_components
