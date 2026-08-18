"""
File: places.py
Purpose: Google Places API (New) proxy endpoints
Dependencies: fastapi, httpx, app.core.config
Last Updated: November 17, 2025

This module provides secure proxy endpoints for Google Places API (New).
API keys are stored server-side, never exposed to frontend.
Uses the modern Places API (New) with HTTP requests.
"""

from fastapi import APIRouter, HTTPException, Query, Request, Depends
import re

from fastapi.responses import StreamingResponse

from app.services.llm_place_service import LLMPlaceService
from app.core.database import get_database

from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field
import httpx
import logging

from app.core.config import settings
from app.core.rate_limit import limiter
from app.core.security import verify_auth

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/places", tags=["places"])

# New Places API base URLs
PLACES_API_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
PLACES_API_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================


class PlaceResult(BaseModel):
    """Google Places API result (simplified)"""

    place_id: str
    name: str
    vicinity: Optional[str] = None
    rating: Optional[float] = None
    user_ratings_total: Optional[int] = None
    price_level: Optional[int] = None
    types: List[str] = []
    geometry: Dict[str, Any]
    business_status: Optional[str] = None
    opening_hours: Optional[Dict[str, Any]] = None
    photos: Optional[List[Dict[str, Any]]] = None


class NearbySearchResponse(BaseModel):
    """Response for nearby search"""

    results: List[PlaceResult]
    status: str
    error_message: Optional[str] = None
    next_page_token: Optional[str] = None


class PlaceDetailsResponse(BaseModel):
    """Response for place details"""

    result: Dict[str, Any]
    status: str
    error_message: Optional[str] = None


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================


def get_enhanced_field_mask(
    include_reviews: bool = False,
    include_photos: bool = True,
    detail_level: str = "standard",
    use_prefix: bool = False,
) -> str:
    """
    Build comprehensive field mask for Google Places API

    Based on 150+ most important fields from Google Places API (New).
    Controls billing by only requesting needed fields.

    Args:
        include_reviews: Include review details (higher cost)
        include_photos: Include photo metadata
        detail_level: "minimal", "standard", or "full" (controls billing cost)
        use_prefix: If True, prefix fields with 'places.' (for searchNearby/searchText)
                   If False, no prefix (for Place Details GET requests)

    Returns:
        Comma-separated field mask string
    """
    # Essential fields (always included) - SKU: Basic Data
    # CRITICAL: 'id' field must be explicitly requested in the field mask
    essential = [
        "id",  # Place ID - REQUIRED for frontend imports
        "displayName",  # The name of the place
        "formattedAddress",
        "location",
        "rating",
        "userRatingCount",
        "priceLevel",
        "types",
        "businessStatus",
    ]

    if detail_level == "minimal":
        all_fields = essential
        # Apply prefix if needed
        if use_prefix:
            all_fields = [f"places.{field}" for field in all_fields]
        return ",".join(all_fields)

    # Contact and web presence - SKU: Contact Data
    contact = ["websiteUri", "internationalPhoneNumber", "nationalPhoneNumber"]

    # Opening hours - SKU: Atmosphere Data
    hours = ["currentOpeningHours", "regularOpeningHours", "utcOffsetMinutes"]

    # Address components (detailed geocoding) - SKU: Basic Data
    address = ["shortFormattedAddress", "addressComponents", "plusCode"]

    # Basic attributes - SKU: Atmosphere Data
    basic_attributes = [
        "takeout",
        "delivery",
        "dineIn",
        "reservable",
        "goodForChildren",
        "goodForGroups",
    ]

    # Editorial content
    editorial = [
        "editorialSummary"
        # Removed: iconMaskBaseUri - deprecated in Places API (New)
    ]

    # Photos (if requested)
    photos = []
    if include_photos:
        photos = ["photos"]

    if detail_level == "standard":
        all_fields = essential + contact + hours + address + basic_attributes + editorial + photos
        # Apply prefix if needed
        if use_prefix:
            all_fields = [f"places.{field}" for field in all_fields]
        return ",".join(all_fields)

    # FULL DETAIL LEVEL - All 150+ fields

    # Food service attributes (restaurants) - SKU: Atmosphere Data
    food_service = [
        "servesBreakfast",
        "servesLunch",
        "servesDinner",
        "servesBrunch",
        "servesBeer",
        "servesWine",
    ]

    # Dietary and service options - SKU: Atmosphere Data
    dietary = ["servesVegetarianFood", "takeout", "delivery", "dineIn", "reservable"]

    # Amenities - SKU: Atmosphere Data
    amenities = [
        "outdoorSeating",
        "liveMusic",
        "allowsDogs",
        "goodForChildren",
        "goodForGroups",
        "accessibilityOptions",  # Renamed from wheelchairAccessibleEntrance
    ]

    # Parking - SKU: Atmosphere Data
    parking = ["parkingOptions"]

    # Payment options - SKU: Atmosphere Data
    payment = ["paymentOptions"]

    # Reviews (if requested - higher billing cost) - SKU: Reviews
    reviews = []
    if include_reviews:
        reviews = ["reviews"]

    # Attribution and metadata
    metadata = [
        "googleMapsUri"
        # Removed: attributions, url - not valid in Places API (New)
    ]

    # Combine all fields for full detail
    all_fields = (
        essential
        + contact
        + hours
        + address
        + food_service
        + dietary
        + amenities
        + parking
        + payment
        + editorial
        + photos
        + reviews
        + metadata
    )

    # Apply prefix if needed (searchNearby/searchText use 'places.' prefix)
    if use_prefix:
        all_fields = [f"places.{field}" for field in all_fields]

    return ",".join(all_fields)


# ============================================================================
# ENDPOINTS
# ============================================================================


@router.get("/nearby", response_model=NearbySearchResponse)
@limiter.limit("20/minute")
async def search_nearby(
    request: Request,
    latitude: float = Query(..., description="Latitude for search center"),
    longitude: float = Query(..., description="Longitude for search center"),
    radius: Optional[int] = Query(
        None,
        ge=1,
        le=50000,
        description="Search radius in meters (omit for worldwide with keyword)",
    ),
    place_type: Optional[str] = Query(None, description="Place type filter (restaurant, cafe, bar, bakery, food)"),
    keyword: Optional[str] = Query(None, description="Keyword search (enables Text Search if no radius)"),
    max_results: int = Query(20, ge=1, le=20, description="Maximum results to return"),
    language: Optional[str] = Query("pt-BR", description="Language code (e.g., pt-BR, en, es)"),
    region: Optional[str] = Query("BR", description="Region code (e.g., BR, US, ES)"),
    min_rating: Optional[float] = Query(None, ge=1.0, le=5.0, description="Minimum rating filter"),
    open_now: Optional[bool] = Query(None, description="Only return places that are open now"),
    price_levels: Optional[str] = Query(None, description="Comma-separated price levels (e.g., 'MODERATE,EXPENSIVE')"),
    auth: dict = Depends(verify_auth),  # Support both API key and JWT
):
    """
    Hybrid search endpoint: Nearby Search or Text Search

    **Authentication Required:** `Authorization: Bearer <token>` OR `X-API-Key: <key>`
    (o frontend anexa o Bearer; scripts usam X-API-Key)
    ...
    """
    try:
        # Validate API key
        if not settings.google_places_api_key or settings.google_places_api_key.strip() == "":
            raise HTTPException(status_code=500, detail="Google Places API key not configured on server")

        # Determine search mode: Text Search (worldwide) or Nearby Search
        use_text_search = keyword and not radius

        if use_text_search:
            logger.info(f"Text Search: keyword='{keyword}', type={place_type}, language={language}")
            return await _text_search(
                keyword=keyword,
                latitude=latitude,
                longitude=longitude,
                place_type=place_type,
                max_results=max_results,
                language=language,
                region=region,
                min_rating=min_rating,
                open_now=open_now,
                price_levels=price_levels,
            )
        else:
            # Default to nearby search
            if not radius:
                radius = 5000  # Default 5km
            logger.info(f"Nearby Search: lat={latitude}, lng={longitude}, radius={radius}, type={place_type}")
            return await _nearby_search(
                latitude=latitude,
                longitude=longitude,
                radius=radius,
                place_type=place_type,
                max_results=max_results,
                language=language,
                region=region,
                min_rating=min_rating,
                open_now=open_now,
                price_levels=price_levels,
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in search: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


async def _nearby_search(
    latitude: float,
    longitude: float,
    radius: int,
    place_type: Optional[str],
    max_results: int,
    language: Optional[str],
    region: Optional[str],
    min_rating: Optional[float],
    open_now: Optional[bool],
    price_levels: Optional[str],
) -> NearbySearchResponse:
    """Execute Nearby Search with Google Places API"""

    max_results = min(max_results, 20)

    # Build payload
    payload = {
        "maxResultCount": max_results,
        "locationRestriction": {
            "circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": radius,
            }
        },
        "languageCode": language or "pt-BR",
        "regionCode": region or "BR",
    }

    # Add type filter - default to food-related types if none specified
    if place_type:
        payload["includedTypes"] = [place_type]
        logger.info(f"🔍 Applying type filter: includedTypes=['{place_type}']")
    else:
        # Default to food-related types to avoid returning hotels, tourist attractions, etc.
        default_food_types = ["restaurant", "cafe", "bar", "bakery"]
        payload["includedTypes"] = default_food_types
        logger.info(f"🍽️ No type filter provided - defaulting to food types: {default_food_types}")

    # Add filters
    if min_rating:
        payload["minRating"] = min_rating

    if price_levels:
        levels = [f"PRICE_LEVEL_{level.strip().upper()}" for level in price_levels.split(",")]
        payload["priceLevels"] = levels

    logger.info(f"📤 Places API Payload: {payload}")

    # Headers with comprehensive field mask (100 most important fields)
    # Note: searchNearby requires 'places.' prefix for fields
    field_mask = get_enhanced_field_mask(
        include_reviews=False,
        include_photos=True,
        detail_level="standard",
        use_prefix=True,
    )
    logger.info(f"Field mask for nearby search: {field_mask[:200]}...")  # Log first 200 chars

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": field_mask,
    }

    # Make request
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(PLACES_API_NEARBY_URL, json=payload, headers=headers)

        if response.status_code != 200:
            error_text = response.text
            logger.error(f"Places API error: {response.status_code} - {error_text}")
            raise HTTPException(status_code=502, detail=f"Google Places API error: {error_text}")

        data = response.json()

    # Format results
    places = data.get("places", [])
    formatted_results = []

    # Debug: Log first place to check id field
    if places:
        logger.info(f"First place from Google API: {places[0]}")
        logger.info(f"First place 'id' field: {places[0].get('id', 'NOT FOUND')}")

    for place in places:
        # Apply openNow filter if requested (client-side since API doesn't support it directly in nearby)
        if open_now:
            opening_hours = place.get("currentOpeningHours", {})
            if not opening_hours.get("openNow", False):
                continue

        formatted_results.append(
            {
                "place_id": place.get("id", "").replace("places/", ""),
                "name": place.get("displayName", {}).get("text", ""),
                "vicinity": place.get("formattedAddress", ""),
                "rating": place.get("rating"),
                "user_ratings_total": place.get("userRatingCount"),
                "price_level": _convert_price_level(place.get("priceLevel")),
                "types": place.get("types", []),
                "geometry": {"location": place.get("location", {})},
                "business_status": place.get("businessStatus"),
                "opening_hours": place.get("currentOpeningHours"),
                "website": place.get("websiteUri"),
                "phone": place.get("internationalPhoneNumber"),
                "photos": None,  # Would need separate request
            }
        )

        # Debug: Log if place_id is missing
        if not place.get("id"):
            logger.warning(f"⚠️ Place missing 'id' field: {place.get('displayName', {}).get('text', 'Unknown')}")

    logger.info(f"Nearby Search found {len(formatted_results)} places")

    return NearbySearchResponse(
        results=formatted_results,
        status="OK" if formatted_results else "ZERO_RESULTS",
        error_message=None,
        next_page_token=data.get("nextPageToken"),
    )


async def _text_search(
    keyword: str,
    latitude: float,
    longitude: float,
    place_type: Optional[str],
    max_results: int,
    language: Optional[str],
    region: Optional[str],
    min_rating: Optional[float],
    open_now: Optional[bool],
    price_levels: Optional[str],
) -> NearbySearchResponse:
    """Execute Text Search with Google Places API (worldwide search)"""

    max_results = min(max_results, 20)

    # Build payload for Text Search
    payload = {
        "textQuery": keyword,
        "maxResultCount": max_results,
        "languageCode": language or "pt-BR",
        "regionCode": region or "BR",
        "locationBias": {
            "circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": 50000,  # 50km bias (not restriction)
            }
        },
    }

    # Add type filter - default to 'restaurant' if none specified
    # Note: Text Search API only supports a single includedType (not an array)
    if place_type:
        payload["includedType"] = place_type
    else:
        payload["includedType"] = "restaurant"
        logger.info("🍽️ No type filter provided for text search - defaulting to 'restaurant'")

    # Add filters
    if min_rating:
        payload["minRating"] = min_rating

    if open_now:
        payload["openNow"] = True

    if price_levels:
        levels = [f"PRICE_LEVEL_{level.strip().upper()}" for level in price_levels.split(",")]
        payload["priceLevels"] = levels

    # Headers with comprehensive field mask (100 most important fields)
    # Note: searchText requires 'places.' prefix for fields
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": get_enhanced_field_mask(
            include_reviews=False,
            include_photos=True,
            detail_level="standard",
            use_prefix=True,
        ),
    }

    # Make request
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(PLACES_API_TEXT_SEARCH_URL, json=payload, headers=headers)

        if response.status_code != 200:
            error_text = response.text
            logger.error(f"Text Search API error: {response.status_code} - {error_text}")
            raise HTTPException(status_code=502, detail=f"Google Places API error: {error_text}")

        data = response.json()

    # Format results (same format as nearby search)
    places = data.get("places", [])
    formatted_results = []

    # Debug: Log first place to check id field
    if places:
        logger.info(f"First place from Google API (text search): {places[0]}")
        logger.info(f"First place 'id' field (text search): {places[0].get('id', 'NOT FOUND')}")

    for place in places:
        formatted_results.append(
            {
                "place_id": place.get("id", "").replace("places/", ""),
                "name": place.get("displayName", {}).get("text", ""),
                "vicinity": place.get("formattedAddress", ""),
                "rating": place.get("rating"),
                "user_ratings_total": place.get("userRatingCount"),
                "price_level": _convert_price_level(place.get("priceLevel")),
                "types": place.get("types", []),
                "geometry": {"location": place.get("location", {})},
                "business_status": place.get("businessStatus"),
                "opening_hours": place.get("currentOpeningHours"),
                "website": place.get("websiteUri"),
                "phone": place.get("internationalPhoneNumber"),
                "photos": None,  # Would need separate request
            }
        )

        # Debug: Log if place_id is missing
        if not place.get("id"):
            logger.warning(
                f"⚠️ Place missing 'id' field (text search): {place.get('displayName', {}).get('text', 'Unknown')}"
            )

    logger.info(f"Text Search found {len(formatted_results)} places")

    return NearbySearchResponse(
        results=formatted_results,
        status="OK" if formatted_results else "ZERO_RESULTS",
        error_message=None,
        next_page_token=data.get("nextPageToken"),
    )


def _convert_price_level(price_level_str: Optional[str]) -> Optional[int]:
    """Convert Google's price level string to numeric (1-4)"""
    if not price_level_str:
        return None

    price_map = {
        "PRICE_LEVEL_FREE": 0,
        "PRICE_LEVEL_INEXPENSIVE": 1,
        "PRICE_LEVEL_MODERATE": 2,
        "PRICE_LEVEL_EXPENSIVE": 3,
        "PRICE_LEVEL_VERY_EXPENSIVE": 4,
    }

    return price_map.get(price_level_str)


@router.get("/details/{place_id}", response_model=PlaceDetailsResponse)
@limiter.limit("20/minute")
async def get_place_details(
    request: Request,
    place_id: str,
    fields: Optional[str] = Query(None, description="Comma-separated list of fields to return"),
    auth: dict = Depends(verify_auth),  # Support both API key and JWT
):
    """
    Get detailed information about a place using Google Places API (New)

    This endpoint proxies requests to Google Places Details API.
    Uses the new Places API with Place ID format.

    **Authentication Required:** `Authorization: Bearer <token>` OR `X-API-Key: <key>`

    Args:
        place_id: Google Place ID (will be converted to places/{place_id} format)
        fields: Optional comma-separated fields (ignored - uses comprehensive field mask)

    Returns:
        PlaceDetailsResponse with place details

    Example:
        GET /api/v3/places/details/ChIJN1t_tDeuEmsRUsoyG83frY4
    """
    try:
        logger.info(f"Place details: place_id={place_id}")

        # Validate API key
        if not settings.google_places_api_key or settings.google_places_api_key.strip() == "":
            raise HTTPException(status_code=500, detail="Google Places API key not configured on server")

        # Format place ID for new API (needs places/ prefix)
        formatted_place_id = place_id if place_id.startswith("places/") else f"places/{place_id}"

        # New Places API endpoint for place details
        url = f"https://places.googleapis.com/v1/{formatted_place_id}"

        # Headers with comprehensive field mask
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": settings.google_places_api_key,
            "X-Goog-FieldMask": get_enhanced_field_mask(
                include_reviews=True,
                include_photos=True,
                detail_level="full",
                use_prefix=False,
            ),
        }

        # Make request
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                error_text = response.text
                logger.error(f"Places API error: {response.status_code} - {error_text}")
                raise HTTPException(status_code=502, detail=f"Google Places API error: {error_text}")

            data = response.json()

        return PlaceDetailsResponse(result=data, status="OK", error_message=None)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in place details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ============================================================================
# FOTOS (movidas de places_router.py — consolidado em ago/2026)
# ============================================================================
# A chave da API Google NUNCA sai do servidor — as URLs de foto retornadas
# apontam para o proxy interno GET /places/photo, que adiciona a chave
# server-side e responde 302 para o Google (o <img> segue o redirect).
PLACES_API_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"

# Teto do streaming server-side: protege o egress do Render contra abuso
# (o rate limit de 60/min já limita por IP; o teto limita por request).
_MAX_PHOTO_BYTES = 20 * 1024 * 1024  # 20MB

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
    de uma URL nua. O rate limit (60/min por IP) protege o custo/abuso.

    Desde 2026-08-18 (achado #1 da auditoria de segurança): a foto é baixada
    SERVER-SIDE e devolvida em streaming — a chave do Google NUNCA sai do
    servidor. Antes, o proxy devolvia 302 com `key=` no Location, legível por
    qualquer um com curl -i (o comentário antigo afirmava o contrário,
    incorreto: o Location É entregue ao cliente).
    """
    # Validar formato ANTES de montar a URL — o reference vai para o path da
    # URL do Google; sem a validação seria SSRF/open-redirect com a chave.
    if not _PHOTO_REFERENCE_RE.fullmatch(reference):
        raise HTTPException(
            status_code=400,
            detail="Invalid photo reference (expected places/<id>/photos/<id>)",
        )

    params = [("key", settings.google_places_api_key)]
    # A API moderna do Google REJEITA a URL sem dimensão ('At least one of
    # max_height_px or max_width_px must be specified') — o default segue
    # aplicado, agora na requisição server-side.
    if not max_width and not max_height:
        max_width = 1200
    if max_width:
        params.append(("maxWidthPx", max_width))
    if max_height:
        params.append(("maxHeightPx", max_height))
    if skip_http_redirect:
        params.append(("skipHttpRedirect", "true"))

    media_url = PLACES_API_PHOTO_MEDIA_URL.format(photo_name=reference)

    # SSRF guard reutilizado do serviço de imagens: cada request da cadeia de
    # redirects (Google → storage CDN) passa pela validação de host.
    from app.services.openai_service import _validate_image_request_hook

    client = httpx.AsyncClient(
        follow_redirects=True,
        timeout=30.0,
        event_hooks={"request": [_validate_image_request_hook]},
    )
    try:
        upstream = await client.get(media_url, params=params)
    except Exception:
        await client.aclose()
        logger.warning(f"Google photo fetch failed for reference={reference}", exc_info=True)
        raise HTTPException(status_code=502, detail="Google Places photo unavailable")

    if upstream.status_code != 200:
        upstream_status = upstream.status_code
        await upstream.aclose()
        await client.aclose()
        if upstream_status == 404:
            raise HTTPException(status_code=404, detail="Photo not found")
        raise HTTPException(status_code=502, detail="Google Places photo unavailable")

    content_type = upstream.headers.get("content-type", "image/jpeg")

    async def _stream_bytes():
        sent = 0
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=64 * 1024):
                sent += len(chunk)
                yield chunk
                if sent >= _MAX_PHOTO_BYTES:
                    break
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        _stream_bytes(),
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=3600"},
    )


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


# ============================================================================
# ORQUESTRAÇÃO PLACES (movida de places_orchestrate.py — consolidado em
# ago/2026; a rota /places/orchestrate unifica search/details/bulk)
# ============================================================================
PLACES_API_DETAILS_URL = "https://places.googleapis.com/v1/places"
PLACES_API_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"


# ============================================================================
# REQUEST/RESPONSE MODELS
# ============================================================================


class PlacesOrchestrationRequest(BaseModel):
    """Unified request for all Places API operations"""

    # Search parameters
    query: Optional[str] = Field(None, description="Text query for search")
    place_id: Optional[str] = Field(None, description="Place ID for details lookup")
    place_ids: Optional[List[str]] = Field(
        None,
        max_length=20,
        description="List of Place IDs for bulk details lookup (max 20 — fan-out de custo na API do Google)",
    )

    # Location parameters
    latitude: Optional[float] = Field(None, description="Latitude for location-based search")
    longitude: Optional[float] = Field(None, description="Longitude for location-based search")
    radius: Optional[float] = Field(500.0, description="Search radius in meters (max 50000)")

    # Filtering parameters
    included_types: Optional[List[str]] = Field(None, description="Filter by place types")
    excluded_types: Optional[List[str]] = Field(None, description="Exclude place types")
    min_rating: Optional[float] = Field(None, description="Minimum rating (0-5)")
    price_levels: Optional[List[str]] = Field(None, description="Filter by price levels")
    open_now: Optional[bool] = Field(None, description="Only return open places")

    # Response parameters
    max_results: Optional[int] = Field(20, description="Maximum results to return (1-20)")
    language: Optional[str] = Field("en", description="Language code for results")
    region_code: Optional[str] = Field(None, description="Region code for formatting")

    # Advanced parameters
    rank_preference: Optional[Literal["DISTANCE", "POPULARITY"]] = Field(None, description="Result ranking")
    include_pure_service_area: Optional[bool] = Field(False, description="Include service-area-only businesses")

    # Bulk operations
    bulk: Optional[bool] = Field(False, description="Enable bulk processing mode")
    combine_results: Optional[bool] = Field(True, description="Combine results from multiple operations")

    # Multi-operation parameters
    operations: Optional[List[Dict[str, Any]]] = Field(
        None,
        max_length=10,
        description="List of operations to execute in bulk (max 10 — cada operação pode gerar chamadas Google)",
    )


class PlacesOrchestrationResponse(BaseModel):
    """Unified response from Places orchestration"""

    operation: str = Field(
        ...,
        description="Operation performed: nearby|text_search|details|autocomplete|bulk",
    )
    results: List[Dict[str, Any]] = Field(..., description="Search results")
    total_results: int = Field(..., description="Number of results returned")
    next_page_token: Optional[str] = Field(None, description="Token for next page")
    operations_executed: Optional[List[str]] = Field(None, description="List of operations executed in bulk mode")
    errors: Optional[List[Dict[str, Any]]] = Field(None, description="Errors encountered during bulk operations")


# ============================================================================
# ORCHESTRATION LOGIC
# ============================================================================


def determine_operation(request: PlacesOrchestrationRequest) -> str:
    """
    Intelligently determine which Places API to call based on request parameters.

    Priority order:
    1. operations list -> Bulk mode
    2. place_ids list -> Bulk details
    3. place_id -> Details API
    4. query + no location -> Text Search API
    5. query + location -> Text Search API (with location bias)
    6. location + types -> Nearby Search API
    7. location only -> Nearby Search API
    """

    # Case 0: Bulk operations
    if request.operations:
        return "bulk_multi"

    # Case 1: Bulk details
    if request.place_ids:
        return "bulk_details"

    # Case 2: Single place ID -> Details
    if request.place_id:
        return "details"

    # Case 3: Query provided -> Text Search
    if request.query:
        return "text_search"

    # Case 4: Location + types -> Nearby Search
    if request.latitude and request.longitude:
        return "nearby"

    # Default: autocomplete if nothing else matches
    return "autocomplete"


async def call_nearby_search(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    """Call Nearby Search API"""

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.formattedAddress,"
            "places.location,places.rating,places.types,places.priceLevel"
        ),
    }

    body = {
        "locationRestriction": {
            "circle": {
                "center": {
                    "latitude": request.latitude,
                    "longitude": request.longitude,
                },
                "radius": request.radius or 500.0,
            }
        },
        "maxResultCount": min(request.max_results or 20, 20),
    }

    # Add optional filters
    if request.included_types:
        body["includedTypes"] = request.included_types
    if request.excluded_types:
        body["excludedTypes"] = request.excluded_types
    if request.rank_preference:
        body["rankPreference"] = request.rank_preference

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(PLACES_API_NEARBY_URL, headers=headers, json=body)

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Places API error: {response.text}",
            )

        return response.json()


async def call_text_search(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    """Call Text Search API"""

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": (
            "places.id,places.displayName,places.formattedAddress,"
            "places.location,places.rating,places.types,places.priceLevel"
        ),
    }

    body = {
        "textQuery": request.query,
        "pageSize": min(request.max_results or 20, 20),
        "languageCode": request.language,
    }

    # Add location bias if coordinates provided
    if request.latitude and request.longitude:
        body["locationBias"] = {
            "circle": {
                "center": {
                    "latitude": request.latitude,
                    "longitude": request.longitude,
                },
                "radius": request.radius or 500.0,
            }
        }

    # Add optional filters
    if request.included_types and len(request.included_types) == 1:
        body["includedType"] = request.included_types[0]
    if request.min_rating:
        body["minRating"] = request.min_rating
    if request.price_levels:
        body["priceLevels"] = request.price_levels
    if request.open_now is not None:
        body["openNow"] = request.open_now
    if request.rank_preference:
        body["rankPreference"] = request.rank_preference
    if request.region_code:
        body["regionCode"] = request.region_code

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(PLACES_API_TEXT_SEARCH_URL, headers=headers, json=body)

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Places API error: {response.text}",
            )

        return response.json()


async def call_place_details(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    """Call Place Details API"""

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": (
            "id,displayName,formattedAddress,location,rating,types,priceLevel,"
            "nationalPhoneNumber,websiteUri,regularOpeningHours"
        ),
    }

    params = {}
    if request.language:
        params["languageCode"] = request.language
    if request.region_code:
        params["regionCode"] = request.region_code

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            f"{PLACES_API_DETAILS_URL}/{request.place_id}",
            headers=headers,
            params=params,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Places API error: {response.text}",
            )

        return response.json()


async def call_bulk_details(place_ids: List[str], request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    """
    Call Place Details API for multiple place IDs in parallel.
    Returns combined results and tracks errors.
    """

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": (
            "id,displayName,formattedAddress,location,rating,types,priceLevel,"
            "nationalPhoneNumber,websiteUri,regularOpeningHours"
        ),
    }

    params = {}
    if request.language:
        params["languageCode"] = request.language
    if request.region_code:
        params["regionCode"] = request.region_code

    results = []
    errors = []

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Create tasks for parallel execution
        tasks = []
        for place_id in place_ids:
            task = client.get(f"{PLACES_API_DETAILS_URL}/{place_id}", headers=headers, params=params)
            tasks.append((place_id, task))

        # Execute all requests in parallel
        for place_id, task in tasks:
            try:
                response = await task
                if response.status_code == 200:
                    results.append(response.json())
                else:
                    errors.append(
                        {
                            "place_id": place_id,
                            "status_code": response.status_code,
                            "error": response.text,
                        }
                    )
            except Exception as e:
                errors.append({"place_id": place_id, "error": str(e)})

    return {
        "places": results,
        "errors": errors,
        "total_requested": len(place_ids),
        "total_success": len(results),
        "total_errors": len(errors),
    }


async def call_bulk_multi_operations(
    operations: List[Dict[str, Any]], base_request: PlacesOrchestrationRequest
) -> Dict[str, Any]:
    """
    Execute multiple different operations in sequence or parallel.
    Each operation can be: nearby, text_search, or details.

    Example operations list:
    [
        {"operation": "text_search", "query": "pizza", "latitude": -23.5, "longitude": -46.6},
        {"operation": "nearby", "latitude": -23.5, "longitude": -46.6, "included_types": ["restaurant"]},
        {"operation": "details", "place_id": "ChIJ..."}
    ]
    """

    all_results = []
    all_errors = []
    operations_executed = []

    for op_config in operations:
        try:
            # Create a request object for this operation (exclude operations to avoid recursion)
            base_dict = base_request.dict(exclude_none=True)
            base_dict.pop("operations", None)  # Remove operations to prevent recursion
            base_dict.pop("place_ids", None)  # Remove place_ids to prevent confusion

            op_request = PlacesOrchestrationRequest(**{**base_dict, **op_config})

            # Determine operation type for this specific request
            operation_type = op_config.get("operation") or determine_operation(op_request)
            operations_executed.append(operation_type)

            # Execute the operation
            if operation_type == "details":
                data = await call_place_details(op_request)
                all_results.append(data)

            elif operation_type == "text_search":
                data = await call_text_search(op_request)
                all_results.extend(data.get("places", []))

            elif operation_type == "nearby":
                data = await call_nearby_search(op_request)
                all_results.extend(data.get("places", []))

        except Exception as e:
            all_errors.append({"operation": op_config, "error": str(e)})

    return {
        "places": all_results,
        "errors": all_errors,
        "operations_executed": operations_executed,
        "total_operations": len(operations),
        "total_success": len(operations) - len(all_errors),
        "total_errors": len(all_errors),
    }


# ============================================================================
# ENDPOINTS
# ============================================================================


@router.post("/orchestrate", response_model=PlacesOrchestrationResponse)
@limiter.limit("20/minute")
async def orchestrate_places_request(
    request: Request,
    body: PlacesOrchestrationRequest,
    auth: dict = Depends(verify_auth),  # Support both API key and JWT
):
    """
    Unified orchestration endpoint for Google Places API.

    Automatically determines the best API to use based on your input:
    - Place IDs list -> Bulk Details API
    - Operations list -> Multi-operation bulk mode
    - Place ID -> Details API
    - Text query -> Text Search API
    - Location + types -> Nearby Search API

    **Authentication Required:** `Authorization: Bearer <token>` OR `X-API-Key: <key>`

    Examples:
    - Search by name: `{"query": "pizza restaurants"}`
    - Search nearby: `{"latitude": 37.7749, "longitude": -122.4194, "included_types": ["restaurant"]}`
    - Get details: `{"place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4"}`
    - Bulk details: `{"place_ids": ["ChIJ...", "ChIJ..."]}`
    - Multi-operation: `{"operations": [{"query": "pizza"}, {"latitude": 37.7, "longitude": -122.4}]}`
    """

    try:
        # Determine which operation to perform
        operation = determine_operation(body)
        logger.info(f"Orchestrating Places API request: operation={operation}")

        errors = None
        operations_executed = None

        # Call appropriate API
        if operation == "bulk_multi":
            # Execute multiple different operations
            if not body.operations:
                raise HTTPException(
                    status_code=400,
                    detail="operations list is required for bulk_multi mode",
                )
            data = await call_bulk_multi_operations(body.operations, body)
            results = data.get("places", [])
            errors = data.get("errors") if data.get("errors") else None
            operations_executed = data.get("operations_executed")
            operation = "bulk"

        elif operation == "bulk_details":
            # Bulk details lookup for multiple place IDs
            if not body.place_ids:
                raise HTTPException(
                    status_code=400,
                    detail="place_ids list is required for bulk_details mode",
                )
            data = await call_bulk_details(body.place_ids, body)
            results = data.get("places", [])
            errors = data.get("errors") if data.get("errors") else None
            operations_executed = ["details"] * data.get("total_requested", 0)
            operation = "bulk"

        elif operation == "details":
            data = await call_place_details(body)
            results = [data]  # Wrap single result in array

        elif operation == "text_search":
            data = await call_text_search(body)
            results = data.get("places", [])

        elif operation == "nearby":
            data = await call_nearby_search(body)
            results = data.get("places", [])

        else:
            raise HTTPException(
                status_code=400,
                detail="Unable to determine operation from request parameters",
            )

        # Build response
        return PlacesOrchestrationResponse(
            operation=operation,
            results=results,
            total_results=len(results),
            next_page_token=(
                data.get("nextPageToken") if operation not in ["bulk", "bulk_details", "bulk_multi"] else None
            ),
            operations_executed=operations_executed,
            errors=errors,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Places orchestration error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")
