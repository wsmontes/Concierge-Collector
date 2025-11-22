"""
File: openai_compat.py
Purpose: OpenAI-compatible endpoints for function calling with LM Studio
Dependencies: fastapi, app.services.llm_place_service, app.models.openai_models
Last Updated: November 21, 2025

This router provides OpenAI-compatible endpoints that work with LM Studio
and other OpenAI-compatible clients for function calling / tool use.
"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any, Optional
import logging
import time
import json
import uuid
import asyncio

from app.models.openai_models import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatMessage,
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
                    "Search for restaurants by name or query. Returns up to 5 candidates by default "
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
                            "description": "Maximum number of results (1-20, default: 5)",
                            "default": 5,
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
            query = arguments.get("query")
            if not query:
                return json.dumps({"error": "query parameter is required"})
                
            items = service.search_restaurants(
                query=query,
                latitude=arguments.get("latitude"),
                longitude=arguments.get("longitude"),
                radius_m=arguments.get("radius_m", 5000),
                max_results=arguments.get("max_results", 5),
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
            
            # availability is already a dict
            return json.dumps(availability if availability else {}, ensure_ascii=False)
            
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


@router.get("/v1/functions")
async def list_functions():
    """
    List available functions for restaurant search and information.
    
    This endpoint returns all function definitions that can be used
    with the chat completions endpoint.
    """
    tools = get_available_functions()
    return {
        "functions": [tool.function.dict() for tool in tools],
        "count": len(tools)
    }


@router.post("/v1/chat/completions")
async def chat_completions(
    request: ChatCompletionRequest,
    service: LLMPlaceService = Depends(get_llm_service)
):
    """
    OpenAI-compatible chat completions with function calling.
    
    This endpoint does NOT run an LLM - it only executes functions.
    The LLM runs locally in LM Studio (or other client) and calls this API
    when it needs to execute functions.
    
    Features:
    - Tools array in response (LLM can see available functions)
    - Streaming support (stream=true)
    - tool_choice: auto, none, required, or specific function
    - parallel_tool_calls: execute multiple tools simultaneously
    - System message injection with tool descriptions
    
    Flow:
    1. Client sends request (with or without tool_calls)
    2. We inject system message with available tools if needed
    3. If tool_calls present, execute them (parallel if enabled)
    4. Return response with tools array so LLM knows what's available
    """
    try:
        # Get available tools
        available_tools = get_available_functions()
        
        # Validate messages
        if not request.messages:
            raise HTTPException(status_code=400, detail="No messages provided")
        
        # Check if we should inject system message with tool descriptions
        messages = request.messages.copy()
        if not any(msg.role == "system" for msg in messages):
            # Inject system message describing available tools
            tool_descriptions = "\n".join([
                f"- {tool.function.name}: {tool.function.description}"
                for tool in available_tools
            ])
            system_msg = ChatMessage(
                role="system",
                content=(
                    "You are a restaurant information assistant with access to these tools:\n"
                    f"{tool_descriptions}\n\n"
                    "Use these tools to help users find and get information about restaurants."
                )
            )
            messages.insert(0, system_msg)
            logger.info("Injected system message with tool descriptions")
        
        # Get last message
        last_message = messages[-1]
        
        # Handle tool_choice parameter
        should_execute_tools = True
        if request.tool_choice == "none":
            should_execute_tools = False
            logger.info("tool_choice=none: skipping tool execution")
        
        # Check if last message has tool_calls to execute
        if should_execute_tools and last_message.role == "assistant" and last_message.tool_calls:
            logger.info(f"Executing {len(last_message.tool_calls)} tool call(s)")
            
            # Check if we should execute in parallel
            execute_parallel = getattr(request, 'parallel_tool_calls', True)
            
            if execute_parallel and len(last_message.tool_calls) > 1:
                logger.info("Executing tools in parallel")
                # Execute all tools in parallel using asyncio
                tasks = []
                for tool_call in last_message.tool_calls:
                    function_name = tool_call.function.name
                    arguments = json.loads(tool_call.function.arguments)
                    tasks.append(
                        asyncio.to_thread(
                            execute_function,
                            function_name,
                            arguments,
                            service
                        )
                    )
                
                results = await asyncio.gather(*tasks)
                
                executed_calls = []
                for tool_call, result in zip(last_message.tool_calls, results):
                    executed_calls.append({
                        "call_id": tool_call.id,
                        "function_name": tool_call.function.name,
                        "result": result
                    })
            else:
                # Execute sequentially
                logger.info("Executing tools sequentially")
                executed_calls = []
                for tool_call in last_message.tool_calls:
                    function_name = tool_call.function.name
                    arguments = json.loads(tool_call.function.arguments)
                    
                    logger.info(f"Executing {function_name} with args: {arguments}")
                    result = execute_function(function_name, arguments, service)
                    
                    executed_calls.append({
                        "call_id": tool_call.id,
                        "function_name": function_name,
                        "result": result
                    })
            
            # Build response
            response_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
            
            # Check if streaming is requested
            if request.stream:
                logger.info("Streaming response")
                return StreamingResponse(
                    _stream_tool_results(
                        response_id,
                        request.model,
                        executed_calls,
                        available_tools
                    ),
                    media_type="text/event-stream"
                )
            
            # Return standard response with tools array
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
                        finish_reason="tool_calls"
                    )
                ],
                usage=Usage(
                    prompt_tokens=len(json.dumps([msg if isinstance(msg, dict) else msg.dict() for msg in messages])),
                    completion_tokens=len(json.dumps(executed_calls)),
                    total_tokens=len(json.dumps([msg if isinstance(msg, dict) else msg.dict() for msg in messages])) + len(json.dumps(executed_calls))
                ),
                system_fingerprint="concierge-restaurant"
            )
        
        # If no tool calls, return informative message with tools array
        # This allows LLM to see what tools are available
        else:
            logger.info("No tool calls to execute - returning available tools")
            
            response_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
            
            # Check tool_choice to determine response
            if request.tool_choice == "required":
                finish_reason = "tool_calls"
                content = "Please use one of the available tools to proceed."
            elif request.tool_choice and request.tool_choice not in ["auto", "none"]:
                # Specific function requested
                finish_reason = "tool_calls"
                content = f"Please call the {request.tool_choice} function."
            else:
                finish_reason = "stop"
                content = (
                    "I have access to restaurant search and information tools. "
                    "I can search for restaurants, get detailed information, and check availability."
                )
            
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
                            content=content
                        ),
                        finish_reason=finish_reason
                    )
                ],
                usage=Usage(
                    prompt_tokens=len(json.dumps([msg if isinstance(msg, dict) else msg.dict() for msg in messages])),
                    completion_tokens=len(content.split()),
                    total_tokens=len(json.dumps([msg if isinstance(msg, dict) else msg.dict() for msg in messages])) + len(content.split())
                ),
                system_fingerprint="concierge-restaurant"
            )
            
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid JSON in arguments: {str(e)}")
    except Exception as e:
        logger.error(f"Error in chat_completions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def _stream_tool_results(
    response_id: str,
    model: str,
    executed_calls: List[Dict[str, Any]],
    tools: List[Tool]
):
    """
    Stream tool execution results in SSE format.
    
    Args:
        response_id: Unique response ID
        model: Model name
        executed_calls: List of executed tool calls with results
        tools: Available tools array
    """
    # Send initial chunk with role
    chunk = {
        "id": response_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {"role": "assistant"},
            "finish_reason": None
        }]
    }
    yield f"data: {json.dumps(chunk)}\n\n"
    
    # Stream each tool result
    for call in executed_calls:
        chunk = {
            "id": response_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "delta": {
                    "content": json.dumps(call, ensure_ascii=False) + "\n"
                },
                "finish_reason": None
            }]
        }
        yield f"data: {json.dumps(chunk)}\n\n"
        await asyncio.sleep(0.01)  # Small delay for streaming effect
    
    # Send final chunk
    chunk = {
        "id": response_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {},
            "finish_reason": "tool_calls"
        }]
    }
    yield f"data: {json.dumps(chunk)}\n\n"
    yield "data: [DONE]\n\n"
