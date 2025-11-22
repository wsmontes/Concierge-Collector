"""
File: llm_tools.py
Purpose: MCP Tool schemas for LLM Gateway
Dependencies: None (pure JSON Schema definitions)
Last Updated: November 21, 2025

This module defines the tool schemas for Model Context Protocol (MCP) integration.
These schemas allow LLMs like Claude to discover and use the LLM Gateway endpoints
as tools for restaurant search and information retrieval.
"""

from typing import Dict, Any, List


def get_search_restaurants_tool() -> Dict[str, Any]:
    """
    Tool schema for searching restaurants.
    
    This tool allows LLMs to search for restaurants by name or query,
    optionally with location bias. Returns candidate restaurants with
    identifiers for further detailed queries.
    
    Returns:
        MCP tool schema dictionary
    """
    return {
        "name": "search_restaurants",
        "description": (
            "Search for restaurants by name or query. "
            "Use this tool when you need to find restaurants matching a user's query. "
            "Returns a list of candidate restaurants with place_id and entity_id that can be used "
            "for detailed queries with get_restaurant_snapshot or get_restaurant_availability. "
            "\n\n"
            "Example use cases:\n"
            "- User asks: 'Tell me about Dom Manolo restaurant'\n"
            "- User asks: 'Find Italian restaurants near me'\n"
            "- User asks: 'Is there a restaurant called Figueira Rubaiyat?'\n"
            "\n"
            "After getting results, use place_id or entity_id to fetch detailed information."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Restaurant name or search term (e.g., 'D.O.M', 'pizza', 'italian restaurant')"
                },
                "latitude": {
                    "type": "number",
                    "description": "Optional latitude for location-biased search (e.g., -23.5505)"
                },
                "longitude": {
                    "type": "number",
                    "description": "Optional longitude for location-biased search (e.g., -46.6333)"
                },
                "radius_m": {
                    "type": "integer",
                    "description": "Search radius in meters (default: 5000, min: 100, max: 50000)",
                    "default": 5000,
                    "minimum": 100,
                    "maximum": 50000
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 5, min: 1, max: 20)",
                    "default": 5,
                    "minimum": 1,
                    "maximum": 20
                },
                "language": {
                    "type": "string",
                    "description": "Language code for results (default: 'pt-BR')",
                    "default": "pt-BR"
                },
                "region": {
                    "type": "string",
                    "description": "Region code for results (default: 'BR')",
                    "default": "BR"
                }
            },
            "required": ["query"]
        }
    }


def get_restaurant_snapshot_tool() -> Dict[str, Any]:
    """
    Tool schema for getting complete restaurant information.
    
    This is the PRIMARY tool for getting detailed restaurant data.
    Use this after search_restaurants to get complete information.
    
    Returns:
        MCP tool schema dictionary
    """
    return {
        "name": "get_restaurant_snapshot",
        "description": (
            "Get complete, consolidated information about a specific restaurant. "
            "This is the PRIMARY tool for answering detailed questions about a restaurant. "
            "\n\n"
            "The snapshot includes:\n"
            "- Basic info (name, address, phone, website)\n"
            "- Geographic coordinates\n"
            "- Opening hours by day of week\n"
            "- Current open/closed status\n"
            "- Google ratings and review counts\n"
            "- Michelin data (if available - stars, Bib Gourmand, cuisine)\n"
            "- Curated tags and highlights from experts\n"
            "- Price level and place types\n"
            "\n"
            "Use this tool when:\n"
            "- User asks for details about a specific restaurant\n"
            "- User asks about hours, ratings, contact info\n"
            "- User wants comprehensive information\n"
            "- You need context to make recommendations\n"
            "\n"
            "Example use cases:\n"
            "- 'Tell me about this restaurant'\n"
            "- 'What are the opening hours?'\n"
            "- 'Does it have a Michelin star?'\n"
            "- 'How do I contact them?'\n"
            "- 'What's the price range?'\n"
            "\n"
            "IMPORTANT: You must provide either place_id OR entity_id (from search results)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "place_id": {
                    "type": "string",
                    "description": "Google Place ID (from search_restaurants results)"
                },
                "entity_id": {
                    "type": "string",
                    "description": "Internal entity ID (from search_restaurants results if has_entity=true)"
                },
                "include_google_places": {
                    "type": "boolean",
                    "description": "Include Google Places data (default: true)",
                    "default": True
                },
                "include_curations": {
                    "type": "boolean",
                    "description": "Include expert curation data - tags, highlights (default: true)",
                    "default": True
                },
                "include_raw_sources": {
                    "type": "boolean",
                    "description": "Include raw source data for debugging (default: false)",
                    "default": False
                },
                "reference_datetime_iso": {
                    "type": "string",
                    "description": "Reference datetime for 'is_open_now' calculation (ISO format: '2025-11-21T20:00:00')"
                },
                "timezone": {
                    "type": "string",
                    "description": "Timezone for time calculations (default: 'America/Sao_Paulo')",
                    "default": "America/Sao_Paulo"
                }
            },
            "oneOf": [
                {"required": ["place_id"]},
                {"required": ["entity_id"]}
            ]
        }
    }


def get_restaurant_availability_tool() -> Dict[str, Any]:
    """
    Tool schema for getting restaurant availability and hours.
    
    This is a SPECIALIZED tool focused on availability questions.
    Use this when the user specifically asks about hours or weekend availability.
    
    Returns:
        MCP tool schema dictionary
    """
    return {
        "name": "get_restaurant_availability",
        "description": (
            "Get restaurant availability and opening hours information. "
            "This is a SPECIALIZED tool for answering availability questions. "
            "\n\n"
            "Provides:\n"
            "- Current open/closed status\n"
            "- Weekend availability (which days)\n"
            "- Detailed hours by day of week\n"
            "- Human-readable notes about availability\n"
            "\n"
            "Use this tool when:\n"
            "- User asks 'Is it open now?'\n"
            "- User asks 'Does it open on weekends?'\n"
            "- User asks 'What are the weekend hours?'\n"
            "- User asks 'Is it open on Saturday?'\n"
            "- You need to check specific day availability\n"
            "\n"
            "Example use cases:\n"
            "- 'Is this restaurant open on Saturday?'\n"
            "- 'Does it open for weekend brunch?'\n"
            "- 'What days is it closed?'\n"
            "- 'Is it open right now?'\n"
            "\n"
            "NOTE: For comprehensive restaurant info, use get_restaurant_snapshot instead. "
            "Use this tool only when the question is specifically about hours/availability."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "place_id": {
                    "type": "string",
                    "description": "Google Place ID (from search_restaurants results)"
                },
                "entity_id": {
                    "type": "string",
                    "description": "Internal entity ID (from search_restaurants results if has_entity=true)"
                },
                "date_iso": {
                    "type": "string",
                    "description": "Specific date to check (ISO format: '2025-11-22')"
                },
                "datetime_iso": {
                    "type": "string",
                    "description": "Specific datetime to check if open (ISO format: '2025-11-22T20:00:00')"
                },
                "timezone": {
                    "type": "string",
                    "description": "Timezone for time calculations (default: 'America/Sao_Paulo')",
                    "default": "America/Sao_Paulo"
                },
                "weekend_days": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
                    },
                    "description": "Days considered as weekend (default: ['saturday', 'sunday'])",
                    "default": ["saturday", "sunday"]
                }
            },
            "oneOf": [
                {"required": ["place_id"]},
                {"required": ["entity_id"]}
            ]
        }
    }


def get_all_tools() -> List[Dict[str, Any]]:
    """
    Get all available MCP tools.
    
    Returns:
        List of all tool schema dictionaries
    """
    return [
        get_search_restaurants_tool(),
        get_restaurant_snapshot_tool(),
        get_restaurant_availability_tool()
    ]


def get_tools_manifest() -> Dict[str, Any]:
    """
    Get MCP tools manifest with metadata.
    
    Returns:
        Complete manifest with tools and metadata
    """
    return {
        "name": "concierge-restaurant",
        "version": "1.0.0",
        "description": "Restaurant search and information tools for Concierge Collector",
        "author": "Concierge Collector",
        "homepage": "https://concierge-collector.onrender.com",
        "tools": get_all_tools(),
        "metadata": {
            "api_base_url": "https://concierge-collector.onrender.com/api/v3/llm",
            "health_check": "https://concierge-collector.onrender.com/api/v3/llm/health",
            "documentation": "https://concierge-collector.onrender.com/api/v3/docs",
            "tool_count": len(get_all_tools()),
            "supported_languages": ["pt-BR", "en-US"],
            "default_region": "BR",
            "data_sources": [
                "Google Places API",
                "MongoDB Entities",
                "Expert Curations"
            ],
            "notes": "Michelin data is included when available in entity records but is not a primary curation source."
        }
    }
