#!/bin/bash
# Script to stop the Concierge Collector API V3
# Gracefully stops the background API server

# Configuration
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT_DIR/concierge-api-v3"
PID_FILE="$API_DIR/.api.pid"

# Check if PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo "❌ API is not running (no PID file found)"
    exit 1
fi

# Read PID
PID=$(cat "$PID_FILE")

# Check if process is running
if ! ps -p "$PID" > /dev/null 2>&1; then
    echo "❌ API process (PID: $PID) is not running"
    rm "$PID_FILE"
    exit 1
fi

# Stop the process
echo "🛑 Stopping Concierge Collector API V3 (PID: $PID)..."

# Try graceful shutdown first (SIGTERM)
kill "$PID"

# Wait for process to stop (max 10 seconds)
for i in {1..10}; do
    if ! ps -p "$PID" > /dev/null 2>&1; then
        echo "✅ API stopped successfully"
        rm "$PID_FILE"
        exit 0
    fi
    sleep 1
done

# If still running, force kill (SIGKILL)
echo "⚠️  Process did not stop gracefully, forcing shutdown..."
kill -9 "$PID"

# Wait a bit more
sleep 1

if ! ps -p "$PID" > /dev/null 2>&1; then
    echo "✅ API stopped (forced)"
    rm "$PID_FILE"
    exit 0
else
    echo "❌ Failed to stop API process"
    exit 1
fi
