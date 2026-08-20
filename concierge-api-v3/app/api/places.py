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
        if not settings.google_places_api_key or settings.google_places_api_key.strip() == "":
            raise HTTPException(status_code=500, detail="Google Places API key not configured on server")

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
            if not radius:
                radius = 5000
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

    if place_type:
        payload["includedTypes"] = [place_type]
        logger.info(f"🔍 Applying type filter: includedTypes=['{place_type}']")
    else:
        default_food_types = ["restaurant", "cafe", "bar", "bakery"]
        payload["includedTypes"] = default_food_types
        logger.info(f"🍽️ No type filter provided - defaulting to food types: {default_food_types}")

    if min_rating:
        payload["minRating"] = min_rating

    if price_levels:
        levels = [f"PRICE_LEVEL_{level.strip().upper()}" for level in price_levels.split(",")]
        payload["priceLevels"] = levels

    logger.info(f"📤 Places API Payload: {payload}")

    field_mask = get_enhanced_field_mask(
        include_reviews=False,
        include_photos=True,
        detail_level="standard",
        use_prefix=True,
    )
    logger.info(f"Field mask for nearby search: {field_mask[:200]}...")

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": field_mask,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(PLACES_API_NEARBY_URL, json=payload, headers=headers)

        if response.status_code != 200:
            logger.error("Places API request failed status=%s", response.status_code)
            raise HTTPException(status_code=502, detail="Google Places request failed")

        data = response.json()

    places = data.get("places", [])
    formatted_results = []

    if places:
        logger.info(f"First place from Google API: {places[0]}")
        logger.info(f"First place 'id' field: {places[0].get('id', 'NOT FOUND')}")

    for place in places:
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
                "photos": None,
            }
        )

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
    payload = {
        "textQuery": keyword,
        "maxResultCount": max_results,
        "languageCode": language or "pt-BR",
        "regionCode": region or "BR",
        "locationBias": {
            "circle": {
                "center": {"latitude": latitude, "longitude": longitude},
                "radius": 50000,
            }
        },
    }

    if place_type:
        payload["includedType"] = place_type
    else:
        payload["includedType"] = "restaurant"
        logger.info("🍽️ No type filter provided for text search - defaulting to 'restaurant'")

    if min_rating:
        payload["minRating"] = min_rating

    if open_now:
        payload["openNow"] = True

    if price_levels:
        levels = [f"PRICE_LEVEL_{level.strip().upper()}" for level in price_levels.split(",")]
        payload["priceLevels"] = levels

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

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(PLACES_API_TEXT_SEARCH_URL, json=payload, headers=headers)

        if response.status_code != 200:
            logger.error("Text Search API request failed status=%s", response.status_code)
            raise HTTPException(status_code=502, detail="Google Places request failed")

        data = response.json()

    places = data.get("places", [])
    formatted_results = []

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
                "photos": None,
            }
        )

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
    auth: dict = Depends(verify_auth),
):
    """Get detailed information about a place using Google Places API (New)."""
    try:
        logger.info(f"Place details: place_id={place_id}")

        if not settings.google_places_api_key or settings.google_places_api_key.strip() == "":
            raise HTTPException(status_code=500, detail="Google Places API key not configured on server")

        formatted_place_id = place_id if place_id.startswith("places/") else f"places/{place_id}"
        url = f"https://places.googleapis.com/v1/{formatted_place_id}"

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

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)

            if response.status_code != 200:
                logger.error("Places details request failed status=%s", response.status_code)
                raise HTTPException(status_code=502, detail="Google Places request failed")

            data = response.json()

        return PlaceDetailsResponse(result=data, status="OK", error_message=None)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in place details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


PLACES_API_PHOTO_MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"
_MAX_PHOTO_BYTES = 20 * 1024 * 1024
_PHOTO_REFERENCE_RE = re.compile(r"^places/[A-Za-z0-9_\-]+/photos/[A-Za-z0-9_\-]+$")


def get_llm_service() -> LLMPlaceService:
    """Dependency to get LLMPlaceService instance"""
    return LLMPlaceService(database=get_database())


@router.get("/photo", include_in_schema=True)
@limiter.limit("60/minute")
async def proxy_place_photo(
    request: Request,
    reference: str = Query(..., description="Google photo resource name (e.g., places/xxx/photos/yyy)"),
    max_width: Optional[int] = Query(None, ge=400, le=4800),
    max_height: Optional[int] = Query(None, ge=400, le=4800),
    skip_http_redirect: bool = Query(False),
):
    """Proxy Google Places photos without exposing the Google API key."""
    if not _PHOTO_REFERENCE_RE.fullmatch(reference):
        raise HTTPException(status_code=400, detail="Invalid photo reference (expected places/<id>/photos/<id>)")

    params = [("key", settings.google_places_api_key)]
    if not max_width and not max_height:
        max_width = 1200
    if max_width:
        params.append(("maxWidthPx", max_width))
    if max_height:
        params.append(("maxHeightPx", max_height))
    if skip_http_redirect:
        params.append(("skipHttpRedirect", "true"))

    media_url = PLACES_API_PHOTO_MEDIA_URL.format(photo_name=reference)
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
    max_photos: int = Query(10, ge=1, le=10),
    max_width: Optional[int] = Query(None, ge=400, le=4800),
    max_height: Optional[int] = Query(None, ge=400, le=4800),
    include_metadata: bool = Query(True),
    language: str = Query("pt-BR"),
    service: LLMPlaceService = Depends(get_llm_service),
    auth: dict = Depends(verify_auth),
):
    """Get restaurant photos from Google Places."""
    try:
        result = service.get_restaurant_photos(
            place_id=place_id,
            max_photos=max_photos,
            max_width=max_width,
            max_height=max_height,
            include_metadata=include_metadata,
            language=language,
            base_url=str(request.base_url),
        )
        if "error" in result:
            raise HTTPException(status_code=400, detail="Unable to fetch restaurant photos")
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching photos for {place_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Unable to fetch restaurant photos")


PLACES_API_DETAILS_URL = "https://places.googleapis.com/v1/places"
PLACES_API_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"


class PlacesOrchestrationRequest(BaseModel):
    """Unified request for all Places API operations"""

    query: Optional[str] = Field(None, description="Text query for search")
    place_id: Optional[str] = Field(None, description="Place ID for details lookup")
    place_ids: Optional[List[str]] = Field(None, max_length=20)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius: Optional[float] = 500.0
    included_types: Optional[List[str]] = None
    excluded_types: Optional[List[str]] = None
    min_rating: Optional[float] = None
    price_levels: Optional[List[str]] = None
    open_now: Optional[bool] = None
    max_results: Optional[int] = 20
    language: Optional[str] = "en"
    region_code: Optional[str] = None
    rank_preference: Optional[Literal["DISTANCE", "POPULARITY"]] = None
    include_pure_service_area: Optional[bool] = False
    bulk: Optional[bool] = False
    combine_results: Optional[bool] = True
    operations: Optional[List[Dict[str, Any]]] = Field(None, max_length=10)


class PlacesOrchestrationResponse(BaseModel):
    """Unified response from Places orchestration"""

    operation: str
    results: List[Dict[str, Any]]
    total_results: int
    next_page_token: Optional[str] = None
    operations_executed: Optional[List[str]] = None
    errors: Optional[List[Dict[str, Any]]] = None


def determine_operation(request: PlacesOrchestrationRequest) -> str:
    if request.operations:
        return "bulk_multi"
    if request.place_ids:
        return "bulk_details"
    if request.place_id:
        return "details"
    if request.query:
        return "text_search"
    if request.latitude and request.longitude:
        return "nearby"
    return "autocomplete"


def _safe_provider_error(*, place_id: str | None = None, status_code: int | None = None) -> Dict[str, Any]:
    error: Dict[str, Any] = {
        "code": "provider_error",
        "message": "Google Places request failed",
    }
    if place_id is not None:
        error["place_id"] = place_id
    if status_code is not None:
        error["status_code"] = status_code
    return error


def _safe_operation_error(operation: str, *, provider: bool = False, status_code: int | None = None) -> Dict[str, Any]:
    error: Dict[str, Any] = {
        "operation": operation,
        "code": "provider_error" if provider else "dependency_error",
        "message": "Google Places request failed" if provider else "Places operation failed",
    }
    if status_code is not None:
        error["status_code"] = status_code
    return error


async def call_nearby_search(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.priceLevel",
    }
    body = {
        "locationRestriction": {
            "circle": {
                "center": {"latitude": request.latitude, "longitude": request.longitude},
                "radius": request.radius or 500.0,
            }
        },
        "maxResultCount": min(request.max_results or 20, 20),
    }
    if request.included_types:
        body["includedTypes"] = request.included_types
    if request.excluded_types:
        body["excludedTypes"] = request.excluded_types
    if request.rank_preference:
        body["rankPreference"] = request.rank_preference

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(PLACES_API_NEARBY_URL, headers=headers, json=body)
        if response.status_code != 200:
            logger.error("Places nearby request failed status=%s", response.status_code)
            raise HTTPException(status_code=502, detail="Google Places request failed")
        return response.json()


async def call_text_search(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.priceLevel",
    }
    body = {
        "textQuery": request.query,
        "pageSize": min(request.max_results or 20, 20),
        "languageCode": request.language,
    }
    if request.latitude and request.longitude:
        body["locationBias"] = {
            "circle": {
                "center": {"latitude": request.latitude, "longitude": request.longitude},
                "radius": request.radius or 500.0,
            }
        }
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
            logger.error("Places text search request failed status=%s", response.status_code)
            raise HTTPException(status_code=502, detail="Google Places request failed")
        return response.json()


async def call_place_details(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,types,priceLevel,nationalPhoneNumber,websiteUri,regularOpeningHours",
    }
    params = {}
    if request.language:
        params["languageCode"] = request.language
    if request.region_code:
        params["regionCode"] = request.region_code

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(f"{PLACES_API_DETAILS_URL}/{request.place_id}", headers=headers, params=params)
        if response.status_code != 200:
            logger.error("Places details request failed status=%s", response.status_code)
            raise HTTPException(status_code=502, detail="Google Places request failed")
        return response.json()


async def call_bulk_details(place_ids: List[str], request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,types,priceLevel,nationalPhoneNumber,websiteUri,regularOpeningHours",
    }
    params = {}
    if request.language:
        params["languageCode"] = request.language
    if request.region_code:
        params["regionCode"] = request.region_code

    results = []
    errors = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = []
        for place_id in place_ids:
            task = client.get(f"{PLACES_API_DETAILS_URL}/{place_id}", headers=headers, params=params)
            tasks.append((place_id, task))

        for place_id, task in tasks:
            try:
                response = await task
                if response.status_code == 200:
                    results.append(response.json())
                else:
                    logger.error("Places bulk detail failed place_id=%s status=%s", place_id, response.status_code)
                    errors.append(_safe_provider_error(place_id=place_id, status_code=response.status_code))
            except Exception:
                logger.error("Places bulk detail dependency failure place_id=%s", place_id, exc_info=True)
                errors.append(
                    {
                        "place_id": place_id,
                        "code": "dependency_error",
                        "message": "Google Places request failed",
                    }
                )

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
    all_results = []
    all_errors = []
    operations_executed = []

    for op_config in operations:
        operation_label = str(op_config.get("operation") or "unknown")
        try:
            base_dict = base_request.dict(exclude_none=True)
            base_dict.pop("operations", None)
            base_dict.pop("place_ids", None)
            op_request = PlacesOrchestrationRequest(**{**base_dict, **op_config})
            operation_type = op_config.get("operation") or determine_operation(op_request)
            operation_label = str(operation_type)
            operations_executed.append(operation_type)

            if operation_type == "details":
                data = await call_place_details(op_request)
                all_results.append(data)
            elif operation_type == "text_search":
                data = await call_text_search(op_request)
                all_results.extend(data.get("places", []))
            elif operation_type == "nearby":
                data = await call_nearby_search(op_request)
                all_results.extend(data.get("places", []))
        except HTTPException as exc:
            provider_error = exc.status_code == 502
            all_errors.append(
                _safe_operation_error(
                    operation_label,
                    provider=provider_error,
                    status_code=exc.status_code,
                )
            )
        except Exception:
            logger.error("Places bulk operation failed operation=%s", operation_label, exc_info=True)
            all_errors.append(_safe_operation_error(operation_label))

    return {
        "places": all_results,
        "errors": all_errors,
        "operations_executed": operations_executed,
        "total_operations": len(operations),
        "total_success": len(operations) - len(all_errors),
        "total_errors": len(all_errors),
    }


@router.post("/orchestrate", response_model=PlacesOrchestrationResponse)
@limiter.limit("20/minute")
async def orchestrate_places_request(
    request: Request,
    body: PlacesOrchestrationRequest,
    auth: dict = Depends(verify_auth),
):
    """Unified orchestration endpoint for Google Places API."""
    try:
        operation = determine_operation(body)
        logger.info(f"Orchestrating Places API request: operation={operation}")

        errors = None
        operations_executed = None

        if operation == "bulk_multi":
            if not body.operations:
                raise HTTPException(status_code=400, detail="operations list is required for bulk_multi mode")
            data = await call_bulk_multi_operations(body.operations, body)
            results = data.get("places", [])
            errors = data.get("errors") if data.get("errors") else None
            operations_executed = data.get("operations_executed")
            operation = "bulk"
        elif operation == "bulk_details":
            if not body.place_ids:
                raise HTTPException(status_code=400, detail="place_ids list is required for bulk_details mode")
            data = await call_bulk_details(body.place_ids, body)
            results = data.get("places", [])
            errors = data.get("errors") if data.get("errors") else None
            operations_executed = ["details"] * data.get("total_requested", 0)
            operation = "bulk"
        elif operation == "details":
            data = await call_place_details(body)
            results = [data]
        elif operation == "text_search":
            data = await call_text_search(body)
            results = data.get("places", [])
        elif operation == "nearby":
            data = await call_nearby_search(body)
            results = data.get("places", [])
        else:
            raise HTTPException(status_code=400, detail="Unable to determine operation from request parameters")

        return PlacesOrchestrationResponse(
            operation=operation,
            results=results,
            total_results=len(results),
            next_page_token=(data.get("nextPageToken") if operation not in ["bulk", "bulk_details", "bulk_multi"] else None),
            operations_executed=operations_executed,
            errors=errors,
        )

    except HTTPException:
        raise
    except Exception:
        logger.error("Places orchestration failed", exc_info=True)
        raise HTTPException(status_code=500, detail="Places orchestration failed")
