"""
AIOrchestrator: Intelligent workflow orchestration for AI services.

Combines multiple AI services (transcription, concept extraction, image analysis)
in smart workflows with flexible output control.
"""

import time
import uuid
import json
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from app.services.category_service import CategoryService
from app.services.openai_config_service import OpenAIConfigService


class OutputHandler:
    """Handles flexible output formatting and storage"""
    
    @staticmethod
    def apply_defaults(request_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Apply smart defaults based on presence/absence of output object.
        
        Logic:
        - No output object = return full results without saving
        - With output object but missing fields = apply defaults
        - Default format = "full"
        - Default return_results (with output) = False
        - Default save_to_db (with output) = True
        - Default entity_type = "restaurant"
        """
        if "output" not in request_data:
            # No output object = return full results without saving
            request_data["output"] = {
                "save_to_db": False,
                "return_results": True,
                "format": "full"
            }
        else:
            # With output object, apply individual defaults
            if "format" not in request_data["output"]:
                request_data["output"]["format"] = "full"
            if "return_results" not in request_data["output"]:
                request_data["output"]["return_results"] = False
            if "save_to_db" not in request_data["output"]:
                request_data["output"]["save_to_db"] = True
        
        # Entity type default
        if "entity_type" not in request_data:
            request_data["entity_type"] = "restaurant"
        
        return request_data
    
    @staticmethod
    async def format_results(results: Dict[str, Any], format_type: str) -> Dict[str, Any]:
        """
        Format results based on format type.
        
        Args:
            results: Full results dictionary
            format_type: "full", "minimal", or "ids_only"
            
        Returns:
            Formatted results
        """
        if format_type == "full":
            return results
        elif format_type == "minimal":
            return {
                "entity_id": results.get("entity", {}).get("entity_id"),
                "curation_id": results.get("curation", {}).get("curation_id"),
                "concepts": results.get("concepts", {}).get("concepts", [])
            }
        elif format_type == "ids_only":
            return {
                "entity_id": results.get("entity", {}).get("entity_id"),
                "curation_id": results.get("curation", {}).get("curation_id")
            }
        else:
            return results
    
    @staticmethod
    async def save_results(db, results: Dict[str, Any]) -> list:
        """
        Save entity and curation to MongoDB.
        
        Args:
            db: MongoDB database
            results: Results dictionary
            
        Returns:
            List of saved item types
        """
        saved_items = []
        
        # Save entity if present
        if "entity" in results:
            await db.entities.update_one(
                {"entity_id": results["entity"]["entity_id"]},
                {"$set": results["entity"]},
                upsert=True
            )
            saved_items.append("entity")
        
        # Save curation if present
        if "curation" in results:
            await db.curations.insert_one(results["curation"])
            saved_items.append("curation")
        
        return saved_items


class AIOrchestrator:
    """Main orchestration service combining all AI operations"""
    
    def __init__(self, db, openai_service, places_service=None):
        """
        Initialize AIOrchestrator.
        
        Args:
            db: MongoDB database
            openai_service: OpenAI service instance
            places_service: Google Places service (optional)
        """
        self.db = db
        self.openai = openai_service
        self.places = places_service
        self.output_handler = OutputHandler()
        self.category_service = CategoryService(db)
        self.config_service = OpenAIConfigService(db)
    
    async def detect_workflow(self, request: Dict[str, Any]) -> str:
        """
        Auto-detect workflow type based on inputs.
        
        Returns workflow string like:
        - audio_only
        - image_only
        - place_id_with_audio
        - place_id_with_image
        - place_id_with_audio_and_image
        - etc.
        """
        has_place_id = "place_id" in request
        has_entity_id = "entity_id" in request
        has_audio = "audio_file" in request or "audio_url" in request
        has_image = "image_file" in request or "image_url" in request
        has_text = "text" in request
        
        # Manual workflow type takes precedence
        if request.get("workflow_type") != "auto":
            return request.get("workflow_type", "auto")
        
        # Auto-detect based on combinations
        if has_place_id and has_audio and has_image:
            return "place_id_with_audio_and_image"
        elif has_place_id and has_audio:
            return "place_id_with_audio"
        elif has_place_id and has_image:
            return "place_id_with_image"
        elif has_entity_id and has_audio:
            return "entity_id_with_audio"
        elif has_entity_id and has_image:
            return "entity_id_with_image"
        elif has_audio or has_text:
            return "audio_only"
        elif has_image:
            return "image_only"
        elif has_place_id:
            return "place_id_only"
        else:
            raise ValueError("Cannot detect workflow: insufficient inputs")
    
    async def orchestrate(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """
        Main orchestration method.
        
        Args:
            request: Request dictionary with inputs and options
            
        Returns:
            Response with workflow, results, and metadata
        """
        start_time = time.time()
        
        # Apply defaults
        request = self.output_handler.apply_defaults(request)
        
        # Detect workflow
        workflow = await self.detect_workflow(request)
        
        # Execute workflow
        results = await self.execute_workflow(workflow, request)
        
        # Handle output
        if request["output"]["save_to_db"]:
            await self.output_handler.save_results(self.db, results)
        
        # Format response
        if request["output"]["return_results"]:
            formatted = await self.output_handler.format_results(
                results, 
                request["output"]["format"]
            )
        else:
            formatted = {}
        
        processing_time = int((time.time() - start_time) * 1000)
        
        return {
            "workflow": workflow,
            "results": formatted,
            "saved_to_db": request["output"]["save_to_db"],
            "processing_time_ms": processing_time
        }
    
    async def execute_workflow(self, workflow: str, request: Dict[str, Any]) -> Dict[str, Any]:
        """Execute the detected workflow"""
        results = {}
        entity_type = request.get("entity_type", "restaurant")
        
        if workflow == "audio_only":
            # Transcribe audio
            audio = request.get("audio_file") or request.get("audio_url") or request.get("text")
            
            if request.get("text"):
                # Skip transcription, use text directly
                text = request["text"]
                results["transcription"] = {"text": text, "source": "direct_text"}
            else:
                # Transcribe audio
                transcription = await self.openai.transcribe_audio(
                    audio, 
                    request.get("language", "pt-BR")
                )
                results["transcription"] = transcription
                text = transcription["text"]
            
            # Extract concepts
            concepts = await self.openai.extract_concepts_from_text(text, entity_type)
            concepts["category_context"] = entity_type
            results["concepts"] = concepts
        
        elif workflow == "image_only":
            # Analyze image
            image = request.get("image_file") or request.get("image_url")
            image_analysis = await self.openai.analyze_image(image, entity_type)
            image_analysis["category_context"] = entity_type
            results["image_analysis"] = image_analysis
        
        elif workflow == "place_id_with_audio":
            if not self.places:
                raise ValueError("Places service not configured")
            
            # 1. Fetch place details
            place_data = await self.places.get_place_details(request["place_id"])
            results["entity"] = self.transform_to_entity(place_data, entity_type)
            
            # 2. Transcribe audio
            audio = request.get("audio_file") or request.get("audio_url")
            transcription = await self.openai.transcribe_audio(
                audio, 
                request.get("language", "pt-BR")
            )
            results["transcription"] = transcription
            
            # 3. Extract concepts
            concepts = await self.openai.extract_concepts_from_text(
                transcription["text"],
                entity_type
            )
            concepts["category_context"] = entity_type
            results["concepts"] = concepts
            
            # 4. Create curation
            results["curation"] = {
                "curation_id": f"cur_{uuid.uuid4().hex[:12]}",
                "entity_id": results["entity"]["entity_id"],
                "curator_id": request.get("curator_id"),
                "transcription_id": transcription.get("transcription_id"),
                "concepts": concepts["concepts"],
                "source": "text_analysis",
                "entity_type": entity_type,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
        
        elif workflow == "place_id_with_image":
            if not self.places:
                raise ValueError("Places service not configured")
            
            # 1. Fetch place details
            place_data = await self.places.get_place_details(request["place_id"])
            results["entity"] = self.transform_to_entity(place_data, entity_type)
            
            # 2. Analyze image
            image = request.get("image_file") or request.get("image_url")
            image_analysis = await self.openai.analyze_image(image, entity_type)
            image_analysis["category_context"] = entity_type
            results["image_analysis"] = image_analysis
            
            # 3. Create curation
            results["curation"] = {
                "curation_id": f"cur_{uuid.uuid4().hex[:12]}",
                "entity_id": results["entity"]["entity_id"],
                "curator_id": request.get("curator_id"),
                "concepts": image_analysis["concepts"],
                "source": "image_analysis",
                "visual_notes": image_analysis.get("visual_notes"),
                "entity_type": entity_type,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
        
        elif workflow == "place_id_with_audio_and_image":
            if not self.places:
                raise ValueError("Places service not configured")
            
            # Complete workflow: place + audio + image
            place_data = await self.places.get_place_details(request["place_id"])
            results["entity"] = self.transform_to_entity(place_data, entity_type)
            
            # Transcribe audio
            audio = request.get("audio_file") or request.get("audio_url")
            transcription = await self.openai.transcribe_audio(
                audio, 
                request.get("language", "pt-BR")
            )
            results["transcription"] = transcription
            
            # Extract concepts from text
            text_concepts = await self.openai.extract_concepts_from_text(
                transcription["text"],
                entity_type
            )
            results["text_concepts"] = text_concepts
            
            # Analyze image
            image = request.get("image_file") or request.get("image_url")
            image_analysis = await self.openai.analyze_image(image, entity_type)
            results["image_analysis"] = image_analysis
            
            # Combine concepts from both sources (deduplicate)
            combined_concepts = list(set(
                text_concepts["concepts"] + image_analysis["concepts"]
            ))
            
            # Create curation with combined concepts
            results["curation"] = {
                "curation_id": f"cur_{uuid.uuid4().hex[:12]}",
                "entity_id": results["entity"]["entity_id"],
                "curator_id": request.get("curator_id"),
                "transcription_id": transcription.get("transcription_id"),
                "concepts": combined_concepts,
                "sources": ["text_analysis", "image_analysis"],
                "visual_notes": image_analysis.get("visual_notes"),
                "entity_type": entity_type,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
        
        else:
            raise ValueError(f"Workflow '{workflow}' not implemented")
        
        return results
    
    def transform_to_entity(self, place_data: Dict[str, Any], entity_type: str) -> Dict[str, Any]:
        """
        Transform Google Place data to entity format.
        
        Args:
            place_data: Place data from Google Places API
            entity_type: Type of entity
            
        Returns:
            Entity dictionary
        """
        # Simplified transformation (you may want to enhance this)
        return {
            "entity_id": f"place_{place_data.get('place_id')}",
            "name": place_data.get("name"),
            "entity_type": entity_type,
            "location": place_data.get("geometry", {}).get("location"),
            "address": place_data.get("formatted_address"),
            "place_id": place_data.get("place_id"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": "google_places"
        }
