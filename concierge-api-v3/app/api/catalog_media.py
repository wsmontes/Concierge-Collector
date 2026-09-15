"""Entity image bytes on the CMS boundary, for the Admin Media & sources view.

The Admin renders one Entity thumbnail, but it reaches this API with
``X-CMS-Service-Key`` instead of a curator session, so the curator-facing
``/entities/{id}/image`` routes are out of reach. These are the same two reads,
moved onto the ``/catalog/*`` boundary (service credential + live CMS admin
actor) — nothing else changes:

- the source chain is the ONE tolerant chain already in use
  (``entities._extract_image_sources``: contact/contacts/website and
  place_id/google_place_id);
- the bytes come from the hardened pipeline already in use
  (``og_image_service``: ``_validate_image_request_hook`` SSRF guard on every
  request of the redirect chain, byte cap, and the JPEG reencode) — there is no
  second downloader here, and the caller supplies only an Entity id and a rank,
  never a URL.

The gallery lists boundary paths, not origin URLs, so the Admin's ``<img>``
points at its own BFF and no provider key can leak through the markup.
"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from pymongo.database import Database

from app.api.entities import _extract_image_sources, find_entity
from app.core.database import get_database
from app.core.security import verify_cms_service
from app.models.catalog_media import (
    ENTITY_IMAGE_CACHE_TTL_SECONDS,
    ENTITY_IMAGE_MAX_RANK,
    ENTITY_IMAGES_MAX_ITEMS,
    EntityImageItem,
    EntityImagesResponse,
)
from app.services.catalog_service import require_current_cms_admin
from app.services.og_image_service import (
    get_og_image_bytes,
    get_restaurant_image_bytes,
    get_restaurant_images,
)

router = APIRouter(prefix="/catalog", tags=["cms-catalog"])

_NO_IMAGE_DETAIL = "imagem não encontrada (og:image e Places sem resultado)"


def _actor(actor_id: str | None) -> str:
    """The asserted CMS actor, resolved exactly as the sibling ``/catalog/*`` reads do."""
    if not actor_id or not actor_id.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="CMS actor is required")
    return actor_id.strip()


def _image_sources(db: Database, entity_id: str) -> tuple[str | None, str | None]:
    """The stored Entity's website/place_id — the only inputs the image chain takes.

    A stored Entity whose document has neither is not a missing image: it is an
    Entity with no source configured, and that is the 404 the Admin renders as
    its "no image" state.
    """
    entity = find_entity(db, entity_id)
    if entity is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Entity {entity_id} not found")
    website, place_id = _extract_image_sources(entity)
    if not website and not place_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="entity sem website nem place_id (sem fonte de imagem)",
        )
    return website, place_id


def _image_boundary_url(entity_id: str, rank: int) -> str:
    """The path on THIS boundary that serves the rank's bytes (never an origin URL)."""
    return f"/api/v3/catalog/entities/{quote(entity_id, safe='')}/image?rank={rank}"


@router.get("/entities/{entity_id}/images", response_model=EntityImagesResponse)
async def read_entity_images(
    entity_id: str,
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> EntityImagesResponse:
    """The ranked images of one Entity, ascending by rank, bounded by the ceiling.

    An Entity with sources but no usable image is an empty gallery, not an
    error: the Admin needs the honest "no image" state, not a failure it would
    have to guess about.
    """
    require_current_cms_admin(db, _actor(actor_id))
    website, place_id = _image_sources(db, entity_id)

    try:
        images = await get_restaurant_images(page_url=website, place_id=place_id, limit=ENTITY_IMAGES_MAX_ITEMS)
    except ValueError as exc:
        # The SSRF guard refused the stored source. Same client-visible error as
        # the curator-facing route — 400, not a 500 with the internals.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return EntityImagesResponse(
        items=[
            EntityImageItem(rank=rank, source=image.source, url=_image_boundary_url(entity_id, rank))
            for rank, image in enumerate(images[:ENTITY_IMAGES_MAX_ITEMS])
        ]
    )


@router.get("/entities/{entity_id}/image")
async def read_entity_image(
    entity_id: str,
    rank: int = Query(
        0,
        ge=0,
        le=ENTITY_IMAGE_MAX_RANK,
        description="Rank da imagem coletada; 0 é o hero que a listagem usa como thumbnail.",
    ),
    actor_id: str | None = Header(None, alias="X-CMS-Actor-Id"),
    _: None = Depends(verify_cms_service),
    db: Database = Depends(get_database),
) -> Response:
    """The reencoded JPEG of one ranked Entity image.

    Rank 0 keeps the hero path of the curator-facing route; ranks 1..7 use the
    ranked catalog. Both are the existing hardened paths — this route only
    changes which credential opens the door.
    """
    require_current_cms_admin(db, _actor(actor_id))
    website, place_id = _image_sources(db, entity_id)

    try:
        if rank == 0:
            image = await get_og_image_bytes(page_url=website, place_id=place_id)
        else:
            image = await get_restaurant_image_bytes(page_url=website, place_id=place_id, rank=rank)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NO_IMAGE_DETAIL)

    image_data, content_type = image
    return Response(
        content=image_data,
        media_type=content_type,
        headers={"Cache-Control": f"private, max-age={ENTITY_IMAGE_CACHE_TTL_SECONDS}"},
    )
