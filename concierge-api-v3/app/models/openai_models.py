"""
File: openai_models.py
Purpose: Pydantic models for OpenAI-compatible API endpoints
Dependencies: pydantic
Last Updated: November 21, 2025

OpenAI-compatible models for function calling / tool use.
Follows OpenAI API specification exactly.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any, Union, Literal
from enum import Enum


# ============================================================================
# FUNCTION/TOOL DEFINITIONS
# ============================================================================

class FunctionParameters(BaseModel):
    """JSON Schema for function parameters"""
    type: Literal["object"] = "object"
    properties: Dict[str, Any]
    required: Optional[List[str]] = None
    additionalProperties: bool = False  # Required for strict mode


class FunctionDefinition(BaseModel):
    """Function definition for tool calling"""
    name: str = Field(..., description="Function name")
    description: str = Field(..., description="Function description")
    parameters: FunctionParameters = Field(..., description="Function parameters as JSON schema")
    strict: bool = Field(True, description="Whether to enforce strict mode")


class Tool(BaseModel):
    """Tool definition (function)"""
    type: Literal["function"] = "function"
    function: FunctionDefinition


# ============================================================================
# TOOL CHOICE
# ============================================================================

class ToolChoiceFunction(BaseModel):
    """Specific function to call"""
    type: Literal["function"] = "function"
    name: str


ToolChoice = Union[
    Literal["auto"],      # Let model decide
    Literal["required"],  # Force at least one tool call
    Literal["none"],      # No tool calls
    ToolChoiceFunction    # Force specific function
]


# ============================================================================
# MESSAGES
# ============================================================================

class FunctionCall(BaseModel):
    """Function call from assistant"""
    name: str
    arguments: str  # JSON-encoded string


class ToolCallFunction(BaseModel):
    """Function details in tool call"""
    name: str
    arguments: str  # JSON-encoded string


class ToolCall(BaseModel):
    """Tool call from assistant"""
    id: str
    type: Literal["function"] = "function"
    function: ToolCallFunction


class ChatMessage(BaseModel):
    """Chat message"""
    role: Literal["system", "user", "assistant", "tool"]
    content: Optional[str] = None
    name: Optional[str] = None  # For tool messages
    tool_calls: Optional[List[ToolCall]] = None  # For assistant requesting tools
    tool_call_id: Optional[str] = None  # For tool response messages


# ============================================================================
# REQUEST
# ============================================================================

class ChatCompletionRequest(BaseModel):
    """Chat completion request (OpenAI format)"""
    model: str
    messages: List[ChatMessage]
    tools: Optional[List[Tool]] = None
    tool_choice: Optional[ToolChoice] = "auto"
    parallel_tool_calls: bool = True
    temperature: Optional[float] = Field(default=1.0, ge=0.0, le=2.0)
    max_tokens: Optional[int] = None
    stream: bool = False
    # Not implementing all OpenAI params, just essentials


# ============================================================================
# RESPONSE
# ============================================================================

class ResponseMessage(BaseModel):
    """Message in response"""
    role: Literal["assistant", "tool"]
    content: Optional[str] = None
    tool_calls: Optional[List[ToolCall]] = None
    refusal: Optional[str] = None


class Choice(BaseModel):
    """Choice in response"""
    index: int
    message: ResponseMessage
    finish_reason: Literal["stop", "tool_calls", "length", "content_filter"] = "stop"
    logprobs: Optional[Any] = None


class Usage(BaseModel):
    """Token usage"""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class ChatCompletionResponse(BaseModel):
    """Chat completion response (OpenAI format)"""
    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int  # Unix timestamp
    model: str
    choices: List[Choice]
    usage: Usage
    system_fingerprint: Optional[str] = None


# ============================================================================
# MODELS LIST
# ============================================================================

class Model(BaseModel):
    """Model object"""
    id: str
    object: Literal["model"] = "model"
    created: int
    owned_by: str


class ModelsResponse(BaseModel):
    """List of available models"""
    object: Literal["list"] = "list"
    data: List[Model]
