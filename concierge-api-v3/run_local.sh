#!/bin/bash

###############################################################################
# File: run_local.sh
# Purpose: Start the Concierge API V3 backend locally for development
# Usage: ./run_local.sh
###############################################################################

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Concierge Collector API V3 - Local Server    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo -e "${YELLOW}💡 Creating .env from .env.example...${NC}"
    cp .env.example .env
    echo -e "${YELLOW}⚠️  Please edit .env with your configuration and run again${NC}"
    exit 1
fi

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Error: Python 3 is not installed${NC}"
    exit 1
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}📦 Creating virtual environment...${NC}"
    python3 -m venv venv
    echo -e "${GREEN}✅ Virtual environment created${NC}"
fi

# Check if dependencies are installed
if [ ! -f "venv/bin/uvicorn" ]; then
    echo -e "${GREEN}📦 Installing dependencies...${NC}"
    venv/bin/pip install -q --upgrade pip
    venv/bin/pip install -r requirements.txt
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi

# Check MongoDB connection
echo -e "${GREEN}🔍 Checking configuration...${NC}"
venv/bin/python3 -c "
import os
from dotenv import load_dotenv
load_dotenv()

mongodb_url = os.getenv('MONGODB_URL', '')
if not mongodb_url or 'username:password' in mongodb_url:
    print('\033[1;33m⚠️  Warning: MongoDB URL not configured in .env\033[0m')
    print('\033[1;33m   Some endpoints may not work\033[0m')
else:
    print('\033[0;32m✅ MongoDB configured\033[0m')

if not os.getenv('GOOGLE_PLACES_API_KEY'):
    print('\033[1;33m⚠️  Warning: Google Places API key not set\033[0m')
    
if not os.getenv('OPENAI_API_KEY'):
    print('\033[1;33m⚠️  Warning: OpenAI API key not set\033[0m')

if not os.getenv('GOOGLE_OAUTH_CLIENT_ID'):
    print('\033[1;33m⚠️  Warning: Google OAuth not configured\033[0m')
"

echo ""
echo -e "${GREEN}🚀 Starting API server in background...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   API:${NC} http://localhost:8000/api/v3"
echo -e "${GREEN}   Docs:${NC} http://localhost:8000/api/v3/docs"
echo -e "${GREEN}   Health:${NC} http://localhost:8000/api/v3/health"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Start the server using venv python in background
venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload > uvicorn.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > .server.pid

echo -e "${GREEN}✅ Server started with PID: ${SERVER_PID}${NC}"
echo -e "${YELLOW}   Logs:${NC} tail -f uvicorn.log"
echo -e "${YELLOW}   Stop:${NC} kill \$(cat .server.pid) or pkill -f uvicorn"
echo ""
