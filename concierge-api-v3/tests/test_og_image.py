"""
Testes do serviço e endpoint de og:image (véu de imagem dos cards).

Parser, resize e endpoint são testados sem rede; o fetch é testado com
o AsyncClient do httpx mockado (o SSRF guard real é exercitado no caso
de host interno, que não depende de rede).
"""

import io

import httpx
import pytest
from unittest.mock import AsyncMock, MagicMock

from PIL import Image

from app.services.og_image_service import (
    _parse_og_image,
    _parse_og_images,
    _resize_to_card_jpeg,
    _download_bytes,
    fetch_og_image,
    get_og_image_bytes,
    _og_cache,
    _og_bytes_cache,
)


# ---------------------------------------------------------------------------
# Parser (sem rede)
# ---------------------------------------------------------------------------


def test_parse_og_image_property_first():
    raw = b'<html><head><meta property="og:image" content="https://site.com/img.jpg"></head></html>'
    assert _parse_og_image(raw, "https://site.com/restaurante") == "https://site.com/img.jpg"


def test_parse_og_image_content_first():
    raw = b'<meta content="https://site.com/img2.png" property="og:image">'
    assert _parse_og_image(raw, "https://site.com/") == "https://site.com/img2.png"


def test_parse_og_image_twitter_fallback():
    raw = b'<meta name="twitter:image" content="/media/foto.jpg">'
    assert _parse_og_image(raw, "https://site.com/pagina") == "https://site.com/media/foto.jpg"


def test_parse_og_image_link_image_src_fallback():
    raw = b'<link rel="image_src" href="https://site.com/thumb.png">'
    assert _parse_og_image(raw, "https://site.com/") == "https://site.com/thumb.png"


def test_parse_og_image_none_sem_meta():
    assert _parse_og_image(b"<html><body>sem meta tags</body></html>", "https://site.com/") is None


# --- parser: candidatas em cascata, base href, dedupe ---


def test_parse_og_images_ordem_de_prioridade_e_dedupe():
    raw = (
        b'<meta property="og:image" content="https://site.com/og1.jpg">'
        b'<meta property="og:image" content="https://site.com/og2.jpg">'  # og antes de twitter
        b'<meta name="twitter:image" content="https://site.com/tw.jpg">'
        b'<meta property="og:image" content="https://site.com/og1.jpg">'  # duplicada
    )
    assert _parse_og_images(raw, "https://site.com/") == [
        "https://site.com/og1.jpg",
        "https://site.com/og2.jpg",
        "https://site.com/tw.jpg",
    ]


def test_parse_og_images_respeita_base_href():
    raw = (
        b'<base href="https://cdn.site.com/loja/">'
        b'<meta property="og:image" content="fotos/capa.jpg">'
    )
    assert _parse_og_images(raw, "https://site.com/pagina") == ["https://cdn.site.com/loja/fotos/capa.jpg"]


def test_parse_og_images_fallbacks_secure_url_e_itemprop():
    raw = (
        b'<meta property="og:image:secure_url" content="https://site.com/secure.jpg">'
        b'<meta itemprop="image" content="https://site.com/schema.jpg">'
    )
    assert _parse_og_images(raw, "https://site.com/") == [
        "https://site.com/secure.jpg",
        "https://site.com/schema.jpg",
    ]


def test_parse_og_images_ignora_data_uri():
    raw = b'<meta property="og:image" content="data:image/png;base64,AAAA">'
    assert _parse_og_images(raw, "https://site.com/") == []


# ---------------------------------------------------------------------------
# Resize (Pillow, sem rede)
# ---------------------------------------------------------------------------


def _make_png(width: int, height: int) -> bytes:
    img = Image.new("RGB", (width, height), (180, 60, 40))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_resize_limita_a_768px_e_gera_jpeg():
    raw = _make_png(2000, 1200)
    data, content_type = _resize_to_card_jpeg(raw)

    assert content_type == "image/jpeg"
    out = Image.open(io.BytesIO(data))
    assert max(out.size) <= 768
    assert out.format == "JPEG"


def test_resize_imagem_pequena_nao_estoura():
    raw = _make_png(200, 100)
    data, _ = _resize_to_card_jpeg(raw)
    out = Image.open(io.BytesIO(data))
    assert out.size == (200, 100)  # thumbnail nunca aumenta


def test_resize_bytes_corrompidos_lanca():
    with pytest.raises(Exception):
        _resize_to_card_jpeg(b"nao sou uma imagem")


# ---------------------------------------------------------------------------
# fetch_og_image com httpx mockado
# ---------------------------------------------------------------------------


def _mock_http_client(
    html: bytes,
    final_url: str = "https://site.com/restaurante",
    content_type: str = "text/html; charset=utf-8",
) -> MagicMock:
    """MagicMock que emula o AsyncClient.stream do httpx.

    `async with httpx.AsyncClient(...) as client` rebinda a variável ao
    resultado de __aenter__ — por isso o __aenter__ devolve o PRÓPRIO
    mock configurado (senão o `as client` vira um MagicMock vazio).
    """
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.headers = {"content-type": content_type}
    response.url = final_url
    response.aiter_bytes = MagicMock(return_value=_async_iter([html]))

    stream_ctx = MagicMock()
    stream_ctx.__aenter__ = AsyncMock(return_value=response)
    stream_ctx.__aexit__ = AsyncMock(return_value=False)

    client = MagicMock()
    client.stream = MagicMock(return_value=stream_ctx)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


@pytest.mark.asyncio
async def test_fetch_og_image_sucesso(monkeypatch):
    html = b'<meta property="og:image" content="https://site.com/og.jpg">'
    client = _mock_http_client(html)

    monkeypatch.setattr("app.services.og_image_service.httpx.AsyncClient", lambda **kw: client)
    _og_cache.clear()

    assert await fetch_og_image("https://site.com/restaurante") == "https://site.com/og.jpg"


@pytest.mark.asyncio
async def test_fetch_og_image_cache_evita_refetch(monkeypatch):
    html = b'<meta property="og:image" content="https://site.com/og.jpg">'
    client = _mock_http_client(html)

    monkeypatch.setattr("app.services.og_image_service.httpx.AsyncClient", lambda **kw: client)
    _og_cache.clear()

    assert await fetch_og_image("https://site.com/restaurante") == "https://site.com/og.jpg"
    assert await fetch_og_image("https://site.com/restaurante") == "https://site.com/og.jpg"
    assert client.stream.call_count == 1  # segunda chamada veio do cache


@pytest.mark.asyncio
async def test_fetch_og_image_host_interno_ssrf():
    # localhost resolve para loopback → guard bloqueia ANTES de rede
    with pytest.raises(ValueError):
        await fetch_og_image("http://localhost:8080/qualquer")


@pytest.mark.asyncio
async def test_fetch_og_image_header_errado_mas_corpo_html(monkeypatch):
    # Servidor manda text/plain mas o corpo é HTML — o sniff salva
    html = b'<html><meta property="og:image" content="https://site.com/x.jpg"></html>'
    client = _mock_http_client(html, content_type="text/plain")
    monkeypatch.setattr("app.services.og_image_service.httpx.AsyncClient", lambda **kw: client)
    _og_cache.clear()

    assert await fetch_og_image("https://site.com/restaurante") == "https://site.com/x.jpg"


# ---------------------------------------------------------------------------
# Cascata de candidatas + retry (get_og_image_bytes / _download_bytes)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_og_image_bytes_cascata_candidata_seguinte(monkeypatch):
    # primeira candidata falha o download; a segunda decodifica
    from app.services import og_image_service as svc

    async def fake_resolve(page_url):
        return ["https://cdn.com/quebrada.jpg", "https://cdn.com/boa.jpg"]

    async def fake_download(url, timeout):
        if url.endswith("quebrada.jpg"):
            return None
        return _make_png(900, 600)

    monkeypatch.setattr(svc, "_resolve_og_image_candidates", fake_resolve)
    monkeypatch.setattr(svc, "_download_bytes", fake_download)
    _og_bytes_cache.clear()

    data, content_type = await get_og_image_bytes("https://site.com/restaurante")
    assert content_type == "image/jpeg"
    assert Image.open(io.BytesIO(data)).format == "JPEG"


@pytest.mark.asyncio
async def test_download_bytes_retry_transitorio(monkeypatch):
    calls = {"n": 0}

    def make_client(**kw):
        calls["n"] += 1
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        stream_ctx = MagicMock()
        stream_ctx.__aexit__ = AsyncMock(return_value=False)
        if calls["n"] == 1:
            stream_ctx.__aenter__ = AsyncMock(side_effect=httpx.ConnectError("boom"))
        else:
            response = MagicMock()
            response.raise_for_status = MagicMock()
            response.aiter_bytes = MagicMock(return_value=_async_iter([b"img"]))
            stream_ctx.__aenter__ = AsyncMock(return_value=response)
        client.stream = MagicMock(return_value=stream_ctx)
        return client

    monkeypatch.setattr("app.services.og_image_service.httpx.AsyncClient", make_client)

    assert await _download_bytes("https://img.example.com/x.jpg", 5) == b"img"
    assert calls["n"] == 2  # tentativa inicial + 1 retry


@pytest.mark.asyncio
async def test_download_bytes_ssrf_nao_retry(monkeypatch):
    calls = {"n": 0}

    def make_client(**kw):
        calls["n"] += 1
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        stream_ctx = MagicMock()
        stream_ctx.__aenter__ = AsyncMock(side_effect=ValueError("destino de imagem não permitido (rede interna)"))
        stream_ctx.__aexit__ = AsyncMock(return_value=False)
        client.stream = MagicMock(return_value=stream_ctx)
        return client

    monkeypatch.setattr("app.services.og_image_service.httpx.AsyncClient", make_client)

    with pytest.raises(ValueError):
        await _download_bytes("http://127.0.0.1/x.jpg", 5)
    assert calls["n"] == 1  # bloqueio do guard NUNCA é re-tentado


# ---------------------------------------------------------------------------
# Fallback Google Places (sem rede)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_og_image_bytes_fallback_places(monkeypatch):
    from app.services import og_image_service as svc

    async def fake_resolve(page_url):
        return []  # site sem og:image

    async def fake_download(url, timeout):
        if "places.googleapis.com" in url:
            return _make_png(900, 700)
        return None

    class FakePlacesService:
        def __init__(self, *args, **kwargs):
            pass

        def fetch_google_place_photos(self, place_id, max_photos=10, language="pt-BR"):
            return [{"name": "places/P1/photos/PH1"}]

    monkeypatch.setattr(svc, "_resolve_og_image_candidates", fake_resolve)
    monkeypatch.setattr(svc, "_download_bytes", fake_download)
    monkeypatch.setattr("app.services.llm_place_service.LLMPlaceService", FakePlacesService)
    monkeypatch.setattr(svc.settings, "google_places_api_key", "fake-key")
    _og_bytes_cache.clear()

    data, content_type = await get_og_image_bytes(page_url="https://site.com/x", place_id="P1")
    assert content_type == "image/jpeg"
    assert Image.open(io.BytesIO(data)).format == "JPEG"


@pytest.mark.asyncio
async def test_get_og_image_bytes_sem_url_nem_place():
    from app.services import og_image_service as svc

    with pytest.raises(ValueError):
        await get_og_image_bytes(page_url=None, place_id=None)


# ---------------------------------------------------------------------------
# Endpoint (get_og_image_bytes mockado — sem rede)
# ---------------------------------------------------------------------------


def test_og_image_endpoint_ok_devolve_jpeg(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        "app.api.og_image.get_og_image_bytes",
        AsyncMock(return_value=(b"\xff\xd8fakejpeg", "image/jpeg")),
    )
    resp = client.get("/api/v3/og-image", params={"url": "https://site.com/restaurante"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.headers["cache-control"] == "public, max-age=3600"
    assert resp.content == b"\xff\xd8fakejpeg"


def test_og_image_endpoint_sem_imagem_404(client, auth_headers, monkeypatch):
    monkeypatch.setattr("app.api.og_image.get_og_image_bytes", AsyncMock(return_value=None))
    resp = client.get("/api/v3/og-image", params={"url": "https://site.com/restaurante"}, headers=auth_headers)
    assert resp.status_code == 404


def test_og_image_endpoint_url_invalida(client, auth_headers, monkeypatch):
    async def raise_value_error(page_url=None, place_id=None):
        raise ValueError("destino de imagem não permitido (rede interna)")

    monkeypatch.setattr("app.api.og_image.get_og_image_bytes", raise_value_error)
    resp = client.get("/api/v3/og-image", params={"url": "http://10.0.0.1/x"}, headers=auth_headers)
    assert resp.status_code == 400


def test_og_image_endpoint_exige_auth(client):
    resp = client.get("/api/v3/og-image", params={"url": "https://site.com/"})
    assert resp.status_code in (401, 403)


def test_og_image_endpoint_place_id_only(client, auth_headers, monkeypatch):
    # fallback Places: chamada só com place_id (entidades sem website)
    monkeypatch.setattr(
        "app.api.og_image.get_og_image_bytes",
        AsyncMock(return_value=(b"\xff\xd8places", "image/jpeg")),
    )
    resp = client.get("/api/v3/og-image", params={"place_id": "ChIJfake123"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert resp.content == b"\xff\xd8places"


def test_og_image_endpoint_sem_url_nem_place_400(client, auth_headers):
    resp = client.get("/api/v3/og-image", headers=auth_headers)
    assert resp.status_code == 400


def _async_iter(chunks):
    async def gen():
        for chunk in chunks:
            yield chunk

    return gen()
