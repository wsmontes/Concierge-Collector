"""
HTML image discovery for restaurant websites.

Returns string-compatible URLs with provenance. Keeping URLs as a `str`
subclass preserves compatibility with the legacy og_image_service parser while
allowing the collector to score OpenGraph, Twitter, JSON-LD and body images
differently.
"""

from __future__ import annotations

import html as html_lib
import re
from typing import Iterable, List, Tuple
from urllib.parse import urljoin


class SourcedImageURL(str):
    """A URL that behaves exactly like str and also carries discovery origin."""

    source: str
    source_index: int

    def __new__(cls, value: str, source: str, source_index: int = 0):
        obj = str.__new__(cls, value)
        obj.source = source
        obj.source_index = source_index
        return obj


_META_PATTERN_GROUPS: List[Tuple[str, List[re.Pattern]]] = [
    (
        "website_og",
        [
            re.compile(rb'<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']', re.I),
            re.compile(rb'<meta[^>]+property=["\']og:image:secure_url["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*property=["\']og:image:secure_url["\']', re.I),
            re.compile(rb'<meta[^>]+property=["\']og:image:url["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*property=["\']og:image:url["\']', re.I),
        ],
    ),
    (
        "website_twitter",
        [
            re.compile(rb'<meta[^>]+(?:name|property)=["\']twitter:image["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:name|property)=["\']twitter:image["\']', re.I),
            re.compile(
                rb'<meta[^>]+(?:name|property)=["\']twitter:image:src["\'][^>]*content=["\']([^"\']+)["\']',
                re.I,
            ),
            re.compile(
                rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:name|property)=["\']twitter:image:src["\']',
                re.I,
            ),
        ],
    ),
    (
        "website_schema",
        [
            re.compile(rb'<link[^>]+rel=["\']image_src["\'][^>]*href=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+itemprop=["\']image["\'][^>]*content=["\']([^"\']+)["\']', re.I),
            re.compile(rb'<meta[^>]+content=["\']([^"\']+)["\'][^>]*itemprop=["\']image["\']', re.I),
        ],
    ),
]

_BASE_HREF = re.compile(rb'<base[^>]+href=["\']([^"\']+)["\']', re.I)
_LD_JSON_BLOCK = re.compile(rb'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
_LD_IMAGE_KEY = re.compile(rb'"image"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', re.I)
_MEDIA_TAG = re.compile(rb"<(?:img|source)\b[^>]*>", re.I)
_ATTR = re.compile(rb'([a-zA-Z0-9_-]+)\s*=\s*["\']([^"\']+)["\']', re.I)

_DECORATIVE_MARKERS = (
    "favicon",
    "sprite",
    "avatar",
    "emoji",
    "tracking",
    "spacer",
    "pixel.gif",
    "count.gif",
    "doubleclick",
    "analytics",
    "site-logo",
    "header-logo",
    "footer-logo",
    "nav-logo",
    "apple-touch-icon",
    "/icons/",
    "icon-",
)


def _is_decorative(url: str) -> bool:
    value = url.lower()
    return any(marker in value for marker in _DECORATIVE_MARKERS)


def _absolute(base_url: str, value: str) -> str | None:
    value = html_lib.unescape(value.strip())
    if not value or value.startswith(("data:", "blob:")):
        return None
    absolute = urljoin(base_url, value)
    if not absolute.startswith(("http://", "https://")):
        return None
    return absolute


def _best_srcset_value(value: str) -> str | None:
    """Choose the highest-resolution candidate from a srcset attribute."""
    best_url = None
    best_weight = -1.0
    for index, item in enumerate(value.split(",")):
        parts = item.strip().split()
        if not parts:
            continue
        url = parts[0]
        weight = float(index)
        if len(parts) > 1:
            descriptor = parts[-1].lower()
            try:
                if descriptor.endswith("w"):
                    weight = float(descriptor[:-1])
                elif descriptor.endswith("x"):
                    weight = float(descriptor[:-1]) * 10000.0
            except ValueError:
                pass
        if weight >= best_weight:
            best_url = url
            best_weight = weight
    return best_url


def _jsonld_urls(raw: bytes, base_url: str) -> Iterable[str]:
    for block in _LD_JSON_BLOCK.findall(raw):
        for match in _LD_IMAGE_KEY.finditer(block):
            value = match.group(1).decode("utf-8", errors="replace")
            value = html_lib.unescape(value.replace("\\/", "/")).strip()
            absolute = _absolute(base_url, value)
            if absolute:
                yield absolute


def _media_urls(raw: bytes, base_url: str) -> Iterable[str]:
    for tag in _MEDIA_TAG.findall(raw):
        attrs = {
            match.group(1).decode("ascii", errors="ignore").lower(): match.group(2).decode(
                "utf-8", errors="replace"
            )
            for match in _ATTR.finditer(tag)
        }
        value = None
        for attr_name in ("data-srcset", "srcset"):
            if attrs.get(attr_name):
                value = _best_srcset_value(attrs[attr_name])
                if value:
                    break
        if not value:
            value = next(
                (
                    attrs[name]
                    for name in ("data-lazy-src", "data-original", "data-src", "data-echo", "src")
                    if attrs.get(name)
                ),
                None,
            )
        if value:
            absolute = _absolute(base_url, value)
            if absolute:
                yield absolute


def discover_image_urls(
    raw: bytes,
    final_url: str,
    *,
    jsonld_cap: int = 5,
    body_cap: int = 10,
) -> List[SourcedImageURL]:
    """Discover candidate images in priority order with source provenance."""
    base_url = final_url
    base_match = _BASE_HREF.search(raw)
    if base_match:
        candidate = base_match.group(1).decode("utf-8", errors="replace")
        resolved = _absolute(final_url, candidate)
        if resolved:
            base_url = resolved

    discovered: List[tuple[str, str]] = []
    for source, patterns in _META_PATTERN_GROUPS:
        for pattern in patterns:
            for match in pattern.finditer(raw):
                value = match.group(1).decode("utf-8", errors="replace")
                absolute = _absolute(base_url, value)
                if absolute:
                    discovered.append((absolute, source))

    for url in list(_jsonld_urls(raw, base_url))[:jsonld_cap]:
        discovered.append((url, "website_jsonld"))
    for url in list(_media_urls(raw, base_url))[:body_cap]:
        discovered.append((url, "website_img"))

    seen: set[str] = set()
    result: List[SourcedImageURL] = []
    for url, source in discovered:
        if url in seen or _is_decorative(url):
            continue
        seen.add(url)
        result.append(SourcedImageURL(url, source, len(result)))
    return result
