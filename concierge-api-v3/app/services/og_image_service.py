"""
Resolução em real-time de og:image dos sites dos restaurantes.

O frontend exibe um véu degradê nos cards usando a imagem OG do site do
restaurante (metadados: data.contact.website / data.website). O browser
não consegue buscar o HTML de domínios arbitrários (CORS), então o
servidor faz o fetch, parseia as meta tags, baixa a imagem E a
redimensiona em real-time (thumbnail JPEG — sites servem originais de
megabytes; o card só precisa de ~768px) antes de devolver os bytes.

RESILIÊNCIA / FLEXIBILIDADE (ago/2026):
- Candidatas em CASCATA por prioridade: og:image → og:image:secure_url
  → og:image:url → twitter:image → twitter:image:src → link image_src
  → schema.org itemprop=image. Todas as ocorrências de cada grupo são
  coletadas; o download tenta cada uma até uma decodificar (sites com
  og:image quebrada caem para a twitter:image, etc.).
- `<base href>` do HTML é respeitado na resolução de URLs relativas.
- O content-type do servidor NÃO é confiado: HTML com header errado é
  aceito se o corpo tem cara de HTML (sniff); imagens com header
  errado são tentadas de qualquer forma — quem decide é o decodificador.
- 1 retry com backoff em falha transitória de download (nunca em
  destino bloqueado — ValueError do SSRF guard propaga).

Segurança (padrões do openai_service):
- Mesmo SSRF guard (`_validate_image_request_hook` como event hook) —
  valida a URL inicial E cada redirect da cadeia, no HTML e na imagem.
- Limite de bytes DURANTE o streaming (400KB de HTML, 20MB de imagem)
  e timeouts (6s HTML, 30s imagem).
- Cache em memória com TTL de 1h — N cards do mesmo site compartilham
  uma única busca (instância única no Render, sem Redis).
"""

import asyncio
import html as html_lib
import io
import logging
import re
import time
from typing import List, Optional, Tuple
from urllib.parse import urljoin

import httpx
from PIL import Image

from app.core.config import settings
from app.services.openai_service import _validate_image_request_hook

logger = logging.getLogger(__name__)

# HTML de páginas reais raramente passa de 400KB até as meta tags;
# o cap evita baixar páginas gigantes inteiras.
MAX_HTML_BYTES = 400 * 1024
FETCH_TIMEOUT_SECONDS = 6.0
IMAGE_FETCH_TIMEOUT_SECONDS = 30.0
MAX_IMAGE_BYTES = 20 * 1024 * 1024  # mesmo cap do openai_service
OG_CACHE_TTL_SECONDS = 3600
OG_CACHE_MAX_ENTRIES = 2000
DOWNLOAD_ATTEMPTS = 2  # tentativa inicial + 1 retry
RETRY_BACKOFF_SECONDS = 0.4

# Redimensionamento: thumbnail até 768px na maior dimensão (o véu do
# card não precisa de mais), JPEG qualidade 82 — ~60-120KB por imagem.
OG_IMAGE_MAX_DIM = 768
OG_IMAGE_QUALITY = 82
# Cache dos BYTES redimensionados (mais caros que a URL): cap menor
# para não segurar centenas de JPEGs em memória (~30MB no pior caso).
OG_BYTES_CACHE_MAX_ENTRIES = 300

# Candidatas por grupo de prioridade — a ordem da lista define a ordem
# de tentativa do download. Cada grupo cobre as duas ordens possíveis
# de atributos na tag meta.
_META_PATTERN_GROUPS: List[Tuple[str, List[re.Pattern]]] = [
    (
        "og:image",
        [
            re.compile(rb'<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']', re.I),
        ],
    ),
    (
        "og:image:secure_url",
        [
            re.compile(rb'<meta[^>]+property=["\']og:image:secure_url["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*property=["\']og:image:secure_url["\']', re.I),
        ],
    ),
    (
        "og:image:url",
        [
            re.compile(rb'<meta[^>]+property=["\']og:image:url["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*property=["\']og:image:url["\']', re.I),
        ],
    ),
    (
        "twitter:image",
        [
            re.compile(rb'<meta[^>]+(?:name|property)=["\']twitter:image["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:name|property)=["\']twitter:image["\']', re.I),
        ],
    ),
    (
        "twitter:image:src",
        [
            re.compile(rb'<meta[^>]+(?:name|property)=["\']twitter:image:src["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:name|property)=["\']twitter:image:src["\']', re.I),
        ],
    ),
    (
        "link image_src",
        [re.compile(rb'<link[^>]+rel=["\']image_src["\'][^>]*href=["\']([^"\']+)["\']', re.I)],
    ),
    (
        "schema.org itemprop=image",
        [
            re.compile(rb'<meta[^>]+itemprop=["\']image["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*itemprop=["\']image["\']', re.I),
        ],
    ),
]

_BASE_HREF = re.compile(rb'<base[^>]+href=["\']([^"\']+)["\']', re.I)
# Corpo com cara de HTML mesmo quando o content-type mente
_HTML_SNIFF = re.compile(rb'<(html|head|meta|body|!doctype)\b', re.I)

# url do site -> (candidatas ou None, expires_at)
_og_cache: dict[str, tuple[Optional[List[str]], float]] = {}


def _cache_get(url: str) -> Optional[tuple[Optional[List[str]], float]]:
    """Consulta o cache podando entradas expiradas (TTL 1h)."""
    now = time.monotonic()
    for key in [k for k, (_, exp) in _og_cache.items() if exp < now]:
        _og_cache.pop(key, None)
    hit = _og_cache.get(url)
    if hit and hit[1] >= now:
        return hit
    if hit:
        _og_cache.pop(url, None)
    return None


def _cache_put(url: str, candidates: Optional[List[str]]) -> None:
    if len(_og_cache) >= OG_CACHE_MAX_ENTRIES:
        _og_cache.clear()
    _og_cache[url] = (candidates, time.monotonic() + OG_CACHE_TTL_SECONDS)


def _parse_og_images(raw: bytes, final_url: str) -> List[str]:
    """TODAS as imagens candidatas do HTML, em ordem de prioridade.

    Respeita `<base href>` para URLs relativas; ignora data:/blob: e
    deduplica preservando a ordem (a primeira é a mais confiável).
    """
    base_url = final_url
    base_match = _BASE_HREF.search(raw)
    if base_match:
        base_candidate = html_lib.unescape(base_match.group(1).decode("utf-8", errors="replace").strip())
        resolved_base = urljoin(final_url, base_candidate)
        if resolved_base.startswith(("http://", "https://")):
            base_url = resolved_base

    candidates: List[str] = []
    for _label, patterns in _META_PATTERN_GROUPS:
        for pattern in patterns:
            for match in pattern.finditer(raw):
                candidate = match.group(1).decode("utf-8", errors="replace").strip()
                if not candidate:
                    continue
                candidate = html_lib.unescape(candidate)
                absolute = urljoin(base_url, candidate)
                if absolute.startswith(("http://", "https://")):
                    candidates.append(absolute)
    return list(dict.fromkeys(candidates))


def _parse_og_image(raw: bytes, final_url: str) -> Optional[str]:
    """Compat: primeira candidata (usada por testes/consumidores diretos)."""
    candidates = _parse_og_images(raw, final_url)
    return candidates[0] if candidates else None


async def _resolve_og_image_candidates(page_url: str) -> Optional[List[str]]:
    """Busca o HTML de `page_url` e devolve as candidatas (ou None).

    ValueError: URL inválida/credenciais/rede interna (SSRF guard).
    Falha de rede/status não-2xx vira None. Content-type do servidor é
    tratado com desconfiança: se o corpo tiver cara de HTML (sniff),
    parseamos mesmo com header errado.
    """
    if not isinstance(page_url, str) or not page_url.strip():
        raise ValueError("url é obrigatória")

    cached = _cache_get(page_url)
    if cached:
        return cached[0]

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=FETCH_TIMEOUT_SECONDS,
            # Mesmo guard SSRF do download de imagens — valida cada
            # request da cadeia de redirects (importado, não duplicado).
            event_hooks={"request": [_validate_image_request_hook]},
            headers={"User-Agent": "ConciergeCollector/1.0 (+https://concierge-collector.onrender.com)"},
        ) as client:
            async with client.stream("GET", page_url) as response:
                response.raise_for_status()

                content_type = response.headers.get("content-type", "")
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > MAX_HTML_BYTES:
                        break
                    chunks.append(chunk)
                raw = b"".join(chunks)

                # leniência de content-type: só descarta quando o header
                # nega HTML E o corpo não parece HTML
                if content_type and not content_type.startswith(("text/html", "application/xhtml")) and not _HTML_SNIFF.search(raw):
                    candidates = None
                else:
                    candidates = _parse_og_images(raw, str(response.url)) or None
    except ValueError:
        raise
    except Exception as exc:  # httpx.HTTPError + status != 2xx
        logger.debug("og:image indisponível para %s: %s", page_url, exc)
        candidates = None

    _cache_put(page_url, candidates)
    return candidates


async def fetch_og_image(page_url: str) -> Optional[str]:
    """Compat: primeira candidata de og:image do site (ou None)."""
    candidates = await _resolve_og_image_candidates(page_url)
    return candidates[0] if candidates else None


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Bytes redimensionados (o que o endpoint devolve)
# ---------------------------------------------------------------------------

# Google Places (New) media URL — mesmo padrão do proxy /places/photo
PLACES_API_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"

# url do site (ou chave 'place:<id>') -> (jpeg_bytes, expires_at)
_og_bytes_cache: dict[str, tuple[Tuple[bytes, str], float]] = {}


def _resize_to_card_jpeg(raw: bytes) -> Tuple[bytes, str]:
    """Converte a imagem original para JPEG thumbnail até 768px.

    Falha de decodificação (formato exótico/corrompido) propaga
    Exception — o chamador trata como "sem imagem" e tenta a próxima
    candidata.
    """
    with Image.open(io.BytesIO(raw)) as img:
        img = img.convert("RGB")  # JPEG não tem alpha; achata transparência
        img.thumbnail((OG_IMAGE_MAX_DIM, OG_IMAGE_MAX_DIM))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=OG_IMAGE_QUALITY, optimize=True)
        return out.getvalue(), "image/jpeg"


async def _download_bytes(url: str, timeout: float) -> Optional[bytes]:
    """Download com cap de bytes + 1 retry em falha transitória.

    ValueError (URL inválida/rede interna do SSRF guard) propaga sem
    retry — nunca re-tentamos um destino que o guard bloqueou.
    O content-type NÃO é validado: quem decide é o decodificador.
    """
    for attempt in range(DOWNLOAD_ATTEMPTS):
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=timeout,
                event_hooks={"request": [_validate_image_request_hook]},
                headers={"User-Agent": "ConciergeCollector/1.0 (+https://concierge-collector.onrender.com)"},
            ) as client:
                async with client.stream("GET", url) as response:
                    response.raise_for_status()
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > MAX_IMAGE_BYTES:
                            return None  # "imagem monstro" — acima do cap
                        chunks.append(chunk)
                    return b"".join(chunks)
        except ValueError:
            raise
        except Exception as exc:
            logger.debug("download (tentativa %d/%d) falhou para %s: %s", attempt + 1, DOWNLOAD_ATTEMPTS, url, exc)
            if attempt + 1 < DOWNLOAD_ATTEMPTS:
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
    return None


async def _places_photo_bytes(place_id: str) -> Optional[Tuple[bytes, str]]:
    """Fallback de cobertura: primeira foto do Google Places do lugar.

    Muitos sites de restaurantes não têm og:image (~metade do acervo) —
    as entities bulk têm place_id, então a foto do Places preenche o
    véu quando o site não tem. Metadata via LLMPlaceService (chave
    server-side) → media bytes direto do Google (skipHttpRedirect,
    SSRF-guarded como os outros downloads) → resize. Falha em qualquer
    etapa = None (card sem véu, como antes).
    """
    if not settings.google_places_api_key:
        return None
    try:
        from app.services.llm_place_service import LLMPlaceService

        photos = LLMPlaceService().fetch_google_place_photos(place_id, max_photos=1) or []
    except Exception as exc:
        logger.debug("Places photos metadata falhou para %s: %s", place_id, exc)
        return None

    for photo in photos:
        name = photo.get("name") if isinstance(photo, dict) else None
        if not name or not name.startswith("places/"):
            continue
        # SEM skipHttpRedirect: a API responde 302 para o CDN do Google
        # (URL já com a largura aplicada) e o httpx segue o redirect
        # (follow_redirects=True) — o skipHttpRedirect=true devolvia
        # JSON-eco em vez dos bytes com a chave atual.
        media_url = PLACES_API_PHOTO_MEDIA_URL.format(photo_name=name)
        media_url += f"?key={settings.google_places_api_key}&maxWidthPx={OG_IMAGE_MAX_DIM}"
        raw = await _download_bytes(media_url, IMAGE_FETCH_TIMEOUT_SECONDS)
        if raw is None:
            continue
        try:
            return _resize_to_card_jpeg(raw)
        except Exception as exc:
            logger.debug("foto do Places indecodificável %s: %s", name, exc)
            continue
    return None


async def get_og_image_bytes(
    page_url: Optional[str] = None,
    place_id: Optional[str] = None,
) -> Optional[Tuple[bytes, str]]:
    """Devolve (bytes JPEG redimensionados, content_type) ou None.

    Pipeline real-time em cascata: HTML do site → candidatas de imagem
    → download de cada candidata até uma decodificar → resize; SEM
    resultado e com place_id, cai para a primeira foto do Google Places.
    ValueError para URL inválida/credenciais/rede interna; None para
    nenhuma fonte utilizável (card fica sem véu).
    """
    has_url = isinstance(page_url, str) and page_url.strip()
    has_place = isinstance(place_id, str) and place_id.strip()
    if not has_url and not has_place:
        raise ValueError("url ou place_id é obrigatória")

    # chave de cache: url do site quando existe; senão o lugar
    cache_key = page_url if has_url else f"place:{place_id}"

    now = time.monotonic()
    hit = _og_bytes_cache.get(cache_key)
    if hit and hit[1] >= now:
        return hit[0]
    if hit:
        _og_bytes_cache.pop(cache_key, None)

    result: Optional[Tuple[bytes, str]] = None

    if has_url:
        candidates = await _resolve_og_image_candidates(page_url)
        if candidates:
            for image_url in candidates:
                raw = await _download_bytes(image_url, IMAGE_FETCH_TIMEOUT_SECONDS)
                if raw is None:
                    continue
                try:
                    result = _resize_to_card_jpeg(raw)
                except Exception as exc:
                    logger.debug("candidata indecodificável %s para %s: %s", image_url, page_url, exc)
                    continue
                break

    if result is None and has_place:
        result = await _places_photo_bytes(place_id)

    if result is not None:
        if len(_og_bytes_cache) >= OG_BYTES_CACHE_MAX_ENTRIES:
            _og_bytes_cache.clear()
        _og_bytes_cache[cache_key] = (result, time.monotonic() + OG_CACHE_TTL_SECONDS)
    return result
