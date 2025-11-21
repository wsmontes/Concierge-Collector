"""
File: places.py
Purpose: Google Places API (New) proxy endpoints
Dependencies: fastapi, httpx, app.core.config
Last Updated: November 17, 2025

This module provides secure proxy endpoints for Google Places API (New).
API keys are stored server-side, never exposed to frontend.
Uses the modern Places API (New) with HTTP requests.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
import httpx
import logging

from app.core.config import settings

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

def get_enhanced_field_mask(include_reviews: bool = False, include_photos: bool = True, detail_level: str = "standard") -> str:
    """
    Build comprehensive field mask for Google Places API
    
    Based on 150+ most important fields from Google Places API (New).
    Controls billing by only requesting needed fields.
    
    Args:
        include_reviews: Include review details (higher cost)
        include_photos: Include photo metadata
        detail_level: "minimal", "standard", or "full" (controls billing cost)
        
    Returns:
        Comma-separated field mask string
    """
    # Essential fields (always included) - SKU: Basic Data
    essential = [
        "places.name",  # Changed from places.id - this is the correct field
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.priceLevel",
        "places.types",
        "places.businessStatus"
    ]
    
    if detail_level == "minimal":
        return ",".join(essential)
    
    # Contact and web presence - SKU: Contact Data
    contact = [
        "places.websiteUri",
        "places.internationalPhoneNumber",
        "places.nationalPhoneNumber"
    ]
    
    # Opening hours - SKU: Atmosphere Data
    hours = [
        "places.currentOpeningHours",
        "places.regularOpeningHours",
        "places.utcOffsetMinutes"
    ]
    
    # Address components (detailed geocoding) - SKU: Basic Data
    address = [
        "places.shortFormattedAddress",
        "places.addressComponents",
        "places.plusCode"
    ]
    
    # Basic attributes - SKU: Atmosphere Data
    basic_attributes = [
        "places.takeout",
        "places.delivery",
        "places.dineIn",
        "places.reservable",
        "places.goodForChildren",
        "places.goodForGroups"
    ]
    
    # Editorial content
    editorial = [
        "places.editorialSummary"
        # Removed: places.iconMaskBaseUri - deprecated in Places API (New)
    ]
    
    # Photos (if requested)
    photos = []
    if include_photos:
        photos = [
            "places.photos"
        ]
    
    if detail_level == "standard":
        all_fields = essential + contact + hours + address + basic_attributes + editorial + photos
        return ",".join(all_fields)
    
    # FULL DETAIL LEVEL - All 150+ fields
    
    # Food service attributes (restaurants) - SKU: Atmosphere Data
    food_service = [
        "places.servesBreakfast",
        "places.servesLunch",
        "places.servesDinner",
        "places.servesBrunch",
        "places.servesBeer",
        "places.servesWine"
    ]
    
    # Dietary and service options - SKU: Atmosphere Data
    dietary = [
        "places.servesVegetarianFood",
        "places.takeout",
        "places.delivery",
        "places.dineIn",
        "places.reservable"
    ]
    
    # Amenities - SKU: Atmosphere Data
    amenities = [
        "places.outdoorSeating",
        "places.liveMusic",
        "places.allowsDogs",
        "places.goodForChildren",
        "places.goodForGroups",
        "places.wheelchairAccessibleEntrance"
    ]
    
    # Parking - SKU: Atmosphere Data
    parking = [
        "places.parkingOptions"
    ]
    
    # Payment options - SKU: Atmosphere Data
    payment = [
        "places.paymentOptions"
    ]
    
    # Reviews (if requested - higher billing cost) - SKU: Reviews
    reviews = []
    if include_reviews:
        reviews = [
            "places.reviews"
        ]
    
    # Attribution and metadata
    metadata = [
        "places.googleMapsUri"
        # Removed: places.attributions, places.url - not valid in Places API (New)
    ]
    
    # Combine all fields for full detail
    all_fields = (
        essential + 
        contact + 
        hours + 
        address + 
        food_service + 
        dietary + 
        amenities + 
        parking + 
        payment + 
        editorial + 
        photos + 
        reviews +
        metadata
    )
    
    return ",".join(all_fields)


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/nearby", response_model=NearbySearchResponse)
async def search_nearby(
    latitude: float = Query(..., description="Latitude for search center"),
    longitude: float = Query(..., description="Longitude for search center"),
    radius: Optional[int] = Query(None, ge=1, le=50000, description="Search radius in meters (omit for worldwide with keyword)"),
    type: Optional[str] = Query(None, description="Place type filter (restaurant, cafe, bar, bakery, food)"),
    keyword: Optional[str] = Query(None, description="Keyword search (enables Text Search if no radius)"),
    max_results: int = Query(20, ge=1, le=20, description="Maximum results to return"),
    language: Optional[str] = Query("pt-BR", description="Language code (e.g., pt-BR, en, es)"),
    region: Optional[str] = Query("BR", description="Region code (e.g., BR, US, ES)"),
    min_rating: Optional[float] = Query(None, ge=1.0, le=5.0, description="Minimum rating filter"),
    open_now: Optional[bool] = Query(None, description="Only return places that are open now"),
    price_levels: Optional[str] = Query(None, description="Comma-separated price levels (e.g., 'MODERATE,EXPENSIVE')")
):
    """
    Hybrid search endpoint: Nearby Search or Text Search
    
    - Uses **Nearby Search** when radius is provided
    - Uses **Text Search** when keyword is provided without radius (worldwide search)
    - Supports advanced filters: minRating, openNow, priceLevels
    - Supports localization: language and region codes
    
    Args:
        latitude: Center latitude for search
        longitude: Center longitude for search  
        radius: Search radius in meters (1-50000), omit for worldwide with keyword
        type: Place type (restaurant, cafe, bar, etc.)
        keyword: Search query text (enables Text Search if no radius)
        max_results: Maximum results (1-20, API limit)
        language: Language code (pt-BR, en, es, etc.)
        region: Region code (BR, US, ES, etc.)
        min_rating: Minimum rating filter (1.0-5.0)
        open_now: Only return places open now
        price_levels: Comma-separated price levels
        
    Returns:
        NearbySearchResponse with place results
        
    Examples:
        Nearby: GET /api/v3/places/nearby?latitude=-23.55&longitude=-46.63&radius=2000&type=restaurant
        Worldwide: GET /api/v3/places/nearby?latitude=-23.55&longitude=-46.63&keyword=Osteria+Francescana&type=restaurant
    """
    try:
        # Validate API key
        if not settings.google_places_api_key or settings.google_places_api_key.strip() == "":
            raise HTTPException(
                status_code=500,
                detail="Google Places API key not configured on server"
            )
        
        # Determine search mode: Text Search (worldwide) or Nearby Search
        use_text_search = keyword and not radius
        
        if use_text_search:
            logger.info(f"Text Search: keyword='{keyword}', type={type}, language={language}")
            return await _text_search(
                keyword=keyword,
                latitude=latitude,
                longitude=longitude,
                type=type,
                max_results=max_results,
                language=language,
                region=region,
                min_rating=min_rating,
                open_now=open_now,
                price_levels=price_levels
            )
        else:
            # Default to nearby search
            if not radius:
                radius = 5000  # Default 5km
            logger.info(f"Nearby Search: lat={latitude}, lng={longitude}, radius={radius}, type={type}")
            return await _nearby_search(
                latitude=latitude,
                longitude=longitude,
                radius=radius,
                type=type,
                max_results=max_results,
                language=language,
                region=region,
                min_rating=min_rating,
                open_now=open_now,
                price_levels=price_levels
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in search: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


async def _nearby_search(
    latitude: float,
    longitude: float,
    radius: int,
    type: Optional[str],
    max_results: int,
    language: Optional[str],
    region: Optional[str],
    min_rating: Optional[float],
    open_now: Optional[bool],
    price_levels: Optional[str]
) -> NearbySearchResponse:
    """Execute Nearby Search with Google Places API"""
    
    max_results = min(max_results, 20)
    
    # Build payload
    payload = {
        "maxResultCount": max_results,
        "locationRestriction": {
            "circle": {
                "center": {
                    "latitude": latitude,
                    "longitude": longitude
                },
                "radius": radius
            }
        },
        "languageCode": language or "pt-BR",
        "regionCode": region or "BR"
    }
    
    # Add type filter if provided
    if type:
        payload["includedTypes"] = [type]
    
    # Add filters
    if min_rating:
        payload["minRating"] = min_rating
    
    if price_levels:
        levels = [f"PRICE_LEVEL_{level.strip().upper()}" for level in price_levels.split(',')]
        payload["priceLevels"] = levels
    
    # Headers with comprehensive field mask (100 most important fields)
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": get_enhanced_field_mask(include_reviews=False, include_photos=True, detail_level="standard")
    }
    
    # Make request
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            PLACES_API_NEARBY_URL,
            json=payload,
            headers=headers
        )
        
        if response.status_code != 200:
            error_text = response.text
            logger.error(f"Places API error: {response.status_code} - {error_text}")
            raise HTTPException(
                status_code=502,
                detail=f"Google Places API error: {error_text}"
            )
        
        data = response.json()
    
    # Format results
    places = data.get('places', [])
    formatted_results = []
    
    for place in places:
        # Apply openNow filter if requested (client-side since API doesn't support it directly in nearby)
        if open_now:
            opening_hours = place.get('currentOpeningHours', {})
            if not opening_hours.get('openNow', False):
                continue
        
        formatted_results.append({
            'place_id': place.get('id', '').replace('places/', ''),
            'name': place.get('displayName', {}).get('text', ''),
            'vicinity': place.get('formattedAddress', ''),
            'rating': place.get('rating'),
            'user_ratings_total': place.get('userRatingCount'),
            'price_level': _convert_price_level(place.get('priceLevel')),
            'types': place.get('types', []),
            'geometry': {
                'location': place.get('location', {})
            },
            'business_status': place.get('businessStatus'),
            'opening_hours': place.get('currentOpeningHours'),
            'website': place.get('websiteUri'),
            'phone': place.get('internationalPhoneNumber'),
            'photos': None  # Would need separate request
        })
    
    logger.info(f"Nearby Search found {len(formatted_results)} places")
    
    return NearbySearchResponse(
        results=formatted_results,
        status='OK' if formatted_results else 'ZERO_RESULTS',
        error_message=None,
        next_page_token=data.get('nextPageToken')
    )


async def _text_search(
    keyword: str,
    latitude: float,
    longitude: float,
    type: Optional[str],
    max_results: int,
    language: Optional[str],
    region: Optional[str],
    min_rating: Optional[float],
    open_now: Optional[bool],
    price_levels: Optional[str]
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
                "center": {
                    "latitude": latitude,
                    "longitude": longitude
                },
                "radius": 50000  # 50km bias (not restriction)
            }
        }
    }
    
    # Add type filter if provided
    if type:
        payload["includedType"] = type
    
    # Add filters
    if min_rating:
        payload["minRating"] = min_rating
    
    if open_now:
        payload["openNow"] = True
    
    if price_levels:
        levels = [f"PRICE_LEVEL_{level.strip().upper()}" for level in price_levels.split(',')]
        payload["priceLevels"] = levels
    
    # Headers with comprehensive field mask (100 most important fields)
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": get_enhanced_field_mask(include_reviews=False, include_photos=True, detail_level="standard")
    }
    
    # Make request
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            PLACES_API_TEXT_SEARCH_URL,
            json=payload,
            headers=headers
        )
        
        if response.status_code != 200:
            error_text = response.text
            logger.error(f"Text Search API error: {response.status_code} - {error_text}")
            raise HTTPException(
                status_code=502,
                detail=f"Google Places API error: {error_text}"
            )
        
        data = response.json()
    
    # Format results (same format as nearby search)
    places = data.get('places', [])
    formatted_results = []
    
    for place in places:
        formatted_results.append({
            'place_id': place.get('id', '').replace('places/', ''),
            'name': place.get('displayName', {}).get('text', ''),
            'vicinity': place.get('formattedAddress', ''),
            'rating': place.get('rating'),
            'user_ratings_total': place.get('userRatingCount'),
            'price_level': _convert_price_level(place.get('priceLevel')),
            'types': place.get('types', []),
            'geometry': {
                'location': place.get('location', {})
            },
            'business_status': place.get('businessStatus'),
            'opening_hours': place.get('currentOpeningHours'),
            'website': place.get('websiteUri'),
            'phone': place.get('internationalPhoneNumber'),
            'photos': None  # Would need separate request
        })
    
    logger.info(f"Text Search found {len(formatted_results)} places")
    
    return NearbySearchResponse(
        results=formatted_results,
        status='OK' if formatted_results else 'ZERO_RESULTS',
        error_message=None,
        next_page_token=data.get('nextPageToken')
    )


def _convert_price_level(price_level_str: Optional[str]) -> Optional[int]:
    """Convert Google's price level string to numeric (1-4)"""
    if not price_level_str:
        return None
    
    price_map = {
        'PRICE_LEVEL_FREE': 0,
        'PRICE_LEVEL_INEXPENSIVE': 1,
        'PRICE_LEVEL_MODERATE': 2,
        'PRICE_LEVEL_EXPENSIVE': 3,
        'PRICE_LEVEL_VERY_EXPENSIVE': 4
    }
    
    return price_map.get(price_level_str)


@router.get("/details/{place_id}", response_model=PlaceDetailsResponse)
async def get_place_details(
    place_id: str,
    fields: Optional[str] = Query(
        None,
        description="Comma-separated list of fields to return"
    )
):
    """
    Get detailed information about a place using Google Places API (New)
    
    This endpoint proxies requests to Google Places Details API.
    Uses the new Places API with Place ID format.
    
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
            raise HTTPException(
                status_code=500,
                detail="Google Places API key not configured on server"
            )
        
        # Format place ID for new API (needs places/ prefix)
        formatted_place_id = place_id if place_id.startswith('places/') else f'places/{place_id}'
        
        # New Places API endpoint for place details
        url = f"https://places.googleapis.com/v1/{formatted_place_id}"
        
        # Headers with comprehensive field mask
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": settings.google_places_api_key,
            "X-Goog-FieldMask": get_enhanced_field_mask(include_reviews=True, include_photos=True, detail_level="full")
        }
        
        # Make request
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            
            if response.status_code != 200:
                error_text = response.text
                logger.error(f"Places API error: {response.status_code} - {error_text}")
                raise HTTPException(
                    status_code=502,
                    detail=f"Google Places API error: {error_text}"
                )
            
            data = response.json()
        
        return PlaceDetailsResponse(
            result=data,
            status='OK',
            error_message=None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in place details: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


@router.get("/health")
async def health_check():
    """
    Check if Google Places API is configured and accessible
    
    Returns:
        Status of Google Places API configuration
    """
    has_key = bool(
        settings.google_places_api_key and 
        settings.google_places_api_key.strip() != ""
    )
    
    return {
        "status": "ok" if has_key else "not_configured",
        "api_key_configured": has_key,
        "message": "Google Places API ready" if has_key else "API key not configured"
    }
