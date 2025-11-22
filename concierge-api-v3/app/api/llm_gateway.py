"""
File: llm_gateway.py
Purpose: FastAPI router for LLM Gateway API endpoints
Dependencies: fastapi, app.services.llm_place_service, app.models.llm_models
Last Updated: November 21, 2025

This router provides LLM-friendly endpoints for restaurant data access.
These endpoints consolidate data from Google Places, MongoDB entities,
Michelin guide, and curations into unified responses optimized for LLM consumption.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import Optional
import logging

from app.models.llm_models import (
    LLMSearchRestaurantsRequest,
    LLMSearchRestaurantsResponse,
    LLMGetRestaurantSnapshotRequest,
    LLMGetRestaurantSnapshotResponse,
    LLMGetRestaurantAvailabilityRequest,
    LLMGetRestaurantAvailabilityResponse,
)
from app.services.llm_place_service import LLMPlaceService
from app.core.database import get_database

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/llm", tags=["llm"])


def get_llm_service() -> LLMPlaceService:
    """Dependency to get LLMPlaceService instance"""
    return LLMPlaceService(database=get_database())


@router.post("/search-restaurants", response_model=LLMSearchRestaurantsResponse)
def search_restaurants(
    request: LLMSearchRestaurantsRequest,
    service: LLMPlaceService = Depends(get_llm_service)
):
    """
    Search for restaurants by name or query.
    
    This endpoint:
    - Searches for restaurants matching the query
    - Returns basic information suitable for LLM consumption
    - Includes flags for entity existence and Michelin data
    - Optimized for quick disambiguation and selection
    
    Use this endpoint when the LLM needs to:
    - Find a restaurant by name
    - Disambiguate between multiple restaurants with similar names
    - Get a list of candidates for further detailed queries
    
    Example use case:
    User: "Tell me about Dom Manolo restaurant"
    LLM: Calls this endpoint to find candidates, then calls get-restaurant-snapshot
    """
    try:
        logger.info(f"LLM search-restaurants: query='{request.query}', location=({request.latitude}, {request.longitude})")
        
        items = service.search_restaurants(
            query=request.query,
            latitude=request.latitude,
            longitude=request.longitude,
            radius_m=request.radius_m,
            max_results=request.max_results,
            language=request.language,
            region=request.region
        )
        
        return LLMSearchRestaurantsResponse(
            items=items,
            total_results=len(items),
            search_metadata={
                "query": request.query,
                "location_biased": request.latitude is not None and request.longitude is not None
            }
        )
        
    except Exception as e:
        logger.error(f"Error in search-restaurants: {e}")
        raise HTTPException(status_code=500, detail=f"Search error: {str(e)}")


@router.post("/get-restaurant-snapshot", response_model=LLMGetRestaurantSnapshotResponse)
def get_restaurant_snapshot(
    request: LLMGetRestaurantSnapshotRequest,
    service: LLMPlaceService = Depends(get_llm_service)
):
    """
    Get complete restaurant snapshot with all available data.
    
    This is the **primary endpoint** for getting detailed restaurant information.
    
    It consolidates data from:
    - Google Places (if enabled)
    - MongoDB entities (if exists)
    - Michelin guide (if available)
    - Curations (if exists)
    
    The response is optimized for LLM consumption with:
    - Clear boolean flags (is_open_now, open_on_weekend, etc.)
    - Structured opening hours by day of week
    - Consolidated ratings and scores
    - Optional raw source data for debugging
    
    Use this endpoint when the LLM needs to:
    - Provide comprehensive information about a restaurant
    - Answer questions about hours, ratings, amenities
    - Generate recommendations with full context
    
    Example use cases:
    - "Tell me about this restaurant"
    - "What are the opening hours?"
    - "Does it have a Michelin star?"
    """
    try:
        # Validate input
        if not request.place_id and not request.entity_id:
            raise HTTPException(
                status_code=400,
                detail="Either place_id or entity_id must be provided"
            )
        
        logger.info(f"LLM get-restaurant-snapshot: place_id={request.place_id}, entity_id={request.entity_id}")
        
        snapshot, sources_used = service.get_restaurant_snapshot(
            place_id=request.place_id,
            entity_id=request.entity_id,
            include_google_places=request.include_google_places,
            include_michelin=request.include_michelin,
            include_curations=request.include_curations,
            include_raw_sources=request.include_raw_sources,
            reference_datetime_iso=request.reference_datetime_iso,
            timezone=request.timezone
        )
        
        return LLMGetRestaurantSnapshotResponse(
            snapshot=snapshot,
            sources_used=sources_used,
            metadata={
                "requested_sources": {
                    "google_places": request.include_google_places,
                    "michelin": request.include_michelin,
                    "curations": request.include_curations
                },
                "timezone": request.timezone
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get-restaurant-snapshot: {e}")
        raise HTTPException(status_code=500, detail=f"Snapshot error: {str(e)}")


@router.post("/get-restaurant-availability", response_model=LLMGetRestaurantAvailabilityResponse)
def get_restaurant_availability(
    request: LLMGetRestaurantAvailabilityRequest,
    service: LLMPlaceService = Depends(get_llm_service)
):
    """
    Get restaurant availability and opening hours information.
    
    This endpoint is optimized for answering availability questions:
    - "Is it open now?"
    - "Does it open on weekends?"
    - "What days is it open?"
    
    It provides:
    - Current open/closed status
    - Weekend availability (configurable weekend days)
    - Detailed availability by day of week
    - Human-readable notes about availability
    
    This is a specialized endpoint that internally uses the snapshot logic
    but returns only availability-related information in a format optimized
    for natural language generation.
    
    Use this endpoint when the LLM needs to:
    - Answer specific availability questions
    - Check weekend hours
    - Verify current open status
    
    Example use cases:
    - "Is this restaurant open on Saturday?"
    - "Does it open for weekend brunch?"
    - "What are the weekend hours?"
    """
    try:
        # Validate input
        if not request.place_id and not request.entity_id:
            raise HTTPException(
                status_code=400,
                detail="Either place_id or entity_id must be provided"
            )
        
        logger.info(f"LLM get-restaurant-availability: place_id={request.place_id}, entity_id={request.entity_id}")
        
        availability_data = service.get_restaurant_availability(
            place_id=request.place_id,
            entity_id=request.entity_id,
            date_iso=request.date_iso,
            datetime_iso=request.datetime_iso,
            timezone=request.timezone,
            weekend_days=request.weekend_days
        )
        
        return LLMGetRestaurantAvailabilityResponse(**availability_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get-restaurant-availability: {e}")
        raise HTTPException(status_code=500, detail=f"Availability error: {str(e)}")


@router.get("/health")
async def health_check():
    """Health check endpoint for LLM Gateway"""
    return {
        "status": "healthy",
        "service": "llm_gateway",
        "endpoints": [
            "/llm/search-restaurants",
            "/llm/get-restaurant-snapshot",
            "/llm/get-restaurant-availability"
        ]
    }
