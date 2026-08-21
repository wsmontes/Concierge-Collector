#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EXPECTED_NODE_MAJOR=22
EXPECTED_NPM=10.9.2
NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
NPM_VERSION="$(npm --version)"

if [[ "$NODE_MAJOR" != "$EXPECTED_NODE_MAJOR" ]]; then
  echo "quality gate requires Node ${EXPECTED_NODE_MAJOR}.x (found $(node --version))" >&2
  exit 2
fi
if [[ "$NPM_VERSION" != "$EXPECTED_NPM" ]]; then
  echo "quality gate requires npm ${EXPECTED_NPM} (found ${NPM_VERSION})" >&2
  exit 2
fi

# Match .github/workflows/quality.yml. --legacy-peer-deps is intentional until
# the current Payload/React peer graph is normalized.
npm ci --legacy-peer-deps
npm run build:collector:check
npm run lint:collector
npm run test:collector
npm run test:coverage

export NODE_ENV="${NODE_ENV:-test}"
export CMS_MONGODB_URL="${CMS_MONGODB_URL:-mongodb://127.0.0.1:27017}"
export CMS_MONGODB_DB_NAME="${CMS_MONGODB_DB_NAME:-concierge-cms-test}"
export CMS_SERVICE_KEY="${CMS_SERVICE_KEY:-test-cms-service-key}"
export CMS_PUBLIC_SERVER_URL="${CMS_PUBLIC_SERVER_URL:-https://admin.example.test}"
export CMS_COLLECTOR_ORIGINS="${CMS_COLLECTOR_ORIGINS:-https://collector.example.test}"
export FASTAPI_BASE_URL="${FASTAPI_BASE_URL:-https://api.example.test}"
export METRICS_KEY="${METRICS_KEY:-test-metrics-key}"
export PAYLOAD_SECRET="${PAYLOAD_SECRET:-test-payload-secret-with-at-least-32-chars}"

npm run test:admin
npm run test:admin:integration
npm run typecheck:admin
npm run build:admin
npm run check:contracts

auto_python="${PYTHON_BIN:-$ROOT/concierge-api-v3/venv/bin/python}"
if [[ ! -x "$auto_python" ]]; then
  echo "Python gate requires an executable interpreter at: $auto_python" >&2
  echo "Set PYTHON_BIN=/path/to/python if your venv lives elsewhere." >&2
  exit 2
fi

"$auto_python" -m pip install \
  -r concierge-api-v3/requirements.txt \
  -r concierge-api-v3/requirements-dev.txt
(
  cd concierge-api-v3
  "$auto_python" -m pytest -m "not integration and not external_api and not mongo and not openai" -q
  "$auto_python" -m black --check app tests
  "$auto_python" -m flake8 app tests --max-line-length=120 --ignore=E203,W503
)

echo "quality gate: PASS"
