"""
Restaurant image resolution and ranked collection.

Legacy callers still receive one resized JPEG through `get_og_image_bytes`.
Internally the service now discovers multiple website candidates, optionally
adds Google Places photos, validates them through the existing SSRF-safe
network boundary, scores/deduplicates the decoded images and caches the ranked
catalog in memory.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
import logging
import re
import time
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit

import httpx

from app.core.config import settings
from app.services.openai_service import _validate_image_request_hook
from app.services.restaurant_image_collection_service import collect_candidates
from app.services.restaurant_image_collector import (
    CollectedImage,
    ImageCandidate,
    prepare_image,
    rank_and_dedupe,
)
from app.services.restaurant_image_discovery import discover_image_urls

logger = logging.getLogger(__name__)


def _safe_log_url(url: str) -> str:
    """Strip query/fragment so signed URLs and API keys never reach logs."""
    try:
        parts = urlsplit(url)
        if not parts.scheme or not parts.netloc:
            return "<redacted-url>"
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    except Exception:
        return "<redacted-url>"


MAX_HTML_BYTES = 400 * 1024
FETCH_TIMEOUT_SECONDS = 6.0
IMAGE_FETCH_TIMEOUT_SECONDS = 30.0
MAX_IMAGE_BYTES = 20 * 1024 * 1024
OG_CACHE_TTL_SECONDS = 3600
OG_MISS_TTL_SECONDS = 600
OG_CACHE_MAX_ENTRIES = 2000
DOWNLOAD_ATTEMPTS = 2
RETRY_BACKOFF_SECONDS = 0.4

OG_IMAGE_MAX_DIM = 768
OG_IMAGE_QUALITY = 82
OG_BYTES_CACHE_MAX_ENTRIES = 300
CARD_IMAGE_MIN_DIM = 100
CARD_IMAGE_MAX_ASPECT = 3.5

COLLECTOR_MAX_IMAGES = 8
COLLECTOR_WEBSITE_CANDIDATES = 8
COLLECTOR_PLACES_CANDIDATES = 5
COLLECTOR_MAX_CONCURRENCY = 4
COLLECTOR_CACHE_MAX_ENTRIES = 300
SITE_HERO_CONFIDENCE_SCORE = 55.0

_HTML_SNIFF = re.compile(rb"<(html|head|meta|body|!doctype)\b", re.I)

# page URL -> (candidate URLs or None, expires_at)
_og_cache: "OrderedDict[str, tuple[Optional[List[str]], float]]" = OrderedDict()


def _cache_get(url: str) -> Optional[tuple[Optional[List[str]], float]]:
    now = time.monotonic()
    for key in [key for key, (_, expires_at) in _og_cache.items() if expires_at < now]:
        _og_cache.pop(key, None)
    hit = _og_cache.get(url)
    if hit and hit[1] >= now:
        _og_cache.move_to_end(url)
        return hit
    if hit:
        _og_cache.pop(url, None)
    return None


def _cache_put(url: str, candidates: Optional[List[str]]) -> None:
    if url in _og_cache:
        _og_cache.pop(url, None)
    while len(_og_cache) >= OG_CACHE_MAX_ENTRIES:
        _og_cache.popitem(last=False)
    ttl = OG_CACHE_TTL_SECONDS if candidates else OG_MISS_TTL_SECONDS
    _og_cache[url] = (candidates, time.monotonic() + ttl)


def _parse_og_images(raw: bytes, final_url: str) -> List[str]:
    """Compatibility parser; returned values remain string-compatible."""
    return discover_image_urls(raw, final_url)


def _parse_og_image(raw: bytes, final_url: str) -> Optional[str]:
    candidates = _parse_og_images(raw, final_url)
    return candidates[0] if candidates else None


async def _resolve_og_image_candidates(page_url: str) -> Optional[List[str]]:
    if not isinstance(page_url, str) or not page_url.strip():
        raise ValueError("url é obrigatória")

    cached = _cache_get(page_url)
    if cached:
        return cached[0]

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=FETCH_TIMEOUT_SECONDS,
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

                not_html_header = content_type and not content_type.startswith(("text/html", "application/xhtml"))
                if not_html_header and not _HTML_SNIFF.search(raw):
                    candidates = None
                else:
                    candidates = _parse_og_images(raw, str(response.url)) or None
    except ValueError:
        raise
    except Exception as exc:
        logger.debug("og:image indisponível para %s: %s", _safe_log_url(page_url), exc)
        candidates = None

    _cache_put(page_url, candidates)
    return candidates


async def fetch_og_image(page_url: str) -> Optional[str]:
    candidates = await _resolve_og_image_candidates(page_url)
    return candidates[0] if candidates else None


PLACES_API_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"

# Legacy final-JPEG cache: cache key -> ((bytes, content_type), expires_at)
_og_bytes_cache: "OrderedDict[str, tuple[Tuple[bytes, str], float]]" = OrderedDict()


def _resize_to_card_jpeg(raw: bytes) -> Tuple[bytes, str]:
    """Legacy resize API backed by the same validation as the collector."""
    image = prepare_image(
        raw,
        ImageCandidate("https://legacy.local/image", "website_og", 0),
        max_dim=OG_IMAGE_MAX_DIM,
        quality=OG_IMAGE_QUALITY,
        min_dim=CARD_IMAGE_MIN_DIM,
        max_aspect=CARD_IMAGE_MAX_ASPECT,
    )
    return image.jpeg_bytes, "image/jpeg"


async def _download_bytes(url: str, timeout: float) -> Optional[bytes]:
    """Download with byte cap and one transient retry; SSRF ValueError propagates."""
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
                            return None
                        chunks.append(chunk)
                    return b"".join(chunks)
        except ValueError:
            raise
        except Exception as exc:
            logger.debug(
                "download (tentativa %d/%d) falhou para %s: %s",
                attempt + 1,
                DOWNLOAD_ATTEMPTS,
                _safe_log_url(url),
                exc,
            )
            if attempt + 1 < DOWNLOAD_ATTEMPTS:
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))
    return None


async def _places_image_candidates(
    place_id: str,
    max_photos: int = COLLECTOR_PLACES_CANDIDATES,
) -> List[ImageCandidate]:
    """Resolve Google Places photo metadata without exposing the API key to clients."""
    if not settings.google_places_api_key:
        return []
    try:
        from app.services.llm_place_service import LLMPlaceService

        service = LLMPlaceService()
        photos = (
            await asyncio.to_thread(service.fetch_google_place_photos, place_id, max_photos=max_photos)
            or []
        )
    except Exception as exc:
        logger.debug("Places photos metadata falhou para %s: %s", place_id, exc)
        return []

    candidates: List[ImageCandidate] = []
    for photo in photos:
        name = photo.get("name") if isinstance(photo, dict) else None
        if not name or not name.startswith("places/"):
            continue
        media_url = PLACES_API_PHOTO_MEDIA_URL.format(photo_name=name)
        media_url += f"?key={settings.google_places_api_key}&maxWidthPx={OG_IMAGE_MAX_DIM}"
        candidates.append(ImageCandidate(media_url, "google_places", len(candidates)))
        if len(candidates) >= max_photos:
            break
    return candidates


async def _places_photo_bytes(place_id: str) -> Optional[Tuple[bytes, str]]:
    """Legacy helper: first valid ranked Places image."""
    candidates = await _places_image_candidates(place_id, max_photos=1)
    if not candidates:
        return None

    async def downloader(candidate: ImageCandidate) -> Optional[bytes]:
        return await _download_bytes(candidate.url, IMAGE_FETCH_TIMEOUT_SECONDS)

    result = await collect_candidates(
        candidates,
        downloader,
        limit=1,
        max_concurrency=1,
        max_dim=OG_IMAGE_MAX_DIM,
        quality=OG_IMAGE_QUALITY,
        min_dim=CARD_IMAGE_MIN_DIM,
        max_aspect=CARD_IMAGE_MAX_ASPECT,
    )
    if not result.images:
        return None
    return result.images[0].jpeg_bytes, "image/jpeg"


# Legacy metrics contract: do not add/remove keys here; callers/tests rely on it.
_og_stats: Dict[str, int] = {
    "requests": 0,
    "cache_hits_bytes": 0,
    "source_og": 0,
    "source_places": 0,
    "no_image": 0,
}

_collector_stats: Dict[str, int] = {
    "requests": 0,
    "cache_hits": 0,
    "candidates_discovered": 0,
    "candidates_accepted": 0,
    "candidates_rejected": 0,
    "duplicates_removed": 0,
    "selected_website": 0,
    "selected_places": 0,
}


def get_og_stats() -> Dict[str, int]:
    return dict(_og_stats)


def get_image_collector_stats() -> Dict[str, int]:
    return dict(_collector_stats)


# (page URL + place id + hero/gallery mode) -> (ranked images, expires_at)
_image_catalog_cache: "OrderedDict[str, tuple[List[CollectedImage], float]]" = OrderedDict()


def _catalog_key(page_url: Optional[str], place_id: Optional[str], gallery: bool) -> str:
    return f"{(page_url or '').strip()}|{(place_id or '').strip()}|{'gallery' if gallery else 'hero'}"


def _catalog_cache_get(key: str) -> Optional[List[CollectedImage]]:
    now = time.monotonic()
    hit = _image_catalog_cache.get(key)
    if not hit:
        return None
    if hit[1] < now:
        _image_catalog_cache.pop(key, None)
        return None
    _image_catalog_cache.move_to_end(key)
    return hit[0]


def _catalog_cache_put(key: str, images: List[CollectedImage]) -> None:
    if key in _image_catalog_cache:
        _image_catalog_cache.pop(key, None)
    while len(_image_catalog_cache) >= COLLECTOR_CACHE_MAX_ENTRIES:
        _image_catalog_cache.popitem(last=False)
    ttl = OG_CACHE_TTL_SECONDS if images else OG_MISS_TTL_SECONDS
    _image_catalog_cache[key] = (images, time.monotonic() + ttl)


async def _collect_candidate_group(candidates: List[ImageCandidate]):
    if not candidates:
        return None

    async def downloader(candidate: ImageCandidate) -> Optional[bytes]:
        return await _download_bytes(candidate.url, IMAGE_FETCH_TIMEOUT_SECONDS)

    return await collect_candidates(
        candidates,
        downloader,
        limit=max(len(candidates), 1),
        max_concurrency=COLLECTOR_MAX_CONCURRENCY,
        max_dim=OG_IMAGE_MAX_DIM,
        quality=OG_IMAGE_QUALITY,
        min_dim=CARD_IMAGE_MIN_DIM,
        max_aspect=CARD_IMAGE_MAX_ASPECT,
    )


async def get_restaurant_images(
    page_url: Optional[str] = None,
    place_id: Optional[str] = None,
    *,
    limit: int = COLLECTOR_MAX_IMAGES,
) -> List[CollectedImage]:
    """Return ranked restaurant images from website + Google Places.

    Hero mode validates the highest-priority structured candidate first so a
    confident OG image remains a one-download fast path. Gallery mode always
    merges Places candidates so the result is diverse and not tied to HTML
    order.
    """
    has_url = isinstance(page_url, str) and bool(page_url.strip())
    has_place = isinstance(place_id, str) and bool(place_id.strip())
    if not has_url and not has_place:
        raise ValueError("url ou place_id é obrigatória")

    requested_limit = max(1, min(int(limit), COLLECTOR_MAX_IMAGES))
    gallery = requested_limit > 1
    cache_key = _catalog_key(page_url if has_url else None, place_id if has_place else None, gallery)
    cached = _catalog_cache_get(cache_key)
    if cached is not None:
        _collector_stats["cache_hits"] += 1
        return cached[:requested_limit]

    _collector_stats["requests"] += 1
    target_limit = COLLECTOR_MAX_IMAGES if gallery else 1

    website_candidates: List[ImageCandidate] = []
    if has_url:
        urls = await _resolve_og_image_candidates(page_url)
        for index, url in enumerate((urls or [])[:COLLECTOR_WEBSITE_CANDIDATES]):
            website_candidates.append(
                ImageCandidate(
                    str(url),
                    getattr(url, "source", "website"),
                    getattr(url, "source_index", index),
                )
            )

    website_results = []
    website_images: List[CollectedImage] = []

    # Fast path for the common card/hero request: validate the highest-priority
    # structured candidate first. A confident OG image should cost one image
    # download, not a full crawl of every candidate on the page.
    remaining_website_candidates = website_candidates
    if not gallery and website_candidates:
        primary_result = await _collect_candidate_group(website_candidates[:1])
        if primary_result:
            website_results.append(primary_result)
            website_images.extend(primary_result.images)
        if website_images and website_images[0].score >= SITE_HERO_CONFIDENCE_SCORE:
            for result in website_results:
                _collector_stats["candidates_discovered"] += result.discovered
                _collector_stats["candidates_accepted"] += result.accepted
                _collector_stats["candidates_rejected"] += result.rejected
                _collector_stats["duplicates_removed"] += result.duplicates_removed
            _collector_stats["selected_website"] += 1
            ranked = website_images[:1]
            _catalog_cache_put(cache_key, ranked)
            return ranked
        remaining_website_candidates = website_candidates[1:]

    website_result = await _collect_candidate_group(remaining_website_candidates)
    if website_result:
        website_results.append(website_result)
        website_images.extend(website_result.images)

    should_fetch_places = has_place and (
        gallery or not website_images or max(image.score for image in website_images) < SITE_HERO_CONFIDENCE_SCORE
    )
    places_candidates: List[ImageCandidate] = []
    if should_fetch_places:
        raw_places = await _places_image_candidates(place_id, max_photos=COLLECTOR_PLACES_CANDIDATES)
        offset = len(website_candidates)
        places_candidates = [
            ImageCandidate(candidate.url, candidate.source, offset + index)
            for index, candidate in enumerate(raw_places)
        ]
    places_result = await _collect_candidate_group(places_candidates)
    places_images = places_result.images if places_result else []

    combined = website_images + places_images
    unique = rank_and_dedupe(combined, limit=max(len(combined), 1)) if combined else []
    cross_duplicates = len(combined) - len(unique)
    ranked = unique[:target_limit]

    for result in [*website_results, places_result]:
        if result:
            _collector_stats["candidates_discovered"] += result.discovered
            _collector_stats["candidates_accepted"] += result.accepted
            _collector_stats["candidates_rejected"] += result.rejected
            _collector_stats["duplicates_removed"] += result.duplicates_removed
    _collector_stats["duplicates_removed"] += cross_duplicates
    if ranked:
        if ranked[0].source == "google_places":
            _collector_stats["selected_places"] += 1
        else:
            _collector_stats["selected_website"] += 1

    _catalog_cache_put(cache_key, ranked)
    return ranked[:requested_limit]


async def get_restaurant_image_bytes(
    page_url: Optional[str] = None,
    place_id: Optional[str] = None,
    *,
    rank: int = 0,
) -> Optional[Tuple[bytes, str]]:
    """Return one ranked JPEG by gallery rank without exposing origin URLs."""
    if rank < 0 or rank >= COLLECTOR_MAX_IMAGES:
        return None
    images = await get_restaurant_images(page_url, place_id, limit=max(rank + 1, 1))
    if rank >= len(images):
        return None
    return images[rank].jpeg_bytes, "image/jpeg"


def _bytes_cache_put(key: str, result: Tuple[bytes, str]) -> None:
    if key in _og_bytes_cache:
        _og_bytes_cache.pop(key, None)
    while len(_og_bytes_cache) >= OG_BYTES_CACHE_MAX_ENTRIES:
        _og_bytes_cache.popitem(last=False)
    _og_bytes_cache[key] = (result, time.monotonic() + OG_CACHE_TTL_SECONDS)


async def get_og_image_bytes(
    page_url: Optional[str] = None,
    place_id: Optional[str] = None,
) -> Optional[Tuple[bytes, str]]:
    """Legacy best-image API, now backed by the ranked collector."""
    has_url = isinstance(page_url, str) and bool(page_url.strip())
    has_place = isinstance(place_id, str) and bool(place_id.strip())
    if not has_url and not has_place:
        raise ValueError("url ou place_id é obrigatória")

    cache_key = page_url if has_url else f"place:{place_id}"
    now = time.monotonic()
    hit = _og_bytes_cache.get(cache_key)
    if hit and hit[1] >= now:
        _og_bytes_cache.move_to_end(cache_key)
        _og_stats["cache_hits_bytes"] += 1
        return hit[0]
    if hit:
        _og_bytes_cache.pop(cache_key, None)

    _og_stats["requests"] += 1
    images = await get_restaurant_images(page_url if has_url else None, place_id if has_place else None, limit=1)
    if not images:
        _og_stats["no_image"] += 1
        return None

    selected = images[0]
    result = (selected.jpeg_bytes, "image/jpeg")
    _bytes_cache_put(cache_key, result)
    if selected.source == "google_places":
        _og_stats["source_places"] += 1
    else:
        _og_stats["source_og"] += 1
    return result
