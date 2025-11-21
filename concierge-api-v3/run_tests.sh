#!/bin/bash
# Run all backend tests in production environment (Render)
# Usage: ./run_tests.sh

set -e

echo "🧪 Running Backend Tests on Render..."
echo "======================================"

cd "$(dirname "$0")"

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Install test dependencies if needed
pip install pytest pytest-asyncio httpx --quiet

# Run tests
echo ""
echo "📦 Running pytest..."
venv/bin/pytest tests/ -v --tb=short

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All tests passed!"
    exit 0
else
    echo ""
    echo "❌ Tests failed!"
    exit 1
fi
