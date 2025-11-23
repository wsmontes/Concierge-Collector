#!/bin/bash

# Test script for get_restaurant_availability fix
# Tests the JSON serialization issue reported in API_ISSUE_REPORT.md

echo "🧪 Testing get_restaurant_availability fix..."
echo ""

# Test endpoint
API_URL="https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions"
PLACE_ID="ChIJv6b7Up_1zpQRQ-u47vUPYYU"  # Restaurante Sapporo

echo "📍 Testing with place_id: $PLACE_ID"
echo ""

# Make request
response=$(curl -s "$API_URL" \
  -H 'Content-Type: application/json' \
  -d "{
    \"model\": \"concierge-restaurant\",
    \"messages\": [
      {
        \"role\": \"assistant\",
        \"tool_calls\": [
          {
            \"id\": \"test_availability_fix\",
            \"type\": \"function\",
            \"function\": {
              \"name\": \"get_restaurant_availability\",
              \"arguments\": \"{\\\"place_id\\\": \\\"$PLACE_ID\\\"}\"
            }
          }
        ]
      }
    ]
  }")

echo "📥 Response received"
echo ""

# Check if error exists
if echo "$response" | grep -q "Object of type LLMDayAvailability is not JSON serializable"; then
    echo "❌ FAILED: Serialization error still present"
    echo ""
    echo "Response:"
    echo "$response" | jq '.'
    exit 1
fi

# Check if response has availability data
if echo "$response" | grep -q "availability_by_day"; then
    echo "✅ SUCCESS: Function returns availability data"
    echo ""
    
    # Extract and display availability
    echo "📊 Availability Data:"
    echo "$response" | jq -r '.choices[0].message.content' | jq -r '.[0].result' | jq '.availability_by_day'
    echo ""
    
    # Display weekend info
    echo "🎉 Weekend Info:"
    echo "$response" | jq -r '.choices[0].message.content' | jq -r '.[0].result' | jq '{
        open_on_weekend,
        weekend_days_open,
        notes
    }'
    
    echo ""
    echo "✨ Fix verified successfully!"
    exit 0
else
    echo "⚠️  WARNING: No availability_by_day in response"
    echo ""
    echo "Full response:"
    echo "$response" | jq '.'
    exit 1
fi
