"""
File: places_orchestrate.py
Purpose: Google Places API orchestration endpoint - single endpoint for all place operations
Dependencies: fastapi, httpx, app.core.config
Last Updated: November 21, 2025

This module provides a unified orchestration endpoint for Google Places API (New).
Intelligently routes requests to the appropriate Places API based on input parameters.
"""

from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Optional, Literal
from pydantic import BaseModel, Field
import httpx
import logging

from app.core.config import settings

# Configure logging
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/places", tags=["places"])

# New Places API URLs
PLACES_API_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
PLACES_API_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
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
    place_ids: Optional[List[str]] = Field(None, description="List of Place IDs for bulk details lookup")
    
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
    operations: Optional[List[Dict[str, Any]]] = Field(None, description="List of operations to execute in bulk")


class PlacesOrchestrationResponse(BaseModel):
    """Unified response from Places orchestration"""
    operation: str = Field(..., description="Operation performed: nearby|text_search|details|autocomplete|bulk")
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
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.priceLevel"
    }
    
    body = {
        "locationRestriction": {
            "circle": {
                "center": {
                    "latitude": request.latitude,
                    "longitude": request.longitude
                },
                "radius": request.radius or 500.0
            }
        },
        "maxResultCount": min(request.max_results or 20, 20)
    }
    
    # Add optional filters
    if request.included_types:
        body["includedTypes"] = request.included_types
    if request.excluded_types:
        body["excludedTypes"] = request.excluded_types
    if request.rank_preference:
        body["rankPreference"] = request.rank_preference
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            PLACES_API_NEARBY_URL,
            headers=headers,
            json=body
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Places API error: {response.text}"
            )
        
        return response.json()


async def call_text_search(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    """Call Text Search API"""
    
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.types,places.priceLevel"
    }
    
    body = {
        "textQuery": request.query,
        "pageSize": min(request.max_results or 20, 20),
        "languageCode": request.language
    }
    
    # Add location bias if coordinates provided
    if request.latitude and request.longitude:
        body["locationBias"] = {
            "circle": {
                "center": {
                    "latitude": request.latitude,
                    "longitude": request.longitude
                },
                "radius": request.radius or 500.0
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
        response = await client.post(
            PLACES_API_TEXT_SEARCH_URL,
            headers=headers,
            json=body
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Places API error: {response.text}"
            )
        
        return response.json()


async def call_place_details(request: PlacesOrchestrationRequest) -> Dict[str, Any]:
    """Call Place Details API"""
    
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": settings.google_places_api_key,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,types,priceLevel,nationalPhoneNumber,websiteUri,regularOpeningHours"
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
            params=params
        )
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Places API error: {response.text}"
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
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location,rating,types,priceLevel,nationalPhoneNumber,websiteUri,regularOpeningHours"
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
            task = client.get(
                f"{PLACES_API_DETAILS_URL}/{place_id}",
                headers=headers,
                params=params
            )
            tasks.append((place_id, task))
        
        # Execute all requests in parallel
        for place_id, task in tasks:
            try:
                response = await task
                if response.status_code == 200:
                    results.append(response.json())
                else:
                    errors.append({
                        "place_id": place_id,
                        "status_code": response.status_code,
                        "error": response.text
                    })
            except Exception as e:
                errors.append({
                    "place_id": place_id,
                    "error": str(e)
                })
    
    return {
        "places": results,
        "errors": errors,
        "total_requested": len(place_ids),
        "total_success": len(results),
        "total_errors": len(errors)
    }


async def call_bulk_multi_operations(operations: List[Dict[str, Any]], base_request: PlacesOrchestrationRequest) -> Dict[str, Any]:
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
            base_dict.pop('operations', None)  # Remove operations to prevent recursion
            base_dict.pop('place_ids', None)   # Remove place_ids to prevent confusion
            
            op_request = PlacesOrchestrationRequest(
                **{**base_dict, **op_config}
            )
            
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
            all_errors.append({
                "operation": op_config,
                "error": str(e)
            })
    
    return {
        "places": all_results,
        "errors": all_errors,
        "operations_executed": operations_executed,
        "total_operations": len(operations),
        "total_success": len(operations) - len(all_errors),
        "total_errors": len(all_errors)
    }


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.post("/orchestrate", response_model=PlacesOrchestrationResponse)
async def orchestrate_places_request(request: PlacesOrchestrationRequest):
    """
    Unified orchestration endpoint for Google Places API.
    
    Automatically determines the best API to use based on your input:
    - Place IDs list -> Bulk Details API
    - Operations list -> Multi-operation bulk mode
    - Place ID -> Details API
    - Text query -> Text Search API
    - Location + types -> Nearby Search API
    
    Examples:
    - Search by name: `{"query": "pizza restaurants"}`
    - Search nearby: `{"latitude": 37.7749, "longitude": -122.4194, "included_types": ["restaurant"]}`
    - Get details: `{"place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4"}`
    - Bulk details: `{"place_ids": ["ChIJ...", "ChIJ..."]}`
    - Multi-operation: `{"operations": [{"query": "pizza"}, {"latitude": 37.7, "longitude": -122.4}]}`
    """
    
    try:
        # Determine which operation to perform
        operation = determine_operation(request)
        logger.info(f"Orchestrating Places API request: operation={operation}")
        
        errors = None
        operations_executed = None
        
        # Call appropriate API
        if operation == "bulk_multi":
            # Execute multiple different operations
            if not request.operations:
                raise HTTPException(status_code=400, detail="operations list is required for bulk_multi mode")
            data = await call_bulk_multi_operations(request.operations, request)
            results = data.get("places", [])
            errors = data.get("errors") if data.get("errors") else None
            operations_executed = data.get("operations_executed")
            operation = "bulk"
            
        elif operation == "bulk_details":
            # Bulk details lookup for multiple place IDs
            if not request.place_ids:
                raise HTTPException(status_code=400, detail="place_ids list is required for bulk_details mode")
            data = await call_bulk_details(request.place_ids, request)
            results = data.get("places", [])
            errors = data.get("errors") if data.get("errors") else None
            operations_executed = ["details"] * data.get("total_requested", 0)
            operation = "bulk"
            
        elif operation == "details":
            data = await call_place_details(request)
            results = [data]  # Wrap single result in array
            
        elif operation == "text_search":
            data = await call_text_search(request)
            results = data.get("places", [])
            
        elif operation == "nearby":
            data = await call_nearby_search(request)
            results = data.get("places", [])
            
        else:
            raise HTTPException(
                status_code=400,
                detail="Unable to determine operation from request parameters"
            )
        
        # Build response
        return PlacesOrchestrationResponse(
            operation=operation,
            results=results,
            total_results=len(results),
            next_page_token=data.get("nextPageToken") if operation not in ["bulk", "bulk_details", "bulk_multi"] else None,
            operations_executed=operations_executed,
            errors=errors
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Places orchestration error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Internal error: {str(e)}"
        )


@router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "places_orchestration",
        "api_key_configured": bool(settings.google_places_api_key)
    }
