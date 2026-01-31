"""
AI Output Schemas - Pydantic models for GPT-5.2 structured outputs

This module defines validated schemas for all AI model outputs used in the system.
These schemas ensure type safety, data validation, and proper error handling for
LLM responses.

Dependencies:
- pydantic: BaseModel, Field, ValidationError
- typing: List, Optional

Used by:
- app/services/openai_service.py (transcription, concept extraction, image analysis)
- app/services/ai_orchestrator.py (AI workflow orchestration)

Author: AI Migration Team
Date: 2026-01-30
"""

from pydantic import BaseModel, Field, field_validator
from typing import List, Optional, Dict


# =============================================================================
# TRANSCRIPTION OUTPUTS (Whisper → GPT-5.2 Audio)
# =============================================================================

class TranscriptionWord(BaseModel):
    """Individual word in transcription with timestamps"""
    word: str = Field(description="Transcribed word")
    start: float = Field(ge=0.0, description="Start time in seconds")
    end: float = Field(ge=0.0, description="End time in seconds")
    
    @field_validator('end')
    @classmethod
    def end_after_start(cls, v: float, info) -> float:
        """Ensure end timestamp is after start"""
        if 'start' in info.data and v < info.data['start']:
            raise ValueError(f"end ({v}) must be >= start ({info.data['start']})")
        return v


class TranscriptionSegment(BaseModel):
    """Segment of transcription (sentence/phrase) with timestamps"""
    id: int = Field(ge=0, description="Segment index")
    text: str = Field(min_length=1, description="Segment text")
    start: float = Field(ge=0.0, description="Start time in seconds")
    end: float = Field(ge=0.0, description="End time in seconds")
    
    @field_validator('end')
    @classmethod
    def end_after_start(cls, v: float, info) -> float:
        """Ensure end timestamp is after start"""
        if 'start' in info.data and v < info.data['start']:
            raise ValueError(f"end ({v}) must be >= start ({info.data['start']})")
        return v


class TranscriptionOutput(BaseModel):
    """
    Validated transcription output from GPT-5.2 Audio
    
    This schema validates audio transcription results with automatic language
    detection and optional word/segment-level timestamps.
    
    Example:
        {
            "text": "Esse restaurante é incrível",
            "language": "pt",
            "duration": 3.5,
            "words": [...],
            "segments": [...]
        }
    """
    text: str = Field(min_length=1, description="Full transcription text")
    language: str = Field(
        pattern=r'^[a-z]{2}$',
        description="Detected language (ISO-639-1, e.g., 'pt', 'en', 'es')"
    )
    duration: Optional[float] = Field(
        None, 
        ge=0.0, 
        description="Audio duration in seconds"
    )
    words: Optional[List[TranscriptionWord]] = Field(
        None,
        description="Word-level timestamps (if requested)"
    )
    segments: Optional[List[TranscriptionSegment]] = Field(
        None,
        description="Segment-level timestamps (if requested)"
    )


# =============================================================================
# CONCEPT EXTRACTION OUTPUTS (GPT-4 → GPT-5.2)
# =============================================================================

class ConceptExtractionOutput(BaseModel):
    """
    Validated concept extraction from GPT-5.2 with structured outputs
    
    Per OpenAI docs: All fields must be required. Use union with None for optional fields.
    
    This schema ensures concept extraction follows business rules:
    - Concepts organized by category (cuisine, menu, drinks, setting, etc)
    - Each category contains list of relevant concepts
    - Confidence score indicates extraction quality
    - Optional reasoning for ambiguous cases
    
    Example:
        {
            "concepts": {
                "cuisine": ["Italian", "Mediterranean"],
                "menu": ["pasta carbonara", "tiramisu"],
                "setting": ["romantic", "upscale"]
            },
            "confidence_score": 0.95,
            "reasoning": null
        }
    """
    # Required fields - defined directly without Field() per OpenAI docs
    concepts: Dict[str, List[str]]
    confidence_score: float
    reasoning: str | None  # Union type for optional field (None is allowed value)
    
    @field_validator('concepts')
    @classmethod
    def validate_concepts(cls, v: Dict[str, List[str]]) -> Dict[str, List[str]]:
        """Validate concepts structure and remove duplicates per category"""
        if not v:
            # Must have at least empty dict (required field)
            raise ValueError("Concepts dictionary is required (can be empty)")
        
        result = {}
        for category, concepts_list in v.items():
            if not isinstance(concepts_list, list):
                raise ValueError(f"Category '{category}' must have a list of concepts")
            # Remove duplicates while preserving order
            seen = set()
            result[category] = [x for x in concepts_list if not (x in seen or seen.add(x))]
        
        return result


# =============================================================================
# IMAGE ANALYSIS OUTPUTS (GPT-4-Vision → GPT-5.2)
# =============================================================================

class DetectedItem(BaseModel):
    """Individual item detected in restaurant image"""
    name: str = Field(description="Item name (e.g., 'pasta carbonara', 'wine glass')")
    confidence: float = Field(
        ge=0.0, 
        le=1.0, 
        description="Detection confidence"
    )
    category: str = Field(
        description="Item category (food, drink, ambiance, decor, people, other)"
    )


class ImageAnalysisOutput(BaseModel):
    """
    Validated image analysis from GPT-5.2 with structured outputs
    
    This schema validates restaurant image analysis results including:
    - Main description
    - Detected items (food, drinks, ambiance elements)
    - Cuisine type inference
    - Ambiance assessment
    
    Example:
        {
            "description": "Elegant pasta dish with wine",
            "detected_items": [
                {"name": "pasta carbonara", "confidence": 0.9, "category": "food"},
                {"name": "red wine", "confidence": 0.85, "category": "drink"}
            ],
            "cuisine_inference": "Italian",
            "ambiance": "romantic, upscale",
            "confidence_score": 0.9
        }
    """
    description: str = Field(
        ...,  # Required
        min_length=10,
        max_length=500,
        description="Natural language description of the image"
    )
    detected_items: List[DetectedItem] = Field(
        ...,  # Required (can be empty list)
        max_length=20,
        description="Items detected in the image"
    )
    cuisine_inference: Optional[str] = Field(
        None,
        max_length=100,
        description="Inferred cuisine type (if evident)"
    )
    ambiance: Optional[str] = Field(
        None,
        max_length=200,
        description="Ambiance description (e.g., 'casual', 'romantic', 'modern')"
    )
    confidence_score: float = Field(
        ...,  # Required
        ge=0.0,
        le=1.0,
        description="Overall analysis confidence"
    )
    
    model_config = {
        "json_schema_extra": {
            "required": ["description", "detected_items", "confidence_score"]
        }
    }
    
    @field_validator('detected_items')
    @classmethod
    def sort_by_confidence(cls, v: List[DetectedItem]) -> List[DetectedItem]:
        """Sort items by confidence (highest first)"""
        return sorted(v, key=lambda x: x.confidence, reverse=True)


# =============================================================================
# EXPORT ALL MODELS
# =============================================================================

__all__ = [
    'TranscriptionWord',
    'TranscriptionSegment', 
    'TranscriptionOutput',
    'ConceptExtractionOutput',
    'DetectedItem',
    'ImageAnalysisOutput',
]
