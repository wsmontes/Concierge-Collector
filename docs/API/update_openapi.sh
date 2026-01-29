#!/bin/bash
#
# Update OpenAPI Schema from Running API
# 
# This script downloads the OpenAPI schema from the running FastAPI application
# and converts it to both JSON and YAML formats.
#

set -e

API_URL="${API_URL:-http://localhost:8000/api/v3}"
OUTPUT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🔄 Updating OpenAPI schema from $API_URL..."
echo ""

# Check if API is running
if ! curl -s "$API_URL/health" > /dev/null 2>&1; then
    echo "❌ Error: API is not running at $API_URL"
    echo ""
    echo "Please start the API first:"
    echo "  cd concierge-api-v3"
    echo "  python main.py"
    echo ""
    exit 1
fi

echo "✅ API is running"
echo ""

# Download OpenAPI JSON
echo "📥 Downloading OpenAPI schema..."
curl -s "$API_URL/openapi.json" > "$OUTPUT_DIR/openapi.json"

if [ ! -s "$OUTPUT_DIR/openapi.json" ]; then
    echo "❌ Error: Failed to download schema"
    exit 1
fi

echo "✅ Downloaded openapi.json"
echo ""

# Convert to YAML
echo "🔄 Converting to YAML..."
python3 -c "
import json
import yaml
import sys

try:
    with open('$OUTPUT_DIR/openapi.json', 'r') as f:
        data = json.load(f)
    
    with open('$OUTPUT_DIR/openapi.yaml', 'w') as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
    
    print('✅ Created openapi.yaml')
except Exception as e:
    print(f'❌ Error: {e}', file=sys.stderr)
    sys.exit(1)
"

if [ $? -ne 0 ]; then
    echo "❌ YAML conversion failed"
    exit 1
fi

echo ""
echo "📊 Schema Statistics:"
echo "  JSON: $(wc -c < "$OUTPUT_DIR/openapi.json" | tr -d ' ') bytes"
echo "  YAML: $(wc -l < "$OUTPUT_DIR/openapi.yaml" | tr -d ' ') lines"
echo ""
echo "✅ OpenAPI schema updated successfully!"
echo ""
echo "📁 Files:"
echo "  - $OUTPUT_DIR/openapi.json"
echo "  - $OUTPUT_DIR/openapi.yaml"
echo ""
echo "🔗 Interactive docs:"
echo "  - Swagger UI: $API_URL/docs"
echo "  - ReDoc: $API_URL/redoc"
echo ""
