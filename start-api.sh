#!/bin/bash
# Script to start the Concierge Collector API V3 in background
# Starts uvicorn server without blocking the terminal

# Configuration
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
API_DIR="$ROOT_DIR/concierge-api-v3"
PID_FILE="$API_DIR/.api.pid"
LOG_FILE="$API_DIR/api.log"
FRONTEND_PID_FILE="$ROOT_DIR/pids/frontend.pid"
FRONTEND_LOG_FILE="$ROOT_DIR/logs/frontend.log"
HOST="0.0.0.0"
PORT="8000"
FRONTEND_PORT="8080"

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
    
    # Start frontend HTTP server
    echo "🌐 Starting frontend HTTP server..."
    
    # Create directories if they don't exist
    mkdir -p "$ROOT_DIR/pids"
    mkdir -p "$ROOT_DIR/logs"
    
    # Check if frontend port is already in use
    if lsof -ti:$FRONTEND_PORT > /dev/null 2>&1; then
        echo "⚠️  Port $FRONTEND_PORT is already in use, skipping frontend server"
    else
        cd "$ROOT_DIR"
        # Start Python HTTP server in background
        nohup python3 -m http.server $FRONTEND_PORT > "$FRONTEND_LOG_FILE" 2>&1 &
        FRONTEND_PID=$!
        echo $FRONTEND_PID > "$FRONTEND_PID_FILE"
        
        sleep 1
        
        if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
            echo "✅ Frontend server started successfully!"
            echo "   PID: $FRONTEND_PID"
            echo "   URL: http://localhost:$FRONTEND_PORT"
            echo ""
            
            # Open index.html in default browser
            echo "🚀 Opening application in browser..."
            open "http://localhost:$FRONTEND_PORT/index.html"
        else
            echo "❌ Failed to start frontend server"
            rm -f "$FRONTEND_PID_FILE"
        fi
    fi
    
    echo ""
    echo "To view API logs: tail -f $LOG_FILE"
    echo "To view frontend logs: tail -f $FRONTEND_LOG_FILE"
    echo "To stop both: ./stop-api.sh"
else
    echo "❌ Failed to start API"
    echo "Check the log file: $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi
