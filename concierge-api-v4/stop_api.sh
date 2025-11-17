#!/bin/bash
# Stop Concierge API V4

cd "$(dirname "$0")"

if [ -f api.pid ]; then
    PID=$(cat api.pid)
    if ps -p $PID > /dev/null 2>&1; then
        kill $PID
        echo "✅ API V4 stopped (PID: $PID)"
        rm api.pid
    else
        echo "⚠️ Process $PID not running"
        rm api.pid
    fi
else
    echo "⚠️ No api.pid file found"
    echo "Searching for uvicorn processes..."
    pkill -f "uvicorn app.main:app"
fi
