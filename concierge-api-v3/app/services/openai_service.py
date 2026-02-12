"""
OpenAIService: Interface with OpenAI APIs using MongoDB configuration.

Provides transcription (Whisper), concept extraction (GPT-4), and image analysis (GPT-4 Vision)
using configurations and prompts stored in MongoDB.
"""

import base64
import hashlib
import io
import json
import uuid
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from openai import OpenAI
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import MongoClient
import os

from app.services.category_service import CategoryService
from app.services.openai_config_service import OpenAIConfigService


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
        Transcribe audio using Whisper with MongoDB config.
        
        Args:
            audio_data: Audio file object or base64 string
            language: Language code (overrides config default)
            save_to_cache: Whether to save transcription to ai_transcriptions collection (default: True)
            
        Returns:
            Dictionary with transcription_id, text, language, model
        """
        # Get service configuration
        config = self.config_service.get_config("transcription")
        
        # Use config parameters
        model = config["model"]
        params = config["config"].copy()
        if language:
            # Normalize language to ISO-639-1 format (pt-BR → pt)
            normalized_lang = language.split('-')[0].lower()
            params["language"] = normalized_lang
        
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
            
            # Call OpenAI
            print(f"[DEBUG] Calling OpenAI Whisper API with model: {model}")
            response = self.client.audio.transcriptions.create(
                model=model,
                file=audio_file,
                **params
            )
            print(f"[DEBUG] OpenAI response received, text length: {len(response.text)}")
        except Exception as e:
            print(f"[ERROR] Audio transcription failed: {type(e).__name__}: {str(e)}")
            import traceback
            traceback.print_exc()
            raise
        
        transcription_id = f"trans_{uuid.uuid4().hex[:12]}"
        
        # Cache transcription in DB only if requested
        if save_to_cache:
            await self.db.ai_transcriptions.insert_one({
                "transcription_id": transcription_id,
                "text": response.text,
                "language": params.get("language", "pt-BR"),
                "model": model,
                "duration": getattr(response, 'duration', None),
                "created_at": datetime.now(timezone.utc).isoformat()
            })
        
        return {
            "transcription_id": transcription_id,
            "text": response.text,
            "language": params.get("language", "pt-BR"),
            "model": model,
            "duration": getattr(response, 'duration', None)
        }
    
    async def extract_concepts_from_text(
        self, 
        text: str, 
        entity_type: str = "restaurant",
        save_to_cache: bool = True
    ) -> Dict[str, Any]:
        """
        Extract concepts from text using GPT-4 with MongoDB config.
        
        Args:
            text: Text to analyze
            entity_type: Type of entity (for category selection)
            save_to_cache: Whether to save concepts to ai_concepts collection (default: True)
            
        Returns:
            Dictionary with concepts, confidence_score, entity_type, model
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration
        config = self.config_service.get_config("concept_extraction_text")
        
        # Render prompt with variables
        prompt = self.config_service.render_prompt(
            "concept_extraction_text",
            {
                "text": text,
                "categories": categories
            }
        )
        
        # Call OpenAI
        response = self.client.chat.completions.create(
            model=config["model"],
            messages=[{"role": "user", "content": prompt}],
            **config["config"]
        )
        
        # Parse JSON response
        result = json.loads(response.choices[0].message.content)
        result["entity_type"] = entity_type
        result["model"] = config["model"]
        
        # Cache concepts in DB only if requested
        if save_to_cache:
            concept_id = f"concept_{uuid.uuid4().hex[:12]}"
            await self.db.ai_concepts.insert_one({
                "concept_id": concept_id,
                "text": text,
                "concepts": result.get("concepts", []),
                "restaurant_name": result.get("restaurant_name"),
                "confidence_score": result.get("confidence_score", 0.0),
                "entity_type": entity_type,
                "model": config["model"],
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
        Analyze image using GPT-4 Vision with MongoDB config.
        
        Args:
            image_url: URL of image or base64 data
            entity_type: Type of entity (for category selection)
            save_to_cache: Whether to save analysis to ai_image_analysis collection (default: True)
            
        Returns:
            Dictionary with concepts, confidence_score, visual_notes, entity_type, model
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration
        config = self.config_service.get_config("image_analysis")
        
        # Render prompt with variables
        prompt = self.config_service.render_prompt(
            "image_analysis",
            {"categories": categories}
        )
        
        # Call OpenAI Vision
        response = self.client.chat.completions.create(
            model=config["model"],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url", 
                            "image_url": {
                                "url": image_url,
                                "detail": config["config"].get("detail", "high")
                            }
                        }
                    ]
                }
            ],
            temperature=config["config"].get("temperature", 0.3),
            max_tokens=config["config"].get("max_tokens", 300)
        )
        
        # Parse JSON response
        result = json.loads(response.choices[0].message.content)
        result["entity_type"] = entity_type
        result["model"] = config["model"]
        
        # Cache image analysis in DB only if requested
        if save_to_cache:
            analysis_id = f"img_analysis_{uuid.uuid4().hex[:12]}"
            await self.db.ai_image_analysis.insert_one({
                "analysis_id": analysis_id,
                "image_url": image_url,
                "concepts": result.get("concepts", []),
                "confidence_score": result.get("confidence_score", 0.0),
                "visual_notes": result.get("visual_notes", ""),
                "entity_type": entity_type,
                "model": config["model"],
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
