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

# New Places API base URL
PLACES_API_NEW_URL = "https://places.googleapis.com/v1/places:searchNearby"


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

def format_place_result(place: Dict[str, Any]) -> Dict[str, Any]:
    """
    Format Google Places API result to match our schema
    
    Args:
        place: Raw place data from Google Maps API
        
    Returns:
        Formatted place dict
    """
    return {
        'place_id': place.get('place_id'),
        'name': place.get('name'),
        'vicinity': place.get('vicinity'),
        'rating': place.get('rating'),
        'user_ratings_total': place.get('user_ratings_total'),
        'price_level': place.get('price_level'),
        'types': place.get('types', []),
        'geometry': place.get('geometry', {}),
        'business_status': place.get('business_status'),
        'opening_hours': place.get('opening_hours'),
        'photos': place.get('photos')
    }


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/nearby", response_model=NearbySearchResponse)
async def search_nearby(
    latitude: float = Query(..., description="Latitude for search center"),
    longitude: float = Query(..., description="Longitude for search center"),
    radius: int = Query(5000, ge=1, le=50000, description="Search radius in meters"),
    type: Optional[str] = Query("restaurant", description="Place type filter"),
    keyword: Optional[str] = Query(None, description="Keyword search"),
    max_results: int = Query(20, ge=1, le=60, description="Maximum results to return")
):
    """
    Search for nearby places using Google Places API (New)
    
    This endpoint proxies requests to Google Places API (New),
    keeping the API key secure on the backend.
    
    Args:
        latitude: Center latitude for search
        longitude: Center longitude for search
        radius: Search radius in meters (1-50000)
        type: Place type (restaurant, cafe, bar, etc.)
        keyword: Optional keyword filter
        max_results: Maximum results (1-20, API limit)
        
    Returns:
        NearbySearchResponse with place results
        
    Example:
        GET /api/v3/places/nearby?latitude=40.7128&longitude=-74.0060&radius=5000
    """
    try:
        logger.info(f"Nearby search: lat={latitude}, lng={longitude}, radius={radius}")
        
        # Validate API key
        if not settings.google_places_api_key or settings.google_places_api_key == "YOUR_GOOGLE_PLACES_API_KEY_HERE":
            raise HTTPException(
                status_code=500,
                detail="Google Places API key not configured on server"
            )
        
        # Build request payload for New Places API
        # Limit to 20 results (API maximum)
        max_results = min(max_results, 20)
        
        payload = {
            "includedTypes": [type] if type else ["restaurant"],
            "maxResultCount": max_results,
            "locationRestriction": {
                "circle": {
                    "center": {
                        "latitude": latitude,
                        "longitude": longitude
                    },
                    "radius": radius
                }
            }
        }
        
        # Add keyword if provided
        if keyword:
            payload["rankPreference"] = "RELEVANCE"
            # Note: New API doesn't have direct keyword parameter
            # You'd use textQuery for keyword search
        
        # Headers for new API
        headers = {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": settings.google_places_api_key,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.types,places.location,places.businessStatus,places.currentOpeningHours"
        }
        
        # Make request to New Places API
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                PLACES_API_NEW_URL,
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
        
        # Format results to match old API format
        places = data.get('places', [])
        formatted_results = []
        
        for place in places:
            formatted_results.append({
                'place_id': place.get('id', '').replace('places/', ''),
                'name': place.get('displayName', {}).get('text', ''),
                'vicinity': place.get('formattedAddress', ''),
                'rating': place.get('rating'),
                'user_ratings_total': place.get('userRatingCount'),
                'price_level': None,  # Not available in new API response with this field mask
                'types': place.get('types', []),
                'geometry': {
                    'location': place.get('location', {})
                },
                'business_status': place.get('businessStatus'),
                'opening_hours': place.get('currentOpeningHours'),
                'photos': None  # Would need separate request
            })
        
        logger.info(f"Found {len(formatted_results)} places")
        
        return NearbySearchResponse(
            results=formatted_results,
            status='OK' if formatted_results else 'ZERO_RESULTS',
            error_message=None,
            next_page_token=data.get('nextPageToken')
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in nearby search: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error: {str(e)}"
        )


@router.get("/details/{place_id}", response_model=PlaceDetailsResponse)
async def get_place_details(
    place_id: str,
    fields: Optional[str] = Query(
        None,
        description="Comma-separated list of fields to return"
    )
):
    """
    Get detailed information about a place
    
    This endpoint proxies requests to Google Places Details API.
    
    Args:
        place_id: Google Place ID
        fields: Optional comma-separated fields (name,rating,formatted_address,etc.)
        
    Returns:
        PlaceDetailsResponse with place details
        
    Example:
        GET /api/v3/places/details/ChIJN1t_tDeuEmsRUsoyG83frY4
    """
    try:
        logger.info(f"Place details: place_id={place_id}")
        
        # Get Google Maps client
        gmaps = get_gmaps_client()
        
        # Parse fields if provided
        fields_list = fields.split(',') if fields else None
        
        # Call Google Places API
        result = gmaps.place(
            place_id=place_id,
            fields=fields_list
        )
        
        # Check status
        status = result.get('status')
        if status != 'OK':
            error_msg = result.get('error_message', status)
            logger.error(f"Google Places API error: {error_msg}")
            raise HTTPException(
                status_code=502,
                detail=f"Google Places API error: {error_msg}"
            )
        
        return PlaceDetailsResponse(
            result=result.get('result', {}),
            status=status,
            error_message=result.get('error_message')
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
        settings.google_places_api_key != "YOUR_GOOGLE_PLACES_API_KEY_HERE"
    )
    
    return {
        "status": "ok" if has_key else "not_configured",
        "api_key_configured": has_key,
        "message": "Google Places API ready" if has_key else "API key not configured"
    }
