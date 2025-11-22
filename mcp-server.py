#!/usr/bin/env python3
"""
Simple MCP server for Concierge Restaurant API
Uses the MCP Python SDK
"""

import asyncio
import json
import sys
from typing import Any
import httpx

# Try to import mcp - if not installed, provide instructions
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import Tool, TextContent
except ImportError:
    print("Error: MCP SDK not installed", file=sys.stderr)
    print("Install with: pip install mcp", file=sys.stderr)
    sys.exit(1)

API_BASE = "https://concierge-collector.onrender.com/api/v3/llm"

# Create server
app = Server("concierge-restaurant")

# Define tools
TOOLS = [
    Tool(
        name="search_restaurants",
        description="Search for restaurants by name or query. Returns candidates with place_id and entity_id. You can request up to 20 results.",
        inputSchema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Restaurant name or search term"},
                "latitude": {"type": "number", "description": "Optional latitude for location-biased search"},
                "longitude": {"type": "number", "description": "Optional longitude for location-biased search"},
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of results to return (1-20)",
                    "default": 20,
                    "minimum": 1,
                    "maximum": 20
                },
            },
            "required": ["query"],
        },
    ),
    Tool(
        name="get_restaurant_snapshot",
        description="Get complete restaurant information including hours, ratings, and curated data.",
        inputSchema={
            "type": "object",
            "properties": {
                "place_id": {"type": "string", "description": "Google Place ID"},
                "entity_id": {"type": "string", "description": "Internal entity ID"},
            },
        },
    ),
    Tool(
        name="get_restaurant_availability",
        description="Check restaurant opening hours and weekend availability.",
        inputSchema={
            "type": "object",
            "properties": {
                "place_id": {"type": "string", "description": "Google Place ID"},
                "entity_id": {"type": "string", "description": "Internal entity ID"},
            },
        },
    ),
]


@app.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools"""
    return TOOLS


@app.call_tool()
async def call_tool(name: str, arguments: Any) -> list[TextContent]:
    """Handle tool calls"""
    
    # Map tool name to endpoint
    endpoint_map = {
        "search_restaurants": f"{API_BASE}/search-restaurants",
        "get_restaurant_snapshot": f"{API_BASE}/get-restaurant-snapshot",
        "get_restaurant_availability": f"{API_BASE}/get-restaurant-availability",
    }
    
    if name not in endpoint_map:
        return [TextContent(type="text", text=f"Unknown tool: {name}")]
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                endpoint_map[name],
                json=arguments,
                headers={"Content-Type": "application/json"},
            )
            response.raise_for_status()
            data = response.json()
            
        return [TextContent(type="text", text=json.dumps(data, indent=2))]
    
    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


async def main():
    """Run the server"""
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
