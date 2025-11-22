"""
File: openai_compat.py
Purpose: OpenAI-compatible endpoints for function calling with LM Studio
Dependencies: fastapi, app.services.llm_place_service, app.models.openai_models
Last Updated: November 21, 2025

This router provides OpenAI-compatible endpoints that work with LM Studio
and other OpenAI-compatible clients for function calling / tool use.
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List, Dict, Any
import logging
import time
import json
import uuid

from app.models.openai_models import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    Choice,
    ResponseMessage,
    Usage,
    ToolCall,
    ToolCallFunction,
    Tool,
    FunctionDefinition,
    FunctionParameters,
    ModelsResponse,
    Model
)
from app.services.llm_place_service import LLMPlaceService
from app.core.database import get_database

logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/openai", tags=["openai-compatible"])


def get_llm_service() -> LLMPlaceService:
    """Dependency to get LLMPlaceService instance"""
    return LLMPlaceService(database=get_database())


# ============================================================================
# FUNCTION DEFINITIONS (Convert from LLM tools to OpenAI format)
# ============================================================================

def get_available_functions() -> List[Tool]:
    """
    Get list of available functions in OpenAI format.
    
    These match the LLM Gateway tools but in OpenAI/LM Studio format.
    """
    return [
        Tool(
            type="function",
            function=FunctionDefinition(
                name="search_restaurants",
                description=(
                    "Search for restaurants by name or query. Returns up to 20 candidates "
                    "with place_id and entity_id. Use this when user asks to find restaurants "
                    "or needs to disambiguate between multiple restaurants."
                ),
                parameters=FunctionParameters(
                    type="object",
                    properties={
                        "query": {
                            "type": "string",
                            "description": "Restaurant name or search term"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results (1-20)",
                            "default": 20,
                            "minimum": 1,
                            "maximum": 20
                        },
                        "latitude": {
                            "type": ["number", "null"],
                            "description": "Optional latitude for location-biased search"
                        },
                        "longitude": {
                            "type": ["number", "null"],
                            "description": "Optional longitude for location-biased search"
                        },
                        "radius_m": {
                            "type": "integer",
                            "description": "Search radius in meters (100-50000)",
                            "default": 5000
                        }
                    },
                    required=["query"],
                    additionalProperties=False
                ),
                strict=True
            )
        ),
        Tool(
            type="function",
            function=FunctionDefinition(
                name="get_restaurant_snapshot",
                description=(
                    "Get complete restaurant information including hours, ratings, "
                    "Michelin data, and curated content. Use this after search_restaurants "
                    "to get detailed information about a specific restaurant."
                ),
                parameters=FunctionParameters(
                    type="object",
                    properties={
                        "place_id": {
                            "type": ["string", "null"],
                            "description": "Google Place ID"
                        },
                        "entity_id": {
                            "type": ["string", "null"],
                            "description": "Internal entity ID"
                        }
                    },
                    required=[],  # At least one required, but not both
                    additionalProperties=False
                ),
                strict=True
            )
        ),
        Tool(
            type="function",
            function=FunctionDefinition(
                name="get_restaurant_availability",
                description=(
                    "Check restaurant opening hours and weekend availability. "
                    "Use this when user asks if restaurant is open now or on weekends."
                ),
                parameters=FunctionParameters(
                    type="object",
                    properties={
                        "place_id": {
                            "type": ["string", "null"],
                            "description": "Google Place ID"
                        },
                        "entity_id": {
                            "type": ["string", "null"],
                            "description": "Internal entity ID"
                        }
                    },
                    required=[],
                    additionalProperties=False
                ),
                strict=True
            )
        )
    ]


# ============================================================================
# FUNCTION EXECUTION
# ============================================================================

def execute_function(
    function_name: str,
    arguments: Dict[str, Any],
    service: LLMPlaceService
) -> str:
    """
    Execute a function and return result as JSON string.
    
    Args:
        function_name: Name of function to execute
        arguments: Function arguments
        service: LLMPlaceService instance
        
    Returns:
        JSON string with function result
    """
    try:
        if function_name == "search_restaurants":
            items = service.search_restaurants(
                query=arguments.get("query"),
                latitude=arguments.get("latitude"),
                longitude=arguments.get("longitude"),
                radius_m=arguments.get("radius_m", 5000),
                max_results=arguments.get("max_results", 20),
                language=arguments.get("language", "pt-BR"),
                region=arguments.get("region", "BR")
            )
            
            # Convert to dict for JSON serialization
            result = {
                "items": [item.dict() for item in items],
                "total_results": len(items)
            }
            return json.dumps(result, ensure_ascii=False)
            
        elif function_name == "get_restaurant_snapshot":
            snapshot, sources = service.get_restaurant_snapshot(
                place_id=arguments.get("place_id"),
                entity_id=arguments.get("entity_id")
            )
            
            result = {
                "snapshot": snapshot.dict() if snapshot else None,
                "sources_used": sources
            }
            return json.dumps(result, ensure_ascii=False)
            
        elif function_name == "get_restaurant_availability":
            availability = service.get_restaurant_availability(
                place_id=arguments.get("place_id"),
                entity_id=arguments.get("entity_id")
            )
            
            return json.dumps(availability.dict() if availability else {}, ensure_ascii=False)
            
        else:
            return json.dumps({"error": f"Unknown function: {function_name}"})
            
    except Exception as e:
        logger.error(f"Error executing {function_name}: {e}")
        return json.dumps({"error": str(e)})


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/v1/models", response_model=ModelsResponse)
async def list_models():
    """
    List available models (OpenAI-compatible).
    
    Returns a single model: concierge-restaurant
    """
    return ModelsResponse(
        object="list",
        data=[
            Model(
                id="concierge-restaurant",
                object="model",
                created=int(time.time()),
                owned_by="concierge"
            )
        ]
    )


@router.post("/v1/chat/completions", response_model=ChatCompletionResponse)
async def chat_completions(
    request: ChatCompletionRequest,
    service: LLMPlaceService = Depends(get_llm_service)
):
    """
    OpenAI-compatible chat completions with function calling.
    
    This endpoint does NOT run an LLM - it only executes functions.
    The LLM runs locally in LM Studio (or other client) and calls this API
    when it needs to execute functions.
    
    Flow:
    1. LM Studio LLM decides to call a function
    2. LM Studio sends request here with tool_calls in last message
    3. We execute the function and return results
    4. LM Studio LLM processes results and responds to user
    """
    try:
        # Get last message
        if not request.messages:
            raise HTTPException(status_code=400, detail="No messages provided")
            
        last_message = request.messages[-1]
        
        # Check if last message is asking for tool execution
        # (i.e., role=assistant with tool_calls)
        if last_message.role == "assistant" and last_message.tool_calls:
            logger.info(f"Executing {len(last_message.tool_calls)} tool call(s)")
            
            # Execute all requested tool calls
            executed_calls = []
            for tool_call in last_message.tool_calls:
                function_name = tool_call.function.name
                arguments = json.loads(tool_call.function.arguments)
                
                logger.info(f"Executing {function_name} with args: {arguments}")
                
                # Execute function
                result = execute_function(function_name, arguments, service)
                
                executed_calls.append({
                    "call_id": tool_call.id,
                    "function_name": function_name,
                    "result": result
                })
            
            # Return results in OpenAI format
            # Note: We return the tool results as assistant message with content
            # The client will then append these as tool messages
            response_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
            
            return ChatCompletionResponse(
                id=response_id,
                object="chat.completion",
                created=int(time.time()),
                model=request.model,
                choices=[
                    Choice(
                        index=0,
                        message=ResponseMessage(
                            role="assistant",
                            content=json.dumps(executed_calls, ensure_ascii=False)
                        ),
                        finish_reason="stop"
                    )
                ],
                usage=Usage(
                    prompt_tokens=0,
                    completion_tokens=0,
                    total_tokens=0
                ),
                system_fingerprint="concierge-restaurant"
            )
        
        # If no tool calls, this is likely the initial request
        # Return available tools for the LLM to use
        else:
            logger.info("No tool calls in request - this shouldn't happen in normal flow")
            
            return ChatCompletionResponse(
                id=f"chatcmpl-{uuid.uuid4().hex[:24]}",
                object="chat.completion",
                created=int(time.time()),
                model=request.model,
                choices=[
                    Choice(
                        index=0,
                        message=ResponseMessage(
                            role="assistant",
                            content="I have access to restaurant search and information tools. Please use them via your LLM client."
                        ),
                        finish_reason="stop"
                    )
                ],
                usage=Usage(),
                system_fingerprint="concierge-restaurant"
            )
            
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid JSON in arguments: {str(e)}")
    except Exception as e:
        logger.error(f"Error in chat_completions: {e}")
        raise HTTPException(status_code=500, detail=str(e))
