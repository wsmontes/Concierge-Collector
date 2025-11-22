#!/usr/bin/env node

/**
 * MCP Server Wrapper for Concierge Restaurant API
 * 
 * This wrapper translates MCP protocol to REST API calls.
 * Uses the Model Context Protocol SDK to expose restaurant tools.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API_BASE = 'https://concierge-collector.onrender.com/api/v3/llm';

// Create MCP server
const server = new Server(
  {
    name: 'concierge-restaurant',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
const tools = [
  {
    name: 'search_restaurants',
    description: 'Search for restaurants by name or query. Returns candidates with place_id and entity_id for detailed queries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Restaurant name or search term',
        },
        latitude: {
          type: 'number',
          description: 'Optional latitude for location bias',
        },
        longitude: {
          type: 'number',
          description: 'Optional longitude for location bias',
        },
        max_results: {
          type: 'integer',
          description: 'Maximum results (default: 5)',
          default: 5,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_restaurant_snapshot',
    description: 'Get complete restaurant information including hours, ratings, contact info, and curated data.',
    inputSchema: {
      type: 'object',
      properties: {
        place_id: {
          type: 'string',
          description: 'Google Place ID from search results',
        },
        entity_id: {
          type: 'string',
          description: 'Internal entity ID from search results',
        },
      },
    },
  },
  {
    name: 'get_restaurant_availability',
    description: 'Check restaurant opening hours and weekend availability.',
    inputSchema: {
      type: 'object',
      properties: {
        place_id: {
          type: 'string',
          description: 'Google Place ID from search results',
        },
        entity_id: {
          type: 'string',
          description: 'Internal entity ID from search results',
        },
      },
    },
  },
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let endpoint;
    let body = args;

    // Map tool name to endpoint
    switch (name) {
      case 'search_restaurants':
        endpoint = `${API_BASE}/search-restaurants`;
        break;
      case 'get_restaurant_snapshot':
        endpoint = `${API_BASE}/get-restaurant-snapshot`;
        break;
      case 'get_restaurant_availability':
        endpoint = `${API_BASE}/get-restaurant-availability`;
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    // Make API request
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Concierge Restaurant MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
