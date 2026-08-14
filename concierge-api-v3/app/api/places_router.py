"""
File: places_router.py
Purpose: REST endpoints for Google Places data (photos, details, etc.)
Dependencies: fastapi, app.services.llm_place_service, app.core.rate_limit
Last Updated: November 22, 2025

Provides direct REST access to Google Places data without LLM context.

Segurança: a chave da API Google NUNCA sai do servidor — as URLs de foto
retornadas apontam para o proxy interno GET /places/photo, que adiciona a
chave server-side e responde 302 para o Google (o <img> segue o redirect).
"""

import logging
import re
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Depends, Query, Request
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.security import verify_auth
from app.services.llm_place_service import LLMPlaceService
from app.core.database import get_database

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/places", tags=["places"])

# Google Places (New) media URL — a chave é anexada AQUI, no servidor
PLACES_API_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"

# Formato de um photo resource name da Google: places/<id>/photos/<id>
_PHOTO_REFERENCE_RE = re.compile(r"^places/[A-Za-z0-9_\-]+/photos/[A-Za-z0-9_\-]+$")


def get_llm_service() -> LLMPlaceService:
    """Dependency to get LLMPlaceService instance"""
    return LLMPlaceService(database=get_database())


@router.get("/photo", include_in_schema=True)
@limiter.limit("60/minute")
async def proxy_place_photo(
    request: Request,
    reference: str = Query(
        ...,
        description="Google photo resource name (e.g., places/xxx/photos/yyy)",
    ),
    max_width: Optional[int] = Query(None, ge=400, le=4800, description="Maximum width in pixels (400-4800)"),
    max_height: Optional[int] = Query(None, ge=400, le=4800, description="Maximum height in pixels (400-4800)"),
    skip_http_redirect: bool = Query(False, description="Ask Google to return image bytes directly"),
):
    """
    Proxy de fotos do Google Places (sem autenticação de propósito).

    Sem autenticação: <img> tags não carregam headers, então o browser precisa
    de uma URL nua. O rate limit (60/min por IP) protege o custo/abuso. A chave
    da API é adicionada AQUI no servidor e o cliente recebe um 302 para o
    Google — a chave nunca aparece em URLs armazenadas, bundles ou payloads;
    só existe transitoriamente no Location do 302 (impossível em redirect
    server-side; o <img> segue e a chave nunca vira artefato persistido).
    """
    # Validar formato ANTES de montar a URL — o reference vai para o path da
    # URL do Google; sem a validação seria um open-redirect com a chave anexada.
    if not _PHOTO_REFERENCE_RE.fullmatch(reference):
        raise HTTPException(
            status_code=400,
            detail="Invalid photo reference (expected places/<id>/photos/<id>)",
        )

    params = [("key", settings.google_places_api_key)]
    # A API moderna do Google REJEITA a URL sem dimensão ('At least one of
    # max_height_px or max_width_px must be specified') — sem default o alvo
    # do 302 sempre 400, quebrando <img> no browser e downloads server-side.
    if not max_width and not max_height:
        max_width = 1200
    if max_width:
        params.append(("maxWidthPx", max_width))
    if max_height:
        params.append(("maxHeightPx", max_height))
    if skip_http_redirect:
        params.append(("skipHttpRedirect", "true"))

    media_url = PLACES_API_PHOTO_MEDIA_URL.format(photo_name=reference)
    return RedirectResponse(url=f"{media_url}?{urlencode(params)}", status_code=302)


@router.get("/{place_id}/photos")
@limiter.limit("20/minute")
async def get_place_photos(
    request: Request,
    place_id: str,
    max_photos: int = Query(10, ge=1, le=10, description="Maximum number of photos (1-10)"),
    max_width: Optional[int] = Query(None, ge=400, le=4800, description="Maximum width in pixels (400-4800)"),
    max_height: Optional[int] = Query(None, ge=400, le=4800, description="Maximum height in pixels (400-4800)"),
    include_metadata: bool = Query(True, description="Include original dimensions and attributions"),
    language: str = Query("pt-BR", description="Language code for attributions"),
    service: LLMPlaceService = Depends(get_llm_service),
    auth: dict = Depends(verify_auth),
):
    """
    Get restaurant photos from Google Places.

    **Authentication Required:** `Authorization: Bearer <token>` OR `X-API-Key: <key>`

    Returns photo URLs and optional metadata (dimensions, attributions).
    Photos are automatically resized if max_width or max_height specified.
    As URLs apontam para o proxy interno /api/v3/places/photo (a chave da API
    Google nunca chega ao cliente).

    **Example:**
    ```
    GET /api/v3/places/ChIJxxx/photos?max_photos=5&max_width=800
    ```

    **Response:**
    ```json
    {
      "place_id": "ChIJxxx",
      "entity_id": "ent_xxx",
      "name": "Restaurant Name",
      "photos": [
        {
          "index": 0,
          "url": "https://<host>/api/v3/places/photo?reference=places%2Fxxx%2Fphotos%2Fyyy&maxWidthPx=800",
          "photo_reference": "places/xxx/photos/yyy",
          "width_px": 4032,
          "height_px": 3024,
          "attributions": ["Photographer Name"]
        }
      ],
      "total": 5,
      "max_width": 800,
      "max_height": null
    }
    ```
    """
    try:
        result = service.get_restaurant_photos(
            place_id=place_id,
            max_photos=max_photos,
            max_width=max_width,
            max_height=max_height,
            include_metadata=include_metadata,
            language=language,
            # URLs absolutas (o static site vive em outro domínio; URLs
            # relativas quebrariam <img> na página do concierge)
            base_url=str(request.base_url),
        )

        # Check for errors
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching photos for {place_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
