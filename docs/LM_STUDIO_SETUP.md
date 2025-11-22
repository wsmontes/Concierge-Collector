# LM Studio Setup Guide - Concierge Restaurant API

## 🎯 Overview

The Concierge Collector API provides a **fully-featured OpenAI-compatible endpoint** that works with LM Studio for local LLM function calling with restaurant data.

**Key Point**: This endpoint does NOT run an LLM itself - it only executes functions. The LLM runs locally in LM Studio.

---

## ✨ Features

✅ **Function Discovery**: Tools array included in responses - LLM can see what's available  
✅ **Streaming Support**: Real-time function execution with `stream=true`  
✅ **Tool Choice Control**: `auto`, `none`, `required`, or specific function name  
✅ **Parallel Execution**: Execute multiple tools simultaneously with `parallel_tool_calls=true`  
✅ **System Message Injection**: Automatic tool descriptions when no system message present  
✅ **Function List Endpoint**: GET `/v1/functions` to inspect available tools  

---

## 📍 Endpoints

### Production
```
Base URL: https://concierge-collector.onrender.com/api/v3/openai

GET  /v1/models           - List available models
GET  /v1/functions        - List available functions
POST /v1/chat/completions - Execute functions
```

### Local Development
```
Base URL: http://localhost:8000/api/v3/openai

GET  /v1/models           - List available models
GET  /v1/functions        - List available functions
POST /v1/chat/completions - Execute functions
```

---

## 🚀 Quick Start

### 1. Test Endpoints

```bash
# Check if API is available
curl https://concierge-collector.onrender.com/api/v3/openai/v1/models

# List available functions
curl https://concierge-collector.onrender.com/api/v3/openai/v1/functions
```

### 2. Configure LM Studio

1. Open **LM Studio**
2. Load a model with function calling support:
   - ✅ Qwen2.5-7B-Instruct
   - ✅ Llama-3.1-8B-Instruct
   - ✅ Gemma-2-9B-it
3. Go to **Developer** tab or enable **API mode**
4. Set custom base URL:
   ```
   https://concierge-collector.onrender.com/api/v3/openai
   ```

### 3. Test with Python

```python
from openai import OpenAI

# Configure client to use Concierge API
client = OpenAI(
    base_url="https://concierge-collector.onrender.com/api/v3/openai/v1",
    api_key="not-needed"  # No auth required
)

# Get available functions
import requests
functions_response = requests.get("https://concierge-collector.onrender.com/api/v3/openai/v1/functions")
print(functions_response.json())

# Initial request - API injects tool descriptions automatically
response = client.chat.completions.create(
    model="concierge-restaurant",
    messages=[
        {
            "role": "user",
            "content": "Find me restaurants with Michelin stars in São Paulo"
        }
    ]
)

print(response.choices[0].message.content)
```

---

## 📚 Available Functions

### 1. search_restaurants

Search for restaurants by name or query. Returns up to 5 candidates by default.

**Parameters:**
- `query` (string, **required**): Restaurant name or search term
- `max_results` (integer, optional): Maximum results (1-20, default: 5)
- `latitude` (number, optional): Latitude for location-biased search
- `longitude` (number, optional): Longitude for location-biased search
- `radius_m` (integer, optional): Search radius in meters (100-50000, default: 5000)

**Example:**
```json
{
  "name": "search_restaurants",
  "arguments": {
    "query": "D.O.M São Paulo",
    "max_results": 5
  }
}
```

**Response:**
```json
{
  "items": [
    {
      "place_id": "ChIJxxx",
      "entity_id": "ent_xxx",
      "name": "D.O.M",
      "formatted_address": "Rua Barão de Capanema, 549",
      "rating": 4.5,
      "total_ratings": 1234
    }
  ],
  "total_results": 1
}
```

---

### 2. get_restaurant_snapshot

Get complete restaurant information including hours, ratings, Michelin data, and curated content.

**Parameters:**
- `place_id` (string, optional): Google Place ID
- `entity_id` (string, optional): Internal entity ID
- *At least one required*

**Example:**
```json
{
  "name": "get_restaurant_snapshot",
  "arguments": {
    "place_id": "ChIJxxx"
  }
}
```

**Response:**
```json
{
  "snapshot": {
    "name": "D.O.M",
    "formatted_address": "Rua Barão de Capanema, 549",
    "rating": 4.5,
    "price_level": 4,
    "cuisines": ["Brazilian", "Contemporary"],
    "michelin_stars": 2,
    "michelin_green_star": true,
    "opening_hours": {
      "open_now": true,
      "weekday_text": [...]
    },
    "phone": "+55 11 3088-0761",
    "website": "https://domrestaurante.com.br"
  },
  "sources_used": ["google_places", "michelin_guide", "curated_content"]
}
```

---

### 3. get_restaurant_availability

Check restaurant opening hours and weekend availability.

**Parameters:**
- `place_id` (string, optional): Google Place ID
- `entity_id` (string, optional): Internal entity ID
- *At least one required*

**Example:**
```json
{
  "name": "get_restaurant_availability",
  "arguments": {
    "place_id": "ChIJxxx"
  }
}
```

**Response:**
```json
{
  "is_open_now": true,
  "current_day": "Friday",
  "next_open": null,
  "weekend_hours": {
    "saturday": "12:00 PM - 11:00 PM",
    "sunday": "12:00 PM - 10:00 PM"
  },
  "special_notes": "Reservations recommended"
}
```

---

## 🔧 Advanced Usage

### Streaming Responses

```bash
curl https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "concierge-restaurant",
    "stream": true,
    "messages": [
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_123",
            "type": "function",
            "function": {
              "name": "search_restaurants",
              "arguments": "{\"query\":\"Maní São Paulo\",\"max_results\":3}"
            }
          }
        ]
      }
    ]
  }'
```

**Response (SSE format):**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"concierge-restaurant","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"concierge-restaurant","choices":[{"index":0,"delta":{"content":"..."},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1700000000,"model":"concierge-restaurant","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

---

### Tool Choice Control

```python
# Require tool usage
response = client.chat.completions.create(
    model="concierge-restaurant",
    messages=[{"role": "user", "content": "Find restaurants"}],
    tool_choice="required"  # Force tool usage
)

# Disable tools
response = client.chat.completions.create(
    model="concierge-restaurant",
    messages=[{"role": "user", "content": "Hello"}],
    tool_choice="none"  # No tools allowed
)

# Specific function
response = client.chat.completions.create(
    model="concierge-restaurant",
    messages=[{"role": "user", "content": "Find restaurants"}],
    tool_choice="search_restaurants"  # Force specific function
)
```

---

### Parallel Tool Execution

```bash
curl https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "concierge-restaurant",
    "parallel_tool_calls": true,
    "messages": [
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_1",
            "type": "function",
            "function": {
              "name": "search_restaurants",
              "arguments": "{\"query\":\"D.O.M\"}"
            }
          },
          {
            "id": "call_2",
            "type": "function",
            "function": {
              "name": "search_restaurants",
              "arguments": "{\"query\":\"Maní\"}"
            }
          }
        ]
      }
    ]
  }'
```

Both searches execute simultaneously using asyncio.

---

### System Message Injection

The API automatically injects a system message with tool descriptions if none is present:

```python
# You send:
messages = [
    {"role": "user", "content": "Find restaurants"}
]

# API automatically injects:
messages = [
    {
        "role": "system",
        "content": """You are a restaurant information assistant with access to these tools:
- search_restaurants: Search for restaurants by name or query...
- get_restaurant_snapshot: Get complete restaurant information...
- get_restaurant_availability: Check restaurant opening hours...

Use these tools to help users find and get information about restaurants."""
    },
    {"role": "user", "content": "Find restaurants"}
]
```

This ensures the LLM knows what tools are available.

---

## 🧪 Testing Guide

### 1. Test Endpoints are Live

```bash
# Should return: {"object":"list","data":[{"id":"concierge-restaurant",...}]}
curl https://concierge-collector.onrender.com/api/v3/openai/v1/models

# Should return: {"functions":[...],"count":3}
curl https://concierge-collector.onrender.com/api/v3/openai/v1/functions
```

### 2. Test Simple Function Call

```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "concierge-restaurant",
    "messages": [
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "test_123",
            "type": "function",
            "function": {
              "name": "search_restaurants",
              "arguments": "{\"query\":\"Fasano\",\"max_results\":3}"
            }
          }
        ]
      }
    ]
  }'
```

Expected: JSON with restaurant results.

### 3. Test with LM Studio

1. Load model in LM Studio
2. Enable Developer mode
3. Set base URL: `https://concierge-collector.onrender.com/api/v3/openai`
4. Ask: "Find Michelin starred restaurants in São Paulo"
5. Model should call `search_restaurants` function
6. API executes and returns results
7. Model processes and responds to user

---

## 🎭 Complete Example: LM Studio Integration

```python
from openai import OpenAI
import json

# Point to Concierge API
client = OpenAI(
    base_url="https://concierge-collector.onrender.com/api/v3/openai/v1",
    api_key="not-needed"
)

# Start conversation
messages = [
    {
        "role": "user",
        "content": "I want to find the best Brazilian restaurants in São Paulo with Michelin stars. Can you help?"
    }
]

# This would typically be done by LM Studio's local LLM
# But we'll simulate the flow:

# Step 1: Initial request (no tools yet)
response = client.chat.completions.create(
    model="concierge-restaurant",
    messages=messages
)

# API returns info about available tools
print("API Response:", response.choices[0].message.content)

# Step 2: LLM decides to call search_restaurants
# (In LM Studio, the local model does this automatically)
messages.append({
    "role": "assistant",
    "tool_calls": [
        {
            "id": "call_abc123",
            "type": "function",
            "function": {
                "name": "search_restaurants",
                "arguments": '{"query":"Michelin star São Paulo","max_results":10}'
            }
        }
    ]
})

# Step 3: Execute function
response = client.chat.completions.create(
    model="concierge-restaurant",
    messages=messages
)

# Get results
results = response.choices[0].message.content
print("\nSearch Results:", results)

# Step 4: For each result, get detailed info
search_results = json.loads(results)

for call in search_results:
    if call["function_name"] == "search_restaurants":
        result_data = json.loads(call["result"])
        
        # Get first restaurant details
        if result_data["items"]:
            first_restaurant = result_data["items"][0]
            
            messages.append({
                "role": "assistant",
                "tool_calls": [
                    {
                        "id": "call_xyz789",
                        "type": "function",
                        "function": {
                            "name": "get_restaurant_snapshot",
                            "arguments": json.dumps({
                                "place_id": first_restaurant["place_id"]
                            })
                        }
                    }
                ]
            })
            
            # Get detailed info
            detail_response = client.chat.completions.create(
                model="concierge-restaurant",
                messages=messages
            )
            
            print("\nRestaurant Details:", detail_response.choices[0].message.content)

# Step 5: LLM would now format this into natural language response for user
```

---

## 📊 Response Format

All responses follow OpenAI format:

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "concierge-restaurant",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "..."
      },
      "finish_reason": "tool_calls"
    }
  ],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 200,
    "total_tokens": 350
  },
  "system_fingerprint": "concierge-restaurant"
}
```

---

## 🐛 Troubleshooting

### Issue: "Model doesn't see available tools"

**Solution**: The API now automatically injects tool descriptions. Make sure you're using the latest version.

```bash
# Verify tools are returned
curl https://concierge-collector.onrender.com/api/v3/openai/v1/functions
```

### Issue: "Function execution fails"

**Solution**: Check that required parameters are provided:
- `search_restaurants`: requires `query`
- `get_restaurant_snapshot`: requires `place_id` OR `entity_id`
- `get_restaurant_availability`: requires `place_id` OR `entity_id`

### Issue: "Streaming doesn't work"

**Solution**: Ensure your client supports SSE (Server-Sent Events) and set `stream: true` in request.

### Issue: "Parallel execution fails"

**Solution**: Check that `parallel_tool_calls: true` is set. The API uses asyncio for parallel execution.

---

## 🔐 Security Notes

- No authentication required (public API)
- Rate limiting may apply
- Production URL: Use HTTPS only
- Local testing: HTTP is fine

---

## 📖 Additional Resources

- [OpenAI Function Calling Docs](https://platform.openai.com/docs/guides/function-calling)
- [LM Studio Documentation](https://lmstudio.ai/docs)
- [API V3 Specification](../API-REF/API_DOCUMENTATION_V3.md)
- [Concierge API GitHub](https://github.com/wsmontes/Concierge-Collector)

---

## 🎉 Summary

The Concierge OpenAI-compatible endpoint provides:

1. ✅ **Full OpenAI compatibility** - Works with LM Studio and OpenAI SDK
2. ✅ **Function discovery** - LLM can see available tools
3. ✅ **Streaming support** - Real-time responses
4. ✅ **Tool control** - Fine-grained control over function calling
5. ✅ **Parallel execution** - Fast multi-tool execution
6. ✅ **Auto-injection** - System messages with tool descriptions
7. ✅ **Restaurant data** - Google Places + Michelin + Curated content

**Ready to use in production!** 🚀
