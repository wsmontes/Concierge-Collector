"""
OpenAIService: Interface with OpenAI APIs using MongoDB configuration.

Provides transcription (GPT-5.2 Audio), concept extraction (GPT-5.2), and image analysis (GPT-5.2)
using configurations and prompts stored in MongoDB.

Dependencies:
- openai: OpenAI Python client
- motor: Async MongoDB driver
- pymongo: Sync MongoDB driver
- pydantic: Data validation

Migration Status:
- Phase 1: Audio Transcription (whisper-1 → gpt-5.2-audio) ✅
- Phase 2: Concept Extraction (gpt-4 → gpt-5.2) ✅
- Phase 3: Image Analysis (gpt-4-vision → gpt-5.2) ✅

All services now use:
- Responses API (client.responses.parse)
- Pydantic structured outputs (text_format parameter)
- reasoning={"effort": "none"} for fast responses
- text={"verbosity": "low"} for -40% token savings
"""

import base64
import hashlib
import io
import json
import uuid
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from openai import OpenAI
from openai import BadRequestError
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import MongoClient
from pydantic import ValidationError
from fastapi import HTTPException
import os

from app.services.category_service import CategoryService
from app.services.openai_config_service import OpenAIConfigService
from app.models.ai_outputs import (
    TranscriptionOutput,
    ConceptExtractionOutput,
    ImageAnalysisOutput,
)


class OpenAIService:
    """OpenAI service using MongoDB configuration"""
    
    def __init__(self, api_key: str, db_url: str, db_name: str):
        """
        Initialize OpenAIService.
        
        Args:
            api_key: OpenAI API key
            db_url: MongoDB connection URL
            db_name: Database name
        """
        self.client = OpenAI(api_key=api_key)
        
        # Create Motor async client for db operations (insert_one, find_one)
        async_client = AsyncIOMotorClient(db_url)
        self.db = async_client[db_name]
        
        # Create sync PyMongo client for config_service (non-critical reads)
        sync_client = MongoClient(db_url)
        sync_db = sync_client[db_name]
        
        self.config_service = OpenAIConfigService(sync_db)
        self.category_service = CategoryService(self.db)
    
    async def transcribe_audio(
        self, 
        audio_data: Any, 
        language: Optional[str] = None,
        save_to_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Transcribe audio using GPT-4o Transcribe with automatic language detection.
        
        Phase 1 Migration:
        - Model: whisper-1 → gpt-4o-transcribe
        - Language: Auto-detection (unless explicitly overridden)
        - Validation: Pydantic schema enforcement
        
        Args:
            audio_data: Audio file object or base64 string
            language: Optional language override (e.g., "pt-BR", "en", "es")
                     If not provided, GPT-4o will auto-detect
            save_to_cache: Whether to save transcription to ai_transcriptions collection (default: True)
            
        Returns:
            Dictionary with transcription_id, text, language (auto-detected or override), model
            
        Raises:
            HTTPException(400): If transcription validation fails
            HTTPException(500): If OpenAI API call fails
        """
        # Get service configuration
        config = self.config_service.get_config("transcription")
        
        # Use GPT-4o Transcribe model (Phase 1 migration)
        model = "gpt-4o-transcribe"
        params = config["config"].copy()
        
        # Phase 1: Language auto-detection
        # Only set language if explicitly provided by user
        if language:
            # Normalize language to ISO-639-1 format (pt-BR → pt, en-US → en)
            normalized_lang = language.split('-')[0].lower()
            params["language"] = normalized_lang
            print(f"[DEBUG] Language override: {language} → {normalized_lang}")
        else:
            # Remove hardcoded language - let GPT-5.2 auto-detect
            params.pop("language", None)
            print(f"[DEBUG] Language auto-detection enabled")
        
        # Handle base64 audio data conversion
        try:
            if isinstance(audio_data, str):
                print(f"[DEBUG] Received base64 string, length: {len(audio_data)}")
                # Decode base64 string to bytes
                audio_bytes = base64.b64decode(audio_data)
                print(f"[DEBUG] Decoded to {len(audio_bytes)} bytes")
                # Create file-like object
                audio_file = io.BytesIO(audio_bytes)
                audio_file.name = "audio.mp3"  # OpenAI needs filename for format detection
                print(f"[DEBUG] Created BytesIO object with name: {audio_file.name}")
            else:
                print(f"[DEBUG] Received file object type: {type(audio_data)}")
                # Already a file object
                audio_file = audio_data
            
            # Call OpenAI GPT-5.2 Audio API
            print(f"[DEBUG] Calling OpenAI API with model: {model}")
            response = self.client.audio.transcriptions.create(
                model=model,
                file=audio_file,
                **params
            )
            print(f"[DEBUG] OpenAI response received, text length: {len(response.text)}")
            
            # Phase 1: Validate response with Pydantic schema
            try:
                validated = TranscriptionOutput(
                    text=response.text,
                    language=getattr(response, 'language', params.get('language', 'unknown')),
                    duration=getattr(response, 'duration', None),
                    words=getattr(response, 'words', None),
                    segments=getattr(response, 'segments', None)
                )
                print(f"[DEBUG] Validation successful - detected language: {validated.language}")
            except ValidationError as e:
                print(f"[ERROR] Transcription validation failed: {e}")
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid transcription format: {str(e)}"
                )
            
        except HTTPException:
            # Re-raise validation errors
            raise
        except BadRequestError as e:
            # Handle OpenAI validation errors (invalid audio, etc.)
            print(f"[ERROR] OpenAI BadRequest: {str(e)}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid audio data: {str(e)}"
            )
        except Exception as e:
            print(f"[ERROR] Audio transcription failed: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Transcription failed: {str(e)}"
            )
        
        transcription_id = f"trans_{uuid.uuid4().hex[:12]}"
        
        # Cache transcription in DB only if requested
        if save_to_cache:
            await self.db.ai_transcriptions.insert_one({
                "transcription_id": transcription_id,
                "text": validated.text,
                "language": validated.language,  # Now auto-detected
                "model": model,
                "duration": validated.duration,
                "words_count": len(validated.words) if validated.words else None,
                "segments_count": len(validated.segments) if validated.segments else None,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        
        return {
            "transcription_id": transcription_id,
            "text": validated.text,
            "language": validated.language,  # Auto-detected or override
            "model": model,
            "duration": validated.duration,
            "words_count": len(validated.words) if validated.words else None,
            "segments_count": len(validated.segments) if validated.segments else None
        }
    
    async def extract_concepts_from_text(
        self, 
        text: str, 
        entity_type: str = "restaurant",
        save_to_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Extract concepts from text using GPT-5.2 with Responses API and structured outputs.
        
        Phase 2 Migration:
        - Model: gpt-4 → gpt-5.2
        - API: Chat Completions → Responses API
        - Outputs: json.loads() → Pydantic validation
        - Reasoning: effort="none" (fastest, no chain-of-thought)
        - Verbosity: "low" (-40% output tokens)
        
        Args:
            text: Text to analyze
            entity_type: Type of entity (for category selection)
            save_to_cache: Whether to save concepts to ai_concepts collection (default: True)
            
        Returns:
            Dictionary with concepts, confidence_score, reasoning (optional), entity_type, model
            
        Raises:
            HTTPException(400): If concept extraction validation fails
            HTTPException(500): If OpenAI API call fails
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration (still read from MongoDB for prompt template)
        config = self.config_service.get_config("concept_extraction_text")
        
        # Render prompt with variables
        prompt = self.config_service.render_prompt(
            "concept_extraction_text",
            {
                "text": text,
                "categories": categories
            }
        )
        
        # Phase 2: Use GPT-5.2 with Responses API
        model = "gpt-5.2"
        
        try:
            print(f"[DEBUG] Calling GPT-5.2 Responses API for concept extraction")
            print(f"[DEBUG] Text length: {len(text)} chars, Categories: {len(categories)}")
            
            # Call OpenAI Responses API with structured outputs
            response = self.client.responses.parse(
                model=model,
                input=[
                    {"role": "user", "content": prompt}
                ],
                text_format=ConceptExtractionOutput,  # Pydantic schema for structured outputs
                reasoning={"effort": "none"},  # No chain-of-thought (fastest)
                text={"verbosity": "low"}  # -40% output tokens
            )
            
            print(f"[DEBUG] Response received, parsing output")
            
            # Phase 2: Pydantic validation built-in
            validated = response.output_parsed  # Already a ConceptExtractionOutput instance
            
            print(f"[DEBUG] Validation successful - concepts: {validated.concepts}, confidence: {validated.confidence_score}")
            
        except ValidationError as e:
            print(f"[ERROR] Concept extraction validation failed: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid concept extraction format: {str(e)}"
            )
        except Exception as e:
            print(f"[ERROR] Concept extraction failed: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Concept extraction failed: {str(e)}"
            )
        
        # Prepare result dictionary
        result = {
            "concepts": validated.concepts,
            "confidence_score": validated.confidence_score,
            "reasoning": validated.reasoning,
            "entity_type": entity_type,
            "model": model
        }
        
        # Cache concepts in DB only if requested
        if save_to_cache:
            concept_id = f"concept_{uuid.uuid4().hex[:12]}"
            await self.db.ai_concepts.insert_one({
                "concept_id": concept_id,
                "text": text,
                "concepts": validated.concepts,
                "confidence_score": validated.confidence_score,
                "reasoning": validated.reasoning,
                "entity_type": entity_type,
                "model": model,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        
        return result
    
    async def analyze_image(
        self, 
        image_url: str, 
        entity_type: str = "restaurant",
        save_to_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Analyze image using GPT-5.2 with Responses API and structured outputs.
        
        Phase 3 Migration:
        - Model: gpt-4-vision-preview → gpt-5.2
        - API: Chat Completions → Responses API
        - Outputs: json.loads() → Pydantic validation
        - Reasoning: effort="none" (fastest)
        - Verbosity: "low" (-40% output tokens)
        
        Args:
            image_url: URL of image or base64 data
            entity_type: Type of entity (for category selection)
            save_to_cache: Whether to save analysis to ai_image_analysis collection (default: True)
            
        Returns:
            Dictionary with description, detected_items, cuisine_inference, ambiance, confidence_score
            
        Raises:
            HTTPException(400): If image analysis validation fails
            HTTPException(500): If OpenAI API call fails
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration (still read from MongoDB for prompt template)
        config = self.config_service.get_config("image_analysis")
        
        # Render prompt with variables
        prompt = self.config_service.render_prompt(
            "image_analysis",
            {"categories": categories}
        )
        
        # Phase 3: Use GPT-5.2 with Responses API
        model = "gpt-5.2"
        
        try:
            print(f"[DEBUG] Calling GPT-5.2 Responses API for image analysis")
            print(f"[DEBUG] Image URL: {image_url[:100]}...")
            
            # Call OpenAI Responses API with structured outputs
            response = self.client.responses.parse(
                model=model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": image_url}
                        ]
                    }
                ],
                text_format=ImageAnalysisOutput,  # Pydantic schema for structured outputs
                reasoning={"effort": "none"},  # No chain-of-thought (fastest)
                text={"verbosity": "low"}  # -40% output tokens
            )
            
            print(f"[DEBUG] Response received, parsing output")
            
            # Phase 3: Pydantic validation built-in
            validated = response.output_parsed  # Already an ImageAnalysisOutput instance
            
            print(f"[DEBUG] Validation successful - detected {len(validated.detected_items)} items, confidence: {validated.confidence_score}")
            
        except ValidationError as e:
            print(f"[ERROR] Image analysis validation failed: {e}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid image analysis format: {str(e)}"
            )
        except BadRequestError as e:
            # Handle OpenAI validation errors (invalid URL, etc.)
            print(f"[ERROR] OpenAI BadRequest: {str(e)}")
            raise HTTPException(
                status_code=400,
                detail=f"Invalid image data: {str(e)}"
            )
        except Exception as e:
            print(f"[ERROR] Image analysis failed: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Image analysis failed: {str(e)}"
            )
        
        # Prepare result dictionary
        result = {
            "description": validated.description,
            "detected_items": [item.model_dump() for item in validated.detected_items],
            "cuisine_inference": validated.cuisine_inference,
            "ambiance": validated.ambiance,
            "confidence_score": validated.confidence_score,
            "entity_type": entity_type,
            "model": model
        }
        
        # Cache image analysis in DB only if requested
        if save_to_cache:
            analysis_id = f"img_analysis_{uuid.uuid4().hex[:12]}"
            await self.db.ai_image_analysis.insert_one({
                "analysis_id": analysis_id,
                "image_url": image_url,
                "description": validated.description,
                "detected_items": [item.model_dump() for item in validated.detected_items],
                "cuisine_inference": validated.cuisine_inference,
                "ambiance": validated.ambiance,
                "confidence_score": validated.confidence_score,
                "entity_type": entity_type,
                "model": model,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        
        return result
    
    async def get_usage_stats(self, days: int = 7) -> Dict[str, Any]:
        """
        Get AI usage statistics.
        
        Args:
            days: Number of days to look back
            
        Returns:
            Dictionary with usage stats by service
        """
        # TODO: Implement proper usage tracking with cost calculation
        stats = {
            "transcriptions": await self.db.ai_transcriptions.count_documents({}),
            "concept_extractions": await self.db.ai_concepts.count_documents({}),
            "image_analyses": await self.db.ai_image_analysis.count_documents({}),
            "days": days
        }
        
        return stats
