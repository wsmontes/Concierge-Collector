#!/bin/bash

# Test script for restaurant photos endpoint
# Tests both REST endpoint and OpenAI tool integration

echo "======================================"
echo "Testing Restaurant Photos Endpoint"
echo "======================================"
echo ""

# Production URL
API_URL="https://concierge-collector.onrender.com/api/v3"

# Test data - Maní São Paulo
PLACE_ID="ChIJ5xF4HLNZzpQRJ2OMf_Om2aY"

echo "1. Testing REST endpoint (5 photos, 800px width)..."
echo "GET ${API_URL}/places/${PLACE_ID}/photos?max_photos=5&max_width=800"
echo ""

curl -s "${API_URL}/places/${PLACE_ID}/photos?max_photos=5&max_width=800" | jq '.'

echo ""
echo "======================================"
echo ""

echo "2. Testing OpenAI tool integration..."
echo "POST ${API_URL}/openai/v1/chat/completions"
echo ""

curl -s "${API_URL}/openai/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "concierge-restaurant",
    "messages": [
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_photos",
            "type": "function",
            "function": {
              "name": "get_restaurant_photos",
              "arguments": "{\"place_id\":\"'${PLACE_ID}'\",\"max_photos\":3,\"max_width\":600}"
            }
          }
        ]
      }
    ]
  }' | jq '.'

echo ""
echo "======================================"
echo ""

echo "3. Testing with entity_id instead of place_id..."
echo "GET ${API_URL}/places/ChIJ5xF4HLNZzpQRJ2OMf_Om2aY/photos?max_photos=1"
echo ""

curl -s "${API_URL}/places/ChIJ5xF4HLNZzpQRJ2OMf_Om2aY/photos?max_photos=1" | jq '.photos[0].url'

echo ""
echo "======================================"
echo "Tests complete!"
echo "======================================"
