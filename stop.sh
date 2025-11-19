#!/bin/bash

#
# Stop Script
# Purpose: Stop both frontend and backend applications
# Usage: ./stop.sh
#

set -e

echo "🛑 Stopping Concierge Collector..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to kill process by PID file
kill_process() {
    local pid_file=$1
    local service_name=$2
    
    if [ -f "$pid_file" ]; then
        PID=$(cat "$pid_file")
        if ps -p $PID > /dev/null 2>&1; then
            echo -e "${YELLOW}Stopping $service_name (PID: $PID)...${NC}"
            kill $PID 2>/dev/null || true
            sleep 1
            
            # Force kill if still running
            if ps -p $PID > /dev/null 2>&1; then
                echo "Force killing..."
                kill -9 $PID 2>/dev/null || true
            fi
            
            echo -e "${GREEN}✓ $service_name stopped${NC}"
        else
            echo -e "${YELLOW}⚠ $service_name not running (stale PID)${NC}"
        fi
        rm "$pid_file"
    else
        echo -e "${YELLOW}⚠ No PID file found for $service_name${NC}"
    fi
}

# Stop backend
kill_process "pids/backend.pid" "Backend (FastAPI)"

# Stop frontend
kill_process "pids/frontend.pid" "Frontend (SvelteKit)"

# Also kill any remaining processes on those ports
echo ""
echo "Checking for remaining processes..."

# Kill any process on port 8000 (backend)
BACKEND_PORT_PID=$(lsof -ti:8000 2>/dev/null || true)
if [ ! -z "$BACKEND_PORT_PID" ]; then
    echo -e "${YELLOW}Killing remaining process on port 8000...${NC}"
    kill -9 $BACKEND_PORT_PID 2>/dev/null || true
fi

# Kill any process on port 5173 (frontend)
FRONTEND_PORT_PID=$(lsof -ti:5173 2>/dev/null || true)
if [ ! -z "$FRONTEND_PORT_PID" ]; then
    echo -e "${YELLOW}Killing remaining process on port 5173...${NC}"
    kill -9 $FRONTEND_PORT_PID 2>/dev/null || true
fi

# Kill any process on port 5174 (frontend fallback)
FRONTEND_PORT_PID_2=$(lsof -ti:5174 2>/dev/null || true)
if [ ! -z "$FRONTEND_PORT_PID_2" ]; then
    echo -e "${YELLOW}Killing remaining process on port 5174...${NC}"
    kill -9 $FRONTEND_PORT_PID_2 2>/dev/null || true
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓ All services stopped${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
