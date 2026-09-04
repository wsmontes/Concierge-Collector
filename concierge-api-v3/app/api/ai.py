"""
AI Router: Endpoints for AI services and orchestration.

Handles transcription, concept extraction, image analysis, and intelligent orchestration.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

from app.core.database import get_database
from app.core.security import is_admin_auth, require_role
from app.models.user import has_role
from app.services.openai_service import OpenAIService
from app.services.ai_orchestrator import AIOrchestrator
from app.core.rate_limit import limiter, auth_header_key

router = APIRouter(prefix="/ai", tags=["AI Services"])


# Pydantic Models
class OrchestrateRequest(BaseModel):
    """Request model for AI orchestration endpoint"""

    workflow_type: str = Field(
        default="auto",
        description="Workflow type: auto, place_id, entity_id, audio_only, image_only, etc.",
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
        None, description="Output configuration: save_to_db, return_results, format"
    )

    # Optional parameters
    language: Optional[str] = Field("pt-BR", description="Language for transcription")
    curator_id: Optional[str] = Field(None, description="Curator ID")
    entity_type: Optional[str] = Field("restaurant", description="Entity type")

    class Config:
        json_schema_extra = {
            "example": {
                "audio_file": "base64_encoded_audio...",
                "entity_type": "restaurant",
            }
        }


class OrchestrateResponse(BaseModel):
    """Response model for AI orchestration"""

    workflow: str
    results: Dict[str, Any]
    saved_to_db: bool
    processing_time_ms: int


class RestaurantNameExtractionRequest(BaseModel):
    """Request model for restaurant name extraction from text"""

    text: str = Field(..., min_length=1, max_length=20_000, description="Text to analyze")


class RestaurantNameExtractionResponse(BaseModel):
    """Response model for restaurant name extraction"""

    restaurant_name: Optional[str]
    confidence_score: Optional[float] = None
    model: Optional[str] = None
    service: str


# Dependency to get OpenAI service
def get_openai_service(request: Request):
    """Get the OpenAIService singleton criado no startup (lifespan).

    Uma instância por processo — os clients OpenAI/Motor/PyMongo são caros de
    criar e vazam conexões se recriados por request.
    """
    service = getattr(request.app.state, "openai_service", None)
    if service is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY not configured",
        )
    return service


# Dependency to get AI orchestrator
def get_ai_orchestrator(db=Depends(get_database), openai_service=Depends(get_openai_service)):
    """Get AI orchestrator instance.

    Google Places wiring is intentionally deferred outside the Collections
    production closeout. Workflows that require `place_id` fail explicitly with
    HTTP 501 until a Places service is injected; audio/image/text workflows are
    unaffected.
    """
    return AIOrchestrator(db, openai_service, places_service=None)


@router.post("/orchestrate", response_model=OrchestrateResponse)
@limiter.limit("10/minute", key_func=auth_header_key)
async def orchestrate(
    request: Request,
    payload: OrchestrateRequest,
    auth: dict = Depends(require_role("viewer")),
    orchestrator: AIOrchestrator = Depends(get_ai_orchestrator),
):
    """
    Intelligent AI workflow orchestration.

    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header
    **⚠️  Costs Money:** Uses OpenAI API - monitor usage

    Human authorization is reloaded from Mongo before any paid work. A viewer
    may preview AI output, but saving still requires the live curator role.

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
        logger.info(f"[AI Orchestrate] Has audio: {payload.audio_file is not None}")
        logger.info(f"[AI Orchestrate] Has image: {payload.image_file is not None}")
        logger.info(f"[AI Orchestrate] Has text: {payload.text is not None}")
        logger.info(f"[AI Orchestrate] Language: {payload.language}")
        logger.info(f"[AI Orchestrate] Entity type: {payload.entity_type}")

        # Convert Pydantic model to dict
        request_dict = payload.model_dump(exclude_none=True)

        # Saving is a write: check the live role returned by require_role.
        wants_save = bool(request_dict.get("output", {}).get("save_to_db"))
        if wants_save and not is_admin_auth(auth) and not has_role(auth.get("role", "viewer"), "curator"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Viewer role cannot save orchestrator results",
            )

        # Curator derived from the authenticated identity; body curator_id is
        # ignored for human writes to preserve ownership.
        if auth.get("method") == "jwt":
            request_dict["curator_id"] = auth.get("user")

        logger.info("[AI Orchestrate] Starting orchestration...")
        result = await orchestrator.orchestrate(request_dict, auth=auth)

        logger.info("[AI Orchestrate] ✓ Orchestration successful")
        logger.info("=" * 60)
        return result

    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"[AI Orchestrate] ✗ ValueError: {str(e)}")
        if "Places service not configured" in str(e):
            raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(e))
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"[AI Orchestrate] ✗ Exception: {str(e)}", exc_info=True)
        logger.error("=" * 60)

        from openai import BadRequestError

        if isinstance(e.__cause__, BadRequestError) or isinstance(e, BadRequestError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid AI request",
            )

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI orchestration failed",
        )


@router.post("/extract-restaurant-name", response_model=RestaurantNameExtractionResponse)
@limiter.limit("20/minute", key_func=auth_header_key)
async def extract_restaurant_name(
    request: Request,
    payload: RestaurantNameExtractionRequest,
    openai_service: OpenAIService = Depends(get_openai_service),
    auth: dict = Depends(require_role("viewer")),
):
    """
    Extract restaurant name from text using dedicated OpenAI MongoDB configuration.

    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header.
    Human authorization is reloaded from Mongo before the provider is called.
    """
    try:
        result = await openai_service.extract_restaurant_name_from_text(payload.text, save_to_cache=False)
        return result
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        import logging

        logging.getLogger(__name__).error("Restaurant name extraction failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Restaurant name extraction failed",
        )
