#!/bin/bash

#
# Status Script
# Purpose: Check status of frontend and backend applications
# Usage: ./status.sh
#

echo "📊 Concierge Collector Status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check process status
check_process() {
    local pid_file=$1
    local service_name=$2
    local port=$3
    
    echo -n "$service_name: "
    
    if [ -f "$pid_file" ]; then
        PID=$(cat "$pid_file")
        if ps -p $PID > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Running${NC} (PID: $PID)"
            
            # Check if port is actually listening
            if lsof -ti:$port > /dev/null 2>&1; then
                echo "  └─ Port $port: ${GREEN}LISTENING${NC}"
            else
                echo "  └─ Port $port: ${RED}NOT LISTENING${NC}"
            fi
        else
            echo -e "${RED}✗ Not running${NC} (stale PID)"
        fi
    else
        echo -e "${RED}✗ Not running${NC} (no PID file)"
        
        # Check if something else is on the port
        PORT_PID=$(lsof -ti:$port 2>/dev/null || true)
        if [ ! -z "$PORT_PID" ]; then
            echo -e "  └─ Port $port: ${YELLOW}OCCUPIED${NC} by PID $PORT_PID"
        fi
    fi
    echo ""
}

# Check backend
check_process "pids/backend.pid" "Backend (FastAPI)" "8000"

# Check frontend (try both ports)
if [ -f "pids/frontend.pid" ]; then
    PID=$(cat "pids/frontend.pid")
    if ps -p $PID > /dev/null 2>&1; then
        echo -n "Frontend (SvelteKit): "
        echo -e "${GREEN}✓ Running${NC} (PID: $PID)"
        
        # Detect actual port
        if lsof -ti:5173 > /dev/null 2>&1; then
            echo "  └─ Port 5173: ${GREEN}LISTENING${NC}"
            FRONTEND_PORT=5173
        elif lsof -ti:5174 > /dev/null 2>&1; then
            echo "  └─ Port 5174: ${GREEN}LISTENING${NC}"
            FRONTEND_PORT=5174
        else
            echo "  └─ Port: ${RED}NOT FOUND${NC}"
            FRONTEND_PORT=5173
        fi
    else
        echo -e "Frontend (SvelteKit): ${RED}✗ Not running${NC} (stale PID)"
        FRONTEND_PORT=5173
    fi
else
    echo -e "Frontend (SvelteKit): ${RED}✗ Not running${NC} (no PID file)"
    FRONTEND_PORT=5173
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📱 URLs:"
echo "   Frontend:  http://localhost:$FRONTEND_PORT"
echo "   Backend:   http://localhost:8000"
echo "   API Docs:  http://localhost:8000/docs"
echo ""
echo "📋 View Logs:"
echo "   Backend:   tail -f logs/backend.log"
echo "   Frontend:  tail -f logs/frontend.log"
echo ""
