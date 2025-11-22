# LLM Gateway - MCP Integration Guide

**Model Context Protocol (MCP) integration for Concierge Restaurant Tools**

Last Updated: November 21, 2025

---

## 📋 Overview

This guide covers how to integrate the Concierge Restaurant LLM Gateway with any MCP-compatible client (Claude Desktop, custom agents, etc.).

The LLM Gateway provides **3 tools** for restaurant search and information retrieval:
1. **`search_restaurants`** - Find restaurants by name/query
2. **`get_restaurant_snapshot`** - Get complete restaurant information
3. **`get_restaurant_availability`** - Check opening hours and availability

---

## 🚀 Quick Start - Claude Desktop

### 1. Prerequisites

- Claude Desktop app installed
- Internet connection
- Access to Claude Desktop config file

### 2. Configuration

Add to your Claude Desktop MCP config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "concierge-restaurant": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http@latest",
        "https://concierge-collector.onrender.com/api/v3/llm"
      ],
      "env": {
        "REQUEST_TIMEOUT": "30000"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

Close and reopen Claude Desktop. The tools should now be available.

### 4. Verify Installation

In Claude, ask:
> "What restaurant tools do you have available?"

Claude should list the 3 Concierge tools.

---

## 🔧 Tool Specifications

### Tool 1: `search_restaurants`

**Purpose**: Find restaurants by name or search query.

**When to use**:
- User mentions a restaurant name
- User asks to find restaurants (e.g., "find pizza places near me")
- Need to disambiguate between multiple restaurants

**Parameters**:
```json
{
  "query": "D.O.M",                    // Required: restaurant name or search term
  "latitude": -23.5505,                 // Optional: for location bias
  "longitude": -46.6333,                // Optional: for location bias
  "radius_m": 5000,                     // Optional: search radius (default: 5000)
  "max_results": 5,                     // Optional: max results (default: 5)
  "language": "pt-BR",                  // Optional: language (default: pt-BR)
  "region": "BR"                        // Optional: region (default: BR)
}
```

**Returns**:
```json
{
  "items": [
    {
      "place_id": "ChIJ...",
      "entity_id": "ent_rest_123",       // Only if has_entity=true
      "name": "Restaurante D.O.M.",
      "canonical_address": "Rua Barão de Capanema, 549, São Paulo - SP",
      "geo": {
        "lat": -23.561684,
        "lng": -46.660144
      },
      "google_rating": 4.6,
      "has_entity": true,
      "has_michelin_data": true,
      "michelin": {
        "has_star": true,
        "stars": 2
      }
    }
  ],
  "total_results": 1
}
```

**Important**: Save `place_id` or `entity_id` from results for use in other tools.

---

### Tool 2: `get_restaurant_snapshot`

**Purpose**: Get complete, consolidated restaurant information.

**When to use**:
- After `search_restaurants` when you have place_id/entity_id
- User asks for details about a restaurant
- User asks about ratings, contact info, hours, etc.
- Need comprehensive context

**Parameters**:
```json
{
  // ONE of these is required:
  "place_id": "ChIJ...",                // From search_restaurants
  "entity_id": "ent_rest_123",          // From search_restaurants (if has_entity=true)
  
  // Optional flags:
  "include_google_places": true,        // Include Google data (default: true)
  "include_curations": true,            // Include expert tags/highlights (default: true)
  "include_raw_sources": false,         // Include raw data (default: false)
  "reference_datetime_iso": "2025-11-21T20:00:00",  // For is_open_now calc
  "timezone": "America/Sao_Paulo"       // Timezone (default: America/Sao_Paulo)
}
```

**Returns**: Complete `LLMRestaurantSnapshot` with:
- Basic info (name, address, phone, website)
- Geographic coordinates
- Opening hours by day
- Current open/closed status
- Google ratings
- Michelin data (if available in entity)
- Curated tags and highlights
- Price level and types

**Example response structure**:
```json
{
  "snapshot": {
    "entity_id": "ent_rest_123",
    "place_id": "ChIJ...",
    "name": "Restaurante D.O.M.",
    "canonical_address": "Rua Barão de Capanema, 549, São Paulo - SP",
    "geo": {
      "lat": -23.561684,
      "lng": -46.660144,
      "city": "São Paulo",
      "country": "BR"
    },
    "status": {
      "is_open_now": false,
      "open_on_weekend": true,
      "weekend_days_open": ["saturday"],
      "supports_reservation": true,
      "business_status": "OPERATIONAL"
    },
    "opening_hours": {
      "source": "google_places",
      "timezone": "America/Sao_Paulo",
      "regular_hours": {
        "monday": [{"open": "19:00", "close": "23:00"}],
        "saturday": [{"open": "19:00", "close": "23:30"}],
        "sunday": []
      }
    },
    "michelin": {
      "has_star": true,
      "stars": 2,
      "guide_year": 2024,
      "cuisine": "Contemporary Brazilian"
    },
    "curation": {
      "tags": ["romantic", "fine-dining"],
      "highlights": ["Best for special occasions"]
    },
    "scores": {
      "google_rating": 4.6,
      "google_reviews_count": 832
    },
    "phone": "(11) 3088-0761",
    "website": "https://domrestaurante.com.br"
  },
  "sources_used": ["entity", "google_places", "curations"]
}
```

---

### Tool 3: `get_restaurant_availability`

**Purpose**: Check restaurant hours and availability (specialized tool).

**When to use**:
- User specifically asks "Is it open now?"
- User asks about weekend hours
- User asks "What days is it open?"
- Need focused availability info

**Parameters**:
```json
{
  // ONE of these is required:
  "place_id": "ChIJ...",
  "entity_id": "ent_rest_123",
  
  // Optional:
  "date_iso": "2025-11-22",            // Check specific date
  "datetime_iso": "2025-11-22T20:00:00",  // Check specific datetime
  "timezone": "America/Sao_Paulo",
  "weekend_days": ["saturday", "sunday"]
}
```

**Returns**:
```json
{
  "resolved_place_id": "ChIJ...",
  "resolved_entity_id": "ent_rest_123",
  "name": "Restaurante D.O.M.",
  "is_open_now": false,
  "open_on_weekend": true,
  "weekend_days_open": ["saturday"],
  "availability_by_day": {
    "saturday": {
      "is_open": true,
      "periods": [{"open": "19:00", "close": "23:30"}]
    },
    "sunday": {
      "is_open": false,
      "periods": []
    }
  },
  "notes": ["Aberto apenas: saturday"],
  "timezone": "America/Sao_Paulo"
}
```

---

## 💬 Example Conversations

### Example 1: Basic Search + Details

**User**: "Tell me about the D.O.M restaurant in São Paulo"

**LLM Flow**:
1. Call `search_restaurants` with `query="D.O.M"`
2. Get results with `place_id` and `entity_id`
3. Call `get_restaurant_snapshot` with the `place_id`
4. Present information naturally:

**LLM Response**:
> "D.O.M is a 2-Michelin-star contemporary Brazilian restaurant located at Rua Barão de Capanema, 549 in São Paulo. It has a Google rating of 4.6 based on 832 reviews. The restaurant is perfect for romantic occasions and fine dining. It's currently closed but opens on Saturday evenings from 7:00 PM to 11:30 PM. You can make reservations by calling (11) 3088-0761 or visiting their website at domrestaurante.com.br."

---

### Example 2: Availability Question

**User**: "Is D.O.M open on weekends?"

**LLM Flow**:
1. Call `search_restaurants` with `query="D.O.M"`
2. Call `get_restaurant_availability` with the `place_id`
3. Interpret results:

**LLM Response**:
> "Yes, D.O.M is open on Saturdays from 7:00 PM to 11:30 PM, but it's closed on Sundays."

---

### Example 3: Location-Based Search

**User**: "Find me a good restaurant near Avenida Paulista"

**LLM Flow**:
1. Convert "Avenida Paulista" to coordinates (you'd use internal knowledge or geocoding)
2. Call `search_restaurants` with `latitude=-23.5558`, `longitude=-46.6599`, `radius_m=2000`
3. Present top results

**LLM Response**:
> "I found several great restaurants near Avenida Paulista:
> 
> 1. **Maní** (4.6★) - Contemporary Brazilian cuisine
> 2. **Figueira Rubaiyat** (4.5★) - Upscale steakhouse
> 3. **Jun Sakamoto** (4.7★) - Fine Japanese dining
> 
> Would you like more details about any of these?"

---

## 🔍 Tool Discovery Endpoints

### Get Tool Schemas

**Endpoint**: `GET /llm/tools`

```bash
curl https://concierge-collector.onrender.com/api/v3/llm/tools
```

Returns JSON Schema definitions for all tools.

### Get Complete Manifest

**Endpoint**: `GET /llm/tools-manifest`

```bash
curl https://concierge-collector.onrender.com/api/v3/llm/tools-manifest
```

Returns complete manifest with metadata, tool schemas, and service info.

### Health Check

**Endpoint**: `GET /llm/health`

```bash
curl https://concierge-collector.onrender.com/api/v3/llm/health
```

Verify the service is running and see available endpoints.

---

## 🎯 Best Practices for LLMs

### 1. Always Search First

For any restaurant mentioned by name, call `search_restaurants` first to get identifiers:

```
User mentions "Dom Manolo" 
→ search_restaurants(query="Dom Manolo")
→ get place_id or entity_id
→ get_restaurant_snapshot(place_id=...) for details
```

### 2. Use entity_id When Available

If `search_restaurants` returns `has_entity=true`, prefer using `entity_id` over `place_id`:
- `entity_id` gives you curated data + Google data
- `place_id` only gives you Google data

### 3. Choose the Right Tool

- **General questions** → `get_restaurant_snapshot` (comprehensive)
- **Hours/availability only** → `get_restaurant_availability` (focused)
- **Finding restaurants** → `search_restaurants` (discovery)

### 4. Handle No Results Gracefully

If `search_restaurants` returns empty results:
- Try broader search terms
- Check spelling
- Try searching without location bias
- Inform user the restaurant may not be in the system

### 5. Interpret Michelin Data Correctly

Michelin data comes from entities when available. It's NOT a primary curation source:
- If `michelin.has_star=true`, mention it as context
- Don't emphasize Michelin data as the main curation
- Focus on Google ratings and expert curations

---

## 🛠️ Advanced Usage

### Custom MCP Clients

If you're building a custom MCP client:

1. **Tool Discovery**: Call `/llm/tools` to get schemas
2. **HTTP Requests**: Tools are REST endpoints
3. **Mapping**:
   - `search_restaurants` → `POST /llm/search-restaurants`
   - `get_restaurant_snapshot` → `POST /llm/get-restaurant-snapshot`
   - `get_restaurant_availability` → `POST /llm/get-restaurant-availability`

### Local Development

To test against local API:

```json
{
  "mcpServers": {
    "concierge-restaurant-local": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-http@latest",
        "http://localhost:8000/api/v3/llm"
      ]
    }
  }
}
```

---

## 📊 Performance Characteristics

- **Search**: 690-860ms typical response time
- **Snapshot**: 360ms typical response time
- **Availability**: 360ms typical response time
- **Timeout**: 30 seconds (configurable)
- **Rate Limiting**: Not currently enforced

---

## 🐛 Troubleshooting

### Tools Not Appearing in Claude

1. Check config file location and JSON syntax
2. Restart Claude Desktop completely
3. Check logs in Claude settings
4. Verify internet connection
5. Test endpoints directly with curl

### "place_id or entity_id required" Error

Make sure you're calling `search_restaurants` first and passing the returned ID to other tools.

### Slow Responses

- Google Places API can be slow sometimes
- Consider caching results client-side
- Use `get_restaurant_availability` for focused queries

### Empty Results

- Try broader search terms
- Remove location bias
- Check if restaurant exists in system
- Try alternative spellings

---

## 📚 Additional Resources

- **API Documentation**: https://concierge-collector.onrender.com/api/v3/docs
- **Health Check**: https://concierge-collector.onrender.com/api/v3/llm/health
- **Tool Schemas**: https://concierge-collector.onrender.com/api/v3/llm/tools
- **Full Manifest**: https://concierge-collector.onrender.com/api/v3/llm/tools-manifest

---

## 📝 Notes

- Michelin data is stored in entities but is **not** a primary curation source
- All times are in the restaurant's local timezone (default: America/Sao_Paulo)
- Google Places data is fetched fresh and updates entities automatically
- Curations come from expert curators and include tags/highlights
- Weekend detection is configurable (default: Saturday + Sunday)

---

**Version**: 1.0.0  
**Last Updated**: November 21, 2025  
**Status**: Production Ready ✅
