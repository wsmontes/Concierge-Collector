"""
File: llm_gateway.py
Purpose: FastAPI router for LLM Gateway API endpoints
Dependencies: fastapi, app.services.llm_place_service, app.models.llm_models
Last Updated: November 21, 2025

This router provides LLM-friendly endpoints for restaurant data access.
These endpoints consolidate data from Google Places, MongoDB entities,
Michelin guide, and curations into unified responses optimized for LLM consumption.
"""

from fastapi import APIRouter, HTTPException, Depends, Request
import logging

from app.models.llm_models import (
    LLMSearchRestaurantsRequest,
    LLMSearchRestaurantsResponse,
    LLMGetRestaurantSnapshotRequest,
    LLMGetRestaurantSnapshotResponse,
    LLMGetRestaurantAvailabilityRequest,
    LLMGetRestaurantAvailabilityResponse,
)
from app.models.llm_tools import get_all_tools, get_tools_manifest
from app.core.rate_limit import limiter
from app.core.security import require_role
from app.services.llm_place_service import LLMPlaceService
from app.core.database import get_database

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/llm", tags=["llm"])


def get_llm_service() -> LLMPlaceService:
    """Dependency to get LLMPlaceService instance"""
    return LLMPlaceService(database=get_database())


@router.post("/search-restaurants", response_model=LLMSearchRestaurantsResponse)
@limiter.limit("20/minute")
def search_restaurants(
    request: Request,
    body: LLMSearchRestaurantsRequest,
    service: LLMPlaceService = Depends(get_llm_service),
    # require_role("curator") e não auth só de token: o serviço auto-cria/
    # atualiza documents em `entities`, então o role atual precisa vir do DB.
    auth: dict = Depends(require_role("curator")),
):
    """
    Search for restaurants by name or query.

    This endpoint:
    - Searches for restaurants matching the query
    - Returns basic information suitable for LLM consumption
    - Includes flags for entity existence and Michelin data
    - Optimized for quick disambiguation and selection
    """
    try:
        logger.info(f"LLM search-restaurants: query='{body.query}', location=({body.latitude}, {body.longitude})")

        items = service.search_restaurants(
            query=body.query,
            latitude=body.latitude,
            longitude=body.longitude,
            radius_m=body.radius_m,
            max_results=body.max_results,
            language=body.language,
            region=body.region,
        )

        return LLMSearchRestaurantsResponse(
            items=items,
            total_results=len(items),
            search_metadata={
                "query": body.query,
                "location_biased": body.latitude is not None and body.longitude is not None,
            },
        )

    except Exception as e:
        logger.error("Error in search-restaurants: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Restaurant search failed")


@router.post("/get-restaurant-snapshot", response_model=LLMGetRestaurantSnapshotResponse)
@limiter.limit("20/minute")
def get_restaurant_snapshot(
    request: Request,
    body: LLMGetRestaurantSnapshotRequest,
    service: LLMPlaceService = Depends(get_llm_service),
    # Mesma regra de search-restaurants: snapshot dispara escrita em
    # `entities` (auto-create/update via Google) — exige role >= curator.
    auth: dict = Depends(require_role("curator")),
):
    """Get complete restaurant snapshot with all available data."""
    try:
        if not body.place_id and not body.entity_id:
            raise HTTPException(status_code=400, detail="Either place_id or entity_id must be provided")

        logger.info(f"LLM get-restaurant-snapshot: place_id={body.place_id}, entity_id={body.entity_id}")

        snapshot, sources_used = service.get_restaurant_snapshot(
            place_id=body.place_id,
            entity_id=body.entity_id,
            include_google_places=body.include_google_places,
            include_michelin=body.include_michelin,
            include_curations=body.include_curations,
            include_raw_sources=body.include_raw_sources,
            reference_datetime_iso=body.reference_datetime_iso,
            timezone=body.timezone,
        )

        return LLMGetRestaurantSnapshotResponse(
            snapshot=snapshot,
            sources_used=sources_used,
            metadata={
                "requested_sources": {
                    "google_places": body.include_google_places,
                    "michelin": body.include_michelin,
                    "curations": body.include_curations,
                },
                "timezone": body.timezone,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error in get-restaurant-snapshot: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Restaurant snapshot failed")


@router.post("/get-restaurant-availability", response_model=LLMGetRestaurantAvailabilityResponse)
@limiter.limit("20/minute")
def get_restaurant_availability(
    request: Request,
    body: LLMGetRestaurantAvailabilityRequest,
    service: LLMPlaceService = Depends(get_llm_service),
    auth: dict = Depends(require_role("viewer")),
):
    """Get restaurant availability and opening hours information."""
    try:
        if not body.place_id and not body.entity_id:
            raise HTTPException(status_code=400, detail="Either place_id or entity_id must be provided")

        logger.info(f"LLM get-restaurant-availability: place_id={body.place_id}, entity_id={body.entity_id}")

        availability_data = service.get_restaurant_availability(
            place_id=body.place_id,
            entity_id=body.entity_id,
            date_iso=body.date_iso,
            datetime_iso=body.datetime_iso,
            timezone=body.timezone,
            weekend_days=body.weekend_days,
        )

        return LLMGetRestaurantAvailabilityResponse(**availability_data)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Error in get-restaurant-availability: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Restaurant availability failed")


@router.get("/health")
async def health_check():
    """Public liveness for the LLM Gateway; it performs no provider/database work."""
    return {
        "status": "healthy",
        "service": "llm_gateway",
        "endpoints": [
            "/llm/search-restaurants",
            "/llm/get-restaurant-snapshot",
            "/llm/get-restaurant-availability",
            "/llm/tools",
            "/llm/tools-manifest",
        ],
    }


@router.get("/tools")
def get_tools(auth: dict = Depends(require_role("viewer"))):
    """Return MCP tool definitions to a currently authorized user."""
    return {"tools": get_all_tools()}


@router.get("/tools-manifest")
def get_manifest(auth: dict = Depends(require_role("viewer"))):
    """Return the complete tools manifest to a currently authorized user."""
    return get_tools_manifest()
