"""
Async orchestration for validating and ranking downloaded image candidates.

Network policy is injected through the downloader callback, so the caller
(og_image_service) remains responsible for SSRF protection, timeouts, retries
and byte caps.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable, List, Optional, Sequence

from app.services.restaurant_image_collector import (
    CollectedImage,
    ImageCandidate,
    prepare_image,
    rank_and_dedupe,
)


@dataclass
class CollectionResult:
    images: List[CollectedImage]
    discovered: int
    accepted: int
    rejected: int
    duplicates_removed: int


async def collect_candidates(
    candidates: Sequence[ImageCandidate],
    downloader: Callable[[ImageCandidate], Awaitable[Optional[bytes]]],
    *,
    limit: int = 8,
    max_concurrency: int = 4,
    max_dim: int = 768,
    quality: int = 82,
    min_dim: int = 100,
    max_aspect: float = 3.5,
) -> CollectionResult:
    """Download candidates concurrently, validate, rank and visually dedupe."""
    if limit < 1:
        return CollectionResult(images=[], discovered=len(candidates), accepted=0, rejected=0, duplicates_removed=0)

    semaphore = asyncio.Semaphore(max(1, max_concurrency))

    async def process(candidate: ImageCandidate) -> Optional[CollectedImage]:
        try:
            async with semaphore:
                raw = await downloader(candidate)
            if raw is None:
                return None
            return prepare_image(
                raw,
                candidate,
                max_dim=max_dim,
                quality=quality,
                min_dim=min_dim,
                max_aspect=max_aspect,
            )
        except ValueError:
            # SSRF ValueError should be handled before this layer by the
            # injected downloader. Decode/gate ValueError means rejection.
            return None
        except Exception:
            # One broken image must not fail the restaurant gallery.
            return None

    processed = await asyncio.gather(*(process(candidate) for candidate in candidates))
    accepted_images = [image for image in processed if image is not None]
    unique = rank_and_dedupe(accepted_images, limit=max(len(accepted_images), 1))
    duplicates_removed = len(accepted_images) - len(unique)
    return CollectionResult(
        images=unique[:limit],
        discovered=len(candidates),
        accepted=len(accepted_images),
        rejected=len(candidates) - len(accepted_images),
        duplicates_removed=duplicates_removed,
    )
