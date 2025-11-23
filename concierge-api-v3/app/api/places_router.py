"""
File: places_router.py
Purpose: REST endpoints for Google Places data (photos, details, etc.)
Dependencies: fastapi, app.services.llm_place_service
Last Updated: November 22, 2025

Provides direct REST access to Google Places data without LLM context.
"""

from fastapi import APIRouter, HTTPException, Depends, Query
from typing import Optional
import logging

from app.services.llm_place_service import LLMPlaceService
from app.core.database import get_database

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/places", tags=["places"])


def get_llm_service() -> LLMPlaceService:
    """Dependency to get LLMPlaceService instance"""
    return LLMPlaceService(database=get_database())


@router.get("/{place_id}/photos")
async def get_place_photos(
    place_id: str,
    max_photos: int = Query(10, ge=1, le=10, description="Maximum number of photos (1-10)"),
    max_width: Optional[int] = Query(None, ge=400, le=4800, description="Maximum width in pixels (400-4800)"),
    max_height: Optional[int] = Query(None, ge=400, le=4800, description="Maximum height in pixels (400-4800)"),
    include_metadata: bool = Query(True, description="Include original dimensions and attributions"),
    language: str = Query("pt-BR", description="Language code for attributions"),
    service: LLMPlaceService = Depends(get_llm_service)
):
    """
    Get restaurant photos from Google Places.
    
    Returns photo URLs and optional metadata (dimensions, attributions).
    Photos are automatically resized if max_width or max_height specified.
    
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
          "url": "https://places.googleapis.com/...",
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
            language=language
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
