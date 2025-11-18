#!/bin/bash

###############################################################################
# File: run_collector_tests.sh
# Purpose: Quick launcher for Collector V3 API test suite
# Dependencies: Python 3, API V3 running on port 8001
#
# Main Responsibilities:
# - Check API status
# - Start simple HTTP server
# - Open test suite in browser
###############################################################################

echo "🧪 Collector V3 Test Suite Launcher"
echo "===================================="
echo ""

# Check if API is running
echo "🔍 Checking API status..."
if curl -s http://localhost:8001/health > /dev/null 2>&1; then
    echo "✅ API V3 is running on http://localhost:8001"
else
    echo "❌ API V3 is not running!"
    echo ""
    echo "Please start the API first:"
    echo "  cd concierge-api-v3"
    echo "  source venv/bin/activate"
    echo "  python3 main.py"
    echo ""
    exit 1
fi

echo ""

# Check if port 8000 is available
if lsof -i :8000 > /dev/null 2>&1; then
    echo "⚠️  Port 8000 is already in use"
    echo "Test suite available at: http://localhost:8000/test_collector_v3.html"
else
    echo "🚀 Starting HTTP server on port 8000..."
    echo ""
    echo "📋 Test suite will be available at:"
    echo "   http://localhost:8000/test_collector_v3.html"
    echo ""
    echo "Press Ctrl+C to stop the server"
    echo ""
    
    # Start Python HTTP server
    python3 -m http.server 8000
fi
