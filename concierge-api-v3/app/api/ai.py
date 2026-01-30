"""
AI Router: Endpoints for AI services and orchestration.

Handles transcription, concept extraction, image analysis, and intelligent orchestration.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import os
import secrets

from app.core.database import get_database
from app.core.security import verify_access_token, api_key_header, bearer_scheme, get_api_secret_key
from app.services.openai_service import OpenAIService
from app.services.ai_orchestrator import AIOrchestrator
from jose import jwt, JWTError


router = APIRouter(prefix="/ai", tags=["AI Services"])


async def verify_auth(
    api_key: Optional[str] = Depends(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)
) -> dict:
    """Verify either OAuth token or API key"""
    # Try API key first
    if api_key:
        try:
            expected_key = get_api_secret_key()
            if secrets.compare_digest(api_key, expected_key):
                return {"authenticated": True, "method": "api_key"}
        except:
            pass
    
    # Try Bearer token
    if bearer:
        try:
            from app.core.security import ALGORITHM
            payload = jwt.decode(bearer.credentials, get_api_secret_key(), algorithms=[ALGORITHM])
            return {"authenticated": True, "method": "jwt", "user": payload.get("sub")}
        except JWTError:
            pass
    
    raise HTTPException(status_code=401, detail="Missing authorization token")


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
def get_openai_service():
    """Get OpenAI service instance"""
    from app.core.config import settings
    
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY not configured"
        )
    
    return OpenAIService(api_key, settings.mongodb_url, settings.mongodb_db_name)


# Dependency to get AI orchestrator
def get_ai_orchestrator(
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
    auth: dict = Depends(verify_auth)  # Support both API key and JWT
):
    """
    Intelligent AI workflow orchestration.
    
    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header
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
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        logger.info("=" * 60)
        logger.info("[AI Orchestrate] New request received")
        logger.info(f"[AI Orchestrate] User: {auth.get('user', 'unknown')}")
        logger.info(f"[AI Orchestrate] Has audio: {request.audio_file is not None}")
        logger.info(f"[AI Orchestrate] Has image: {request.image_file is not None}")
        logger.info(f"[AI Orchestrate] Has text: {request.text is not None}")
        logger.info(f"[AI Orchestrate] Language: {request.language}")
        logger.info(f"[AI Orchestrate] Entity type: {request.entity_type}")
        
        # Convert Pydantic model to dict
        request_dict = request.model_dump(exclude_none=True)
        
        # Orchestrate (MUST await async method)
        logger.info("[AI Orchestrate] Starting orchestration...")
        result = await orchestrator.orchestrate(request_dict)
        
        logger.info("[AI Orchestrate] ✓ Orchestration successful")
        logger.info("=" * 60)
        return result
    
    except ValueError as e:
        logger.error(f"[AI Orchestrate] ✗ ValueError: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"[AI Orchestrate] ✗ Exception: {str(e)}", exc_info=True)
        logger.error("=" * 60)
        
        # Check if it's an OpenAI BadRequestError (400)
        from openai import BadRequestError
        if isinstance(e.__cause__, BadRequestError) or isinstance(e, BadRequestError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid request: {str(e)}"
            )
        
        # Generic 500 error for other exceptions
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
def health_check(db = Depends(get_database)):
    """
    Health check for AI services.
    
    Verifies:
    - OpenAI API key is configured
    - MongoDB connection is working
    - Required collections exist
    
    **No authentication required** - use this to diagnose issues
    """
    import logging
    logger = logging.getLogger(__name__)
    
    try:
        health_status = {
            "service": "AI Services",
            "status": "healthy",
            "checks": {}
        }
        
        # Check OpenAI API key
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            health_status["checks"]["openai_api_key"] = {
                "status": "configured",
                "key_prefix": api_key[:10] + "..."
            }
        else:
            health_status["status"] = "unhealthy"
            health_status["checks"]["openai_api_key"] = {
                "status": "missing",
                "error": "OPENAI_API_KEY environment variable not set"
            }
            logger.error("[AI Health] ✗ OPENAI_API_KEY not configured")
        
        # Check MongoDB collections
        try:
            collections = db.list_collection_names()
            has_categories = "categories" in collections
            
            health_status["checks"]["mongodb"] = {
                "status": "connected",
                "collections_count": len(collections),
                "has_categories": has_categories
            }
            
            if not has_categories:
                logger.warning("[AI Health] ⚠ Categories collection not found")
                health_status["checks"]["mongodb"]["warning"] = "Categories collection missing"
                
        except Exception as db_error:
            health_status["status"] = "degraded"
            health_status["checks"]["mongodb"] = {
                "status": "error",
                "error": str(db_error)
            }
            logger.error(f"[AI Health] ✗ MongoDB error: {str(db_error)}")
        
        logger.info(f"[AI Health] Status: {health_status['status']}")
        return health_status
        
    except Exception as e:
        logger.error(f"[AI Health] ✗ Health check failed: {str(e)}")
        return {
            "service": "AI Services",
            "status": "error",
            "error": str(e)
        }


@router.get("/health/original")
def health_check_original(db = Depends(get_database)):
    """Health check for AI services - original implementation"""
    try:
        # Check if MongoDB collections exist
        collections = db.list_collection_names()
        
        has_categories = "categories" in collections
        has_configs = "openai_configs" in collections
        
        # Count documents
        category_count = db.categories.count_documents({"active": True}) if has_categories else 0
        config_count = db.openai_configs.count_documents({"enabled": True}) if has_configs else 0
        
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
