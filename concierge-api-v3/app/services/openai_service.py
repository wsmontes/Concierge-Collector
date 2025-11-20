"""
OpenAIService: Interface with OpenAI APIs using MongoDB configuration.

Provides transcription (Whisper), concept extraction (GPT-4), and image analysis (GPT-4 Vision)
using configurations and prompts stored in MongoDB.
"""

import hashlib
import json
import uuid
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from openai import OpenAI
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.category_service import CategoryService
from app.services.openai_config_service import OpenAIConfigService


class OpenAIService:
    """OpenAI service using MongoDB configuration"""
    
    def __init__(self, api_key: str, db: AsyncIOMotorDatabase):
        """
        Initialize OpenAIService.
        
        Args:
            api_key: OpenAI API key
            db: MongoDB database instance
        """
        self.client = OpenAI(api_key=api_key)
        self.db = db
        self.config_service = OpenAIConfigService(db)
        self.category_service = CategoryService(db)
    
    async def transcribe_audio(
        self, 
        audio_data: Any, 
        language: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Transcribe audio using Whisper with MongoDB config.
        
        Args:
            audio_data: Audio file object or base64 string
            language: Language code (overrides config default)
            
        Returns:
            Dictionary with transcription_id, text, language, model
        """
        # Get service configuration
        config = await self.config_service.get_config("transcription")
        
        # Use config parameters
        model = config["model"]
        params = config["config"].copy()
        if language:
            params["language"] = language
        
        # TODO: Handle audio_data conversion if base64
        # For now, assume it's a file object
        
        # Call OpenAI
        response = self.client.audio.transcriptions.create(
            model=model,
            file=audio_data,
            **params
        )
        
        transcription_id = f"trans_{uuid.uuid4().hex[:12]}"
        
        # Cache transcription in DB
        await self.db.transcriptions.insert_one({
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
        entity_type: str = "restaurant"
    ) -> Dict[str, Any]:
        """
        Extract concepts from text using GPT-4 with MongoDB config.
        
        Args:
            text: Text to analyze
            entity_type: Type of entity (for category selection)
            
        Returns:
            Dictionary with concepts, confidence_score, entity_type, model
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration
        config = await self.config_service.get_config("concept_extraction_text")
        
        # Render prompt with variables
        prompt = await self.config_service.render_prompt(
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
            response_format={"type": "json_object"},
            **config["config"]
        )
        
        # Parse JSON response
        result = json.loads(response.choices[0].message.content)
        result["entity_type"] = entity_type
        result["model"] = config["model"]
        
        # Cache concepts in DB
        concept_id = f"concept_{uuid.uuid4().hex[:12]}"
        await self.db.ai_concepts.insert_one({
            "concept_id": concept_id,
            "text": text,
            "concepts": result.get("concepts", []),
            "confidence_score": result.get("confidence_score", 0.0),
            "entity_type": entity_type,
            "model": config["model"],
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        return result
    
    async def analyze_image(
        self, 
        image_url: str, 
        entity_type: str = "restaurant"
    ) -> Dict[str, Any]:
        """
        Analyze image using GPT-4 Vision with MongoDB config.
        
        Args:
            image_url: URL of image or base64 data
            entity_type: Type of entity (for category selection)
            
        Returns:
            Dictionary with concepts, confidence_score, visual_notes, entity_type, model
        """
        # Get categories for entity type
        categories = await self.category_service.get_categories(entity_type)
        
        # Get service configuration
        config = await self.config_service.get_config("image_analysis")
        
        # Render prompt with variables
        prompt = await self.config_service.render_prompt(
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
            response_format={"type": "json_object"},
            temperature=config["config"].get("temperature", 0.3),
            max_tokens=config["config"].get("max_tokens", 300)
        )
        
        # Parse JSON response
        result = json.loads(response.choices[0].message.content)
        result["entity_type"] = entity_type
        result["model"] = config["model"]
        
        # Cache image analysis in DB
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
