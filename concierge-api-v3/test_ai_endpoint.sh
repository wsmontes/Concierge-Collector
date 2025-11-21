#!/bin/bash
# Test AI Orchestrate Endpoint
# Usage: ./test_ai_endpoint.sh [production|local]

ENV=${1:-production}

if [ "$ENV" = "production" ]; then
    BASE_URL="https://concierge-collector.onrender.com/api/v3"
    echo "🌐 Testing PRODUCTION environment"
else
    BASE_URL="http://localhost:8000/api/v3"
    echo "🏠 Testing LOCAL environment"
fi

echo ""
echo "=========================================="
echo "AI Services Health Check"
echo "=========================================="
echo ""

# Test 1: Health Check (no auth required)
echo "1️⃣ Testing AI health endpoint..."
echo "GET $BASE_URL/ai/health"
echo ""
curl -s "$BASE_URL/ai/health" | python3 -m json.tool
echo ""
echo ""

# Test 2: System Info (no auth required)
echo "2️⃣ Testing system info endpoint..."
echo "GET $BASE_URL/info"
echo ""
curl -s "$BASE_URL/info" | python3 -m json.tool
echo ""
echo ""

# Test 3: General Health (no auth required)
echo "3️⃣ Testing general health endpoint..."
echo "GET $BASE_URL/health"
echo ""
curl -s "$BASE_URL/health" | python3 -m json.tool
echo ""
echo ""

# Test 4: Orchestrate endpoint with dummy data (requires auth)
echo "4️⃣ Testing AI orchestrate endpoint (requires auth)..."
echo ""
echo "⚠️  This will fail with 401 if no token provided"
echo "To test with auth, get your token from browser console:"
echo "  1. Open https://concierge-collector-web.onrender.com"
echo "  2. Open browser console (F12)"
echo "  3. Run: AuthService.getToken()"
echo "  4. Copy the token"
echo "  5. Run: export TOKEN='<your-token>'"
echo "  6. Re-run this script"
echo ""

if [ -z "$TOKEN" ]; then
    echo "TOKEN not set, testing without auth (expect 401)..."
    curl -X POST "$BASE_URL/ai/orchestrate" \
        -H "Content-Type: application/json" \
        -d '{"audio_file":"SGVsbG8gV29ybGQh","language":"pt-BR","entity_type":"restaurant"}' \
        -w "\nHTTP Status: %{http_code}\n" \
        -s
else
    echo "TOKEN found, testing with auth..."
    curl -X POST "$BASE_URL/ai/orchestrate" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"audio_file":"SGVsbG8gV29ybGQh","language":"pt-BR","entity_type":"restaurant"}' \
        -w "\nHTTP Status: %{http_code}\n" \
        -s | python3 -m json.tool
fi

echo ""
echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
