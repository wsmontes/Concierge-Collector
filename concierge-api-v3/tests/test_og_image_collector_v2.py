"""
Integration-level unit tests for the ranked restaurant image collector.

Network calls are patched; existing SSRF/download behavior remains covered by
test_og_image.py.
"""

import asyncio
import io

import pytest
from PIL import Image, ImageDraw

from app.services.restaurant_image_collector import ImageCandidate
from app.services import og_image_service as svc


def _make_png(width=1200, height=800, color=(160, 80, 40)):
    # Textura determinística (padrão pequeno redimensionado): passa no
    # gate de DETALHE do prepare_image (imagem SÓLIDA é rejeitada como
    # branco/fundo) e cores diferentes geram dhashes diferentes.
    r, g, b = color
    phase = (r * 7 + g * 13 + b * 29) % 256
    small = Image.new("RGB", (32, 32))
    small.putdata(
        [
            (
                (r + (x * 7 + y * 11 + phase)) % 256,
                (g + (x * 3 + y * 5 + phase)) % 256,
                (b + (x * 13 + y * 7 + phase)) % 256,
            )
            for y in range(32)
            for x in range(32)
        ]
    )
    img = small.resize((width, height), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_pattern_png(width, height, color, side):
    img = Image.new("RGB", (width, height), color)
    draw = ImageDraw.Draw(img)
    if side == "left":
        draw.rectangle((0, 0, width // 3, height), fill=(240, 240, 240))
    else:
        draw.rectangle((width * 2 // 3, 0, width, height), fill=(20, 20, 20))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_hero_uses_places_when_website_candidate_scores_poorly(monkeypatch):
    async def resolve(_url):
        return ["https://site.com/body.jpg"]

    async def places(_place_id, max_photos=5):
        return [ImageCandidate("https://places/photo", "google_places", 1)]

    async def download(url, timeout):
        if "places" in url:
            return _make_png(1600, 1000, (20, 120, 180))
        return _make_png(400, 400, (180, 120, 20))

    monkeypatch.setattr(svc, "_resolve_og_image_candidates", resolve)
    monkeypatch.setattr(svc, "_places_image_candidates", places)
    monkeypatch.setattr(svc, "_download_bytes", download)
    svc._image_catalog_cache.clear()

    images = await svc.get_restaurant_images("https://site.com", "P1", limit=1)
    assert images[0].source == "google_places"


@pytest.mark.asyncio
async def test_hero_skips_places_when_structured_site_image_is_strong(monkeypatch):
    from app.services.restaurant_image_discovery import SourcedImageURL

    async def resolve(_url):
        return [
            SourcedImageURL("https://site.com/hero.jpg", "website_og", 0),
            SourcedImageURL("https://site.com/body.jpg", "website_img", 1),
        ]

    async def places(_place_id, max_photos=5):
        raise AssertionError("Places should not be queried for a confident site hero")

    downloads = {"n": 0}

    async def download(url, timeout):
        downloads["n"] += 1
        return _make_png(1800, 1200, (80, 100, 140))

    monkeypatch.setattr(svc, "_resolve_og_image_candidates", resolve)
    monkeypatch.setattr(svc, "_places_image_candidates", places)
    monkeypatch.setattr(svc, "_download_bytes", download)
    svc._image_catalog_cache.clear()

    images = await svc.get_restaurant_images("https://site.com", "P1", limit=1)
    assert images[0].source == "website_og"
    assert downloads["n"] == 1


@pytest.mark.asyncio
async def test_gallery_combines_site_and_places(monkeypatch):
    # Galeria com site INSUFICIENTE (1 imagem) completa com Places —
    # Places é fallback, nunca a primeira fonte.
    from app.services.restaurant_image_discovery import SourcedImageURL

    async def resolve(_url):
        return [SourcedImageURL("https://site.com/hero.jpg", "website_og", 0)]

    async def places(_place_id, max_photos=5):
        return [ImageCandidate("https://places/photo", "google_places", 1)]

    async def download(url, timeout):
        if "places" in url:
            return _make_pattern_png(1300, 900, (10, 130, 190), "right")
        return _make_pattern_png(1500, 1000, (190, 70, 20), "left")

    monkeypatch.setattr(svc, "_resolve_og_image_candidates", resolve)
    monkeypatch.setattr(svc, "_places_image_candidates", places)
    monkeypatch.setattr(svc, "_download_bytes", download)
    svc._image_catalog_cache.clear()

    images = await svc.get_restaurant_images("https://site.com", "P1", limit=8)
    assert {image.source for image in images} == {"website_og", "google_places"}


@pytest.mark.asyncio
async def test_gallery_skips_places_when_site_fills_the_limit(monkeypatch):
    # Places é SEMPRE fallback (pedido do concierge, ago/2026): um site
    # com imagens válidas suficientes para o limite não dispara NENHUMA
    # chamada ao Places — evita custo/rate desnecessário.
    from app.services.restaurant_image_discovery import SourcedImageURL

    urls = [SourcedImageURL(f"https://site.com/p{i}.jpg", "website_img", i) for i in range(9)]

    async def resolve(_url):
        return urls

    async def places(_place_id, max_photos=5):
        raise AssertionError("Places não deveria ser consultado: o site preenche a galeria")

    def _distinct_png(index):
        # Retângulo em posição própria por index: imagens VISUALMENTE
        # distintas (o dedupe por dhash colapsaria padrões idênticos)
        img = Image.new("RGB", (1200, 800), (120, 140, 90))
        draw = ImageDraw.Draw(img)
        x = 20 + index * 110
        draw.rectangle((x, 30, x + 200, 320), fill=(240, 240, 240))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    async def download(url, timeout):
        # basename 'pN.jpg' → N (split('/') e lstrip, não split('p') —
        # 'https' também contém 'p')
        index = int(url.split("/")[-1].lstrip("p").split(".")[0])
        return _distinct_png(index)

    monkeypatch.setattr(svc, "_resolve_og_image_candidates", resolve)
    monkeypatch.setattr(svc, "_places_image_candidates", places)
    monkeypatch.setattr(svc, "_download_bytes", download)
    svc._image_catalog_cache.clear()

    images = await svc.get_restaurant_images("https://site.com", "P1", limit=8)
    assert len(images) == 8
    assert {image.source for image in images} == {"website_img"}


@pytest.mark.asyncio
async def test_ranked_bytes_returns_requested_gallery_image(monkeypatch):
    class FakeImage:
        def __init__(self, value):
            self.jpeg_bytes = value

    async def fake_images(page_url=None, place_id=None, limit=8):
        return [FakeImage(b"first"), FakeImage(b"second")]

    monkeypatch.setattr(svc, "get_restaurant_images", fake_images)
    result = await svc.get_restaurant_image_bytes("https://site.com", "P1", rank=1)
    assert result == (b"second", "image/jpeg")
    assert await svc.get_restaurant_image_bytes("https://site.com", "P1", rank=3) is None


def test_candidate_cache_evicts_least_recently_used_entry(monkeypatch):
    monkeypatch.setattr(svc, "OG_CACHE_MAX_ENTRIES", 2)
    monkeypatch.setattr(svc.time, "monotonic", lambda: 1000.0)
    svc._og_cache.clear()
    svc._cache_put("https://a.example", ["https://img/a.jpg"])
    svc._cache_put("https://b.example", ["https://img/b.jpg"])
    assert svc._cache_get("https://a.example") is not None  # a becomes MRU
    svc._cache_put("https://c.example", ["https://img/c.jpg"])
    assert "https://a.example" in svc._og_cache
    assert "https://c.example" in svc._og_cache
    assert "https://b.example" not in svc._og_cache


@pytest.mark.asyncio
async def test_collector_still_propagates_invalid_restaurant_page_url(monkeypatch):
    async def resolve(_url):
        raise ValueError("destino de imagem não permitido (rede interna)")

    monkeypatch.setattr(svc, "_resolve_og_image_candidates", resolve)
    svc._image_catalog_cache.clear()
    with pytest.raises(ValueError, match="rede interna"):
        await svc.get_restaurant_images("http://127.0.0.1/private", None, limit=1)


@pytest.mark.asyncio
async def test_places_metadata_does_not_block_event_loop(monkeypatch):
    import time

    from app.services import llm_place_service

    class SlowPlacesService:
        def __init__(self, *args, **kwargs):
            pass

        def fetch_google_place_photos(self, place_id, max_photos=10, language="pt-BR"):
            time.sleep(0.08)
            return [{"name": "places/P1/photos/PH1"}]

    monkeypatch.setattr(llm_place_service, "LLMPlaceService", SlowPlacesService)
    monkeypatch.setattr(svc.settings, "google_places_api_key", "fake-key")

    started = time.perf_counter()
    task = asyncio.create_task(svc._places_image_candidates("P1", max_photos=1))
    await asyncio.sleep(0.01)
    elapsed = time.perf_counter() - started
    await task

    assert elapsed < 0.05


def test_safe_log_url_redacts_query_and_fragment():
    raw = "https://places.googleapis.com/v1/places/P1/photos/PH1/media?key=super-secret&maxWidthPx=768#frag"
    safe = svc._safe_log_url(raw)
    assert safe == "https://places.googleapis.com/v1/places/P1/photos/PH1/media"
    assert "super-secret" not in safe
