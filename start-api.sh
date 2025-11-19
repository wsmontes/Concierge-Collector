#!/bin/bash
# Script to start the Concierge Collector API V3 in background
# Starts uvicorn server without blocking the terminal

# Configuration
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT_DIR/concierge-api-v3"
PID_FILE="$API_DIR/.api.pid"
LOG_FILE="$API_DIR/api.log"
HOST="0.0.0.0"
PORT="8000"

# Check if API is already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "❌ API is already running (PID: $PID)"
        echo "Use ./stop-api.sh to stop it first"
        exit 1
    else
        # PID file exists but process is not running, clean it up
        rm "$PID_FILE"
    fi
fi

# Check if port is already in use
if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "❌ Port $PORT is already in use"
    echo "Use 'lsof -ti:$PORT' to find the process"
    exit 1
fi

# Start the API in background
echo "🚀 Starting Concierge Collector API V3..."
cd "$API_DIR"

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Start uvicorn in background and redirect output to log file
nohup uvicorn main:app --host "$HOST" --port "$PORT" --reload > "$LOG_FILE" 2>&1 &

# Save PID
API_PID=$!
echo $API_PID > "$PID_FILE"

# Wait a moment to check if it started successfully
sleep 2

if ps -p "$API_PID" > /dev/null 2>&1; then
    echo "✅ API started successfully!"
    echo "   PID: $API_PID"
    echo "   URL: http://localhost:$PORT"
    echo "   Docs: http://localhost:$PORT/docs"
    echo "   Log: $LOG_FILE"
    echo ""
    echo "To view logs: tail -f $LOG_FILE"
    echo "To stop: ./stop-api.sh"
else
    echo "❌ Failed to start API"
    echo "Check the log file: $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi
