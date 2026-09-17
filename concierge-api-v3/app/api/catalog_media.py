"""Entity image bytes on the CMS boundary, for the Admin Media & sources view.

The Admin renders one Entity thumbnail, but it reaches this API with
``X-CMS-Service-Key`` instead of a curator session, so the curator-facing
``/entities/{id}/image`` routes are out of reach. These are the same two reads,
moved onto the ``/catalog/*`` boundary (service credential + live CMS admin
actor) — nothing else changes:

- the source chain is the ONE tolerant chain already in use
  (``display_media_service.extract_image_sources``: contact/contacts/website and
  place_id/google_place_id);
- the bytes come from the hardened pipeline already in use
  (``og_image_service``: ``_validate_image_request_hook`` SSRF guard on every
  request of the redirect chain, byte cap, and the JPEG reencode) — there is no
  second downloader here, and the caller supplies only an Entity id and a rank,
  never a URL. Rank 0 serves the display media persisted on the Entity, so the
  discovery is not repeated per render; ranks 1..7 use the ranked collector.

The gallery lists boundary paths, not origin URLs, so the Admin's ``<img>``
points at its own BFF and no provider key can leak through the markup.
"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from pymongo.database import Database

from app.api.entities import find_entity
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
from app.services.display_media_service import (
    IMAGE_MISSING_DETAIL,
    NO_SOURCES_CACHE_CONTROL,
    NO_SOURCES_DETAIL,
    PENDING_CACHE_CONTROL,
    STATE_NO_SOURCES,
    extract_image_sources,
    read_hero_media,
)
from app.services.og_image_service import get_restaurant_image_bytes, get_restaurant_images

router = APIRouter(prefix="/catalog", tags=["cms-catalog"])


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
    website, place_id = extract_image_sources(entity)
    if not website and not place_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=NO_SOURCES_DETAIL,
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

    Rank 0 (the thumbnail the Admin renders) serves the Entity's persisted
    display media — the resolution that used to be redone on every render is now
    a stored fact, and this route only fetches the opaque reference it stored.
    With no fresh fact the response is a short-cached 404 and the enrichment is
    scheduled in the background, never awaited.

    Ranks 1..7 keep the ranked collector path: the gallery is on demand and the
    pipeline already caches its catalog in memory.
    """
    require_current_cms_admin(db, _actor(actor_id))

    if rank == 0:
        entity = find_entity(db, entity_id)
        if entity is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Entity {entity_id} not found")
        read = await read_hero_media(db.entities, entity)
        if read.image is not None:
            image_data, content_type = read.image
            return Response(
                content=image_data,
                media_type=content_type,
                headers={"Cache-Control": f"private, max-age={ENTITY_IMAGE_CACHE_TTL_SECONDS}"},
            )
        if read.state == STATE_NO_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=NO_SOURCES_DETAIL,
                headers={"Cache-Control": NO_SOURCES_CACHE_CONTROL},
            )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=IMAGE_MISSING_DETAIL,
            headers={"Cache-Control": PENDING_CACHE_CONTROL},
        )

    website, place_id = _image_sources(db, entity_id)

    try:
        image = await get_restaurant_image_bytes(page_url=website, place_id=place_id, rank=rank)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=IMAGE_MISSING_DETAIL)

    image_data, content_type = image
    return Response(
        content=image_data,
        media_type=content_type,
        headers={"Cache-Control": f"private, max-age={ENTITY_IMAGE_CACHE_TTL_SECONDS}"},
    )
