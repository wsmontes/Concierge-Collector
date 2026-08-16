"""
Deterministic ranking primitives for restaurant image collection.

This module is intentionally network-agnostic: discovery/download remain in
og_image_service so its SSRF guard, retry policy and byte caps stay the single
network boundary. Here we validate decoded images, create card JPEGs, score
candidates and remove visual duplicates.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import io
import math
from typing import Dict, Iterable, List
from urllib.parse import urlsplit

from PIL import Image, ImageStat


SOURCE_WEIGHTS: Dict[str, float] = {
    "website_og": 40.0,
    "google_places": 38.0,
    "website_twitter": 34.0,
    "website_schema": 32.0,
    "website_jsonld": 30.0,
    "website_img": 20.0,
    "website": 24.0,
}

NEGATIVE_URL_MARKERS = (
    "logo",
    "icon",
    "banner",
    "header",
    "footer",
    "placeholder",
    "sprite",
    "avatar",
    "default-image",
)
POSITIVE_URL_MARKERS = (
    "hero",
    "gallery",
    "food",
    "dish",
    "interior",
    "restaurant",
    "dining",
    "menu-item",
)


@dataclass(frozen=True)
class ImageCandidate:
    """A discovered image before download/validation."""

    url: str
    source: str
    source_index: int = 0


@dataclass
class CollectedImage:
    """A validated, ranked image safe to proxy to clients."""

    jpeg_bytes: bytes
    source: str
    width: int
    height: int
    byte_size: int
    score: float
    score_components: Dict[str, float] = field(default_factory=dict)
    perceptual_hash: int = 0
    source_index: int = 0

    @property
    def aspect_ratio(self) -> float:
        return self.width / self.height if self.height else 0.0

    def public_metadata(self, rank: int, image_url: str) -> dict:
        return {
            "rank": rank,
            "source": self.source,
            "width": self.width,
            "height": self.height,
            "aspect_ratio": round(self.aspect_ratio, 3),
            "score": round(self.score, 2),
            "score_components": {k: round(v, 2) for k, v in self.score_components.items()},
            "image_url": image_url,
        }


def _dhash(img: Image.Image) -> int:
    """64-bit difference hash; robust enough to collapse CDN/resized copies."""
    gray = img.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(gray.get_flattened_data())
    value = 0
    for row in range(8):
        offset = row * 9
        for col in range(8):
            value = (value << 1) | int(pixels[offset + col] > pixels[offset + col + 1])
    return value


def _hamming_distance(left: int, right: int) -> int:
    return (left ^ right).bit_count()


def _score_candidate(candidate: ImageCandidate, img: Image.Image) -> tuple[float, Dict[str, float]]:
    width, height = img.size
    aspect = width / height

    source_score = SOURCE_WEIGHTS.get(candidate.source, 18.0)
    source_order = -min(max(candidate.source_index, 0), 20) * 0.35

    megapixels = (width * height) / 1_000_000.0
    resolution = min(megapixels / 2.5, 1.0) * 18.0

    # Hero/card sweet spot is landscape around 3:2. Square remains usable;
    # very wide and portrait photos lose points but are not hard-rejected.
    aspect_distance = abs(math.log(max(aspect, 0.01) / 1.5))
    aspect_score = max(0.0, 14.0 - aspect_distance * 11.0)

    # Low-variance assets are commonly logos/placeholders. This is a small
    # signal only; source + dimensions remain more important.
    thumb = img.convert("L").resize((64, 64), Image.Resampling.BILINEAR)
    stddev = float(ImageStat.Stat(thumb).stddev[0])
    detail = min(stddev / 64.0, 1.0) * 8.0

    path = urlsplit(candidate.url).path.lower()
    url_signal = 0.0
    if any(marker in path for marker in NEGATIVE_URL_MARKERS):
        url_signal -= 24.0
    if any(marker in path for marker in POSITIVE_URL_MARKERS):
        url_signal += 3.0

    components = {
        "source": source_score,
        "source_order": source_order,
        "resolution": resolution,
        "aspect": aspect_score,
        "detail": detail,
        "url_signal": url_signal,
    }
    return sum(components.values()), components


def prepare_image(
    raw: bytes,
    candidate: ImageCandidate,
    *,
    max_dim: int = 768,
    quality: int = 82,
    min_dim: int = 100,
    max_aspect: float = 3.5,
) -> CollectedImage:
    """Validate/decode one candidate, produce the cached JPEG and its score."""
    with Image.open(io.BytesIO(raw)) as opened:
        opened.load()
        width, height = opened.size
        if min(width, height) < min_dim or max(width, height) / min(width, height) > max_aspect:
            raise ValueError(f"imagem fora do gate do card: {width}x{height}")

        rgb = opened.convert("RGB")
        score, components = _score_candidate(candidate, rgb)
        perceptual_hash = _dhash(rgb)

        output = rgb.copy()
        output.thumbnail((max_dim, max_dim))
        out = io.BytesIO()
        output.save(out, format="JPEG", quality=quality, optimize=True)
        jpeg = out.getvalue()

    return CollectedImage(
        jpeg_bytes=jpeg,
        source=candidate.source,
        width=width,
        height=height,
        byte_size=len(raw),
        score=score,
        score_components=components,
        perceptual_hash=perceptual_hash,
        source_index=candidate.source_index,
    )


def rank_and_dedupe(
    images: Iterable[CollectedImage],
    *,
    limit: int = 8,
    duplicate_distance: int = 5,
) -> List[CollectedImage]:
    """Sort by quality and remove exact/near visual duplicates."""
    ranked = sorted(images, key=lambda image: (-image.score, image.source_index, image.source))
    selected: List[CollectedImage] = []
    for image in ranked:
        if any(
            _hamming_distance(image.perceptual_hash, kept.perceptual_hash) <= duplicate_distance
            for kept in selected
        ):
            continue
        selected.append(image)
        if len(selected) >= limit:
            break
    return selected
