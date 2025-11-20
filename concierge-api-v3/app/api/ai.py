"""
AI Router: Endpoints for AI services and orchestration.

Handles transcription, concept extraction, image analysis, and intelligent orchestration.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import os

from app.core.database import get_database
from app.core.security import verify_access_token
from app.services.openai_service import OpenAIService
from app.services.ai_orchestrator import AIOrchestrator


router = APIRouter(prefix="/ai", tags=["AI Services"])


# Pydantic Models
class OrchestrateRequest(BaseModel):
    """Request model for AI orchestration endpoint"""
    
    workflow_type: str = Field(
        default="auto",
        description="Workflow type: auto, place_id, entity_id, audio_only, image_only, etc."
    )
    
    # Input sources (at least one required)
    place_id: Optional[str] = Field(None, description="Google Place ID")
    entity_id: Optional[str] = Field(None, description="Existing entity ID")
    audio_file: Optional[str] = Field(None, description="Audio file (base64 encoded)")
    audio_url: Optional[str] = Field(None, description="Audio file URL")
    image_file: Optional[str] = Field(None, description="Image file (base64 encoded)")
    image_url: Optional[str] = Field(None, description="Image URL")
    text: Optional[str] = Field(None, description="Direct text input")
    
    # Output control (optional with smart defaults)
    output: Optional[Dict[str, Any]] = Field(
        None,
        description="Output configuration: save_to_db, return_results, format"
    )
    
    # Optional parameters
    language: Optional[str] = Field("pt-BR", description="Language for transcription")
    curator_id: Optional[str] = Field(None, description="Curator ID")
    entity_type: Optional[str] = Field("restaurant", description="Entity type")
    
    class Config:
        json_schema_extra = {
            "example": {
                "audio_file": "base64_encoded_audio...",
                "entity_type": "restaurant"
            }
        }


class OrchestrateResponse(BaseModel):
    """Response model for AI orchestration"""
    workflow: str
    results: Dict[str, Any]
    saved_to_db: bool
    processing_time_ms: int


# Dependency to get OpenAI service
async def get_openai_service(db = Depends(get_database)):
    """Get OpenAI service instance"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY not configured"
        )
    return OpenAIService(api_key, db)


# Dependency to get AI orchestrator
async def get_ai_orchestrator(
    db = Depends(get_database),
    openai_service = Depends(get_openai_service)
):
    """Get AI orchestrator instance"""
    # TODO: Add places_service when available
    return AIOrchestrator(db, openai_service, places_service=None)


@router.post("/orchestrate", response_model=OrchestrateResponse)
async def orchestrate(
    request: OrchestrateRequest,
    orchestrator: AIOrchestrator = Depends(get_ai_orchestrator),
    token_data: dict = Depends(verify_access_token)  # Require JWT authentication
):
    """
    Intelligent AI workflow orchestration.
    
    **Authentication Required:** Include `Authorization: Bearer <token>` header
    **⚠️  Costs Money:** Uses OpenAI API - monitor usage
    
    Combines multiple AI services (transcription, concept extraction, image analysis)
    in smart workflows with flexible output control.
    
    **Smart Defaults:**
    - No `output` object = return full results without saving
    - With `output` but missing fields = defaults applied
    - Default `entity_type` = "restaurant"
    - Default `format` = "full"
    
    **Workflows:**
    - `audio_only`: Transcribe + extract concepts
    - `image_only`: Analyze image visually
    - `place_id_with_audio`: Create entity + transcribe + extract concepts
    - `place_id_with_image`: Create entity + analyze image
    - `place_id_with_audio_and_image`: Combine all sources
    
    **Examples:**
    ```python
    # Simple: audio only, no config
    {"audio_file": "base64..."}
    # Returns transcription + concepts without saving
    
    # Preview before saving
    {"place_id": "ChIJ...", "audio_file": "...", "output": {"save_to_db": false}}
    
    # Save without returning (batch efficient)
    {"place_id": "...", "audio_file": "...", "output": {"save_to_db": true, "format": "ids_only"}}
    ```
    """
    try:
        # Convert Pydantic model to dict
        request_dict = request.model_dump(exclude_none=True)
        
        # Orchestrate
        result = await orchestrator.orchestrate(request_dict)
        
        return result
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Orchestration failed: {str(e)}"
        )


@router.get("/usage-stats")
async def get_usage_stats(
    days: int = 7,
    openai_service: OpenAIService = Depends(get_openai_service)
):
    """
    Get AI usage statistics.
    
    Returns counts of transcriptions, concept extractions, and image analyses
    for the specified number of days.
    """
    try:
        stats = await openai_service.get_usage_stats(days)
        return stats
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get usage stats: {str(e)}"
        )


@router.get("/health")
async def health_check(db = Depends(get_database)):
    """Health check for AI services"""
    try:
        # Check if MongoDB collections exist
        collections = await db.list_collection_names()
        
        has_categories = "categories" in collections
        has_configs = "openai_configs" in collections
        
        # Count documents
        category_count = await db.categories.count_documents({"active": True}) if has_categories else 0
        config_count = await db.openai_configs.count_documents({"enabled": True}) if has_configs else 0
        
        return {
            "status": "healthy",
            "categories_configured": category_count,
            "services_enabled": config_count,
            "openai_api_key_set": bool(os.getenv("OPENAI_API_KEY"))
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Health check failed: {str(e)}"
        )
