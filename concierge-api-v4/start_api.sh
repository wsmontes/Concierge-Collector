#!/bin/bash
# Start Concierge API V4 in background

cd "$(dirname "$0")"

# Activate virtual environment and start API in background
source venv/bin/activate
nohup uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload > api.log 2>&1 &

# Save PID to file
echo $! > api.pid

echo "✅ API V4 started in background (PID: $!)"
echo "📋 Logs: tail -f api.log"
echo "🛑 Stop: ./stop_api.sh or kill $(cat api.pid)"
