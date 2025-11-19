#!/bin/bash

#
# Start Script
# Purpose: Start both frontend (SvelteKit) and backend (FastAPI) applications
# Usage: ./start.sh
#

set -e

echo "🚀 Starting Concierge Collector..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if backend directory exists
if [ ! -d "concierge-api-v3" ]; then
    echo "❌ Backend directory 'concierge-api-v3' not found"
    exit 1
fi

# Check if frontend directory exists
if [ ! -d "concierge-v3" ]; then
    echo "❌ Frontend directory 'concierge-v3' not found"
    exit 1
fi

# Start Backend (FastAPI)
echo -e "${BLUE}📦 Starting Backend (FastAPI)...${NC}"
cd concierge-api-v3

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment and start server
source venv/bin/activate

# Install dependencies if needed
if [ ! -f ".deps_installed" ]; then
    echo "Installing Python dependencies..."
    pip install -r requirements.txt
    touch .deps_installed
fi

# Start FastAPI in background
echo "Starting FastAPI server on http://localhost:8000..."
uvicorn app.main:app --reload --port 8000 > ../logs/backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > ../pids/backend.pid

echo -e "${GREEN}✓ Backend started (PID: $BACKEND_PID)${NC}"
echo ""

cd ..

# Wait a bit for backend to start
sleep 2

# Start Frontend (SvelteKit)
echo -e "${BLUE}🎨 Starting Frontend (SvelteKit)...${NC}"
cd concierge-v3

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Start SvelteKit in background
echo "Starting SvelteKit dev server on http://localhost:5173..."
npm run dev > ../logs/frontend.log 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > ../pids/frontend.pid

echo -e "${GREEN}✓ Frontend started (PID: $FRONTEND_PID)${NC}"
echo ""

cd ..

# Create logs and pids directories if they don't exist
mkdir -p logs pids

# Wait for services to be ready
sleep 2

# Detect actual frontend port
FRONTEND_PORT=5173
if lsof -ti:5174 > /dev/null 2>&1; then
    FRONTEND_PORT=5174
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓ All services started successfully!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📱 Frontend:  http://localhost:$FRONTEND_PORT"
echo "🔌 Backend:   http://localhost:8000"
echo "📚 API Docs:  http://localhost:8000/docs"
echo ""
echo "📋 Logs:"
echo "   Backend:   tail -f logs/backend.log"
echo "   Frontend:  tail -f logs/frontend.log"
echo ""
echo "🛑 To stop all services, run: ./stop.sh"
echo ""
