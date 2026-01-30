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
from typing import List, Optional


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
    
    This schema ensures concept extraction follows business rules:
    - 2-8 concepts per extraction
    - Concepts must be from approved category list
    - Confidence score indicates extraction quality
    - Optional reasoning for ambiguous cases
    
    Example:
        {
            "concepts": ["Italian", "Fine Dining", "Romantic"],
            "confidence_score": 0.95,
            "reasoning": null
        }
    """
    concepts: List[str] = Field(
        min_length=2, 
        max_length=8,
        description="Restaurant concepts from approved categories"
    )
    confidence_score: float = Field(
        ge=0.0, 
        le=1.0,
        description="Confidence in extraction quality (0.0-1.0)"
    )
    reasoning: Optional[str] = Field(
        None,
        max_length=200,
        description="Brief explanation if ambiguous or uncertain"
    )
    
    @field_validator('concepts')
    @classmethod
    def deduplicate_concepts(cls, v: List[str]) -> List[str]:
        """Remove duplicates while preserving order"""
        seen = set()
        return [x for x in v if not (x in seen or seen.add(x))]


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
            "ambiance": "romantic, upscale"
        }
    """
    description: str = Field(
        min_length=10,
        max_length=500,
        description="Natural language description of the image"
    )
    detected_items: List[DetectedItem] = Field(
        default_factory=list,
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
        ge=0.0,
        le=1.0,
        default=0.5,
        description="Overall analysis confidence"
    )
    
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
