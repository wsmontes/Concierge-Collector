#!/bin/bash

###############################################################################
# File: setup_local.sh
# Purpose: Complete local development setup in one command
# Usage: ./setup_local.sh
###############################################################################

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

clear
echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Concierge Collector - Local Setup Wizard    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Navigate to API directory
cd concierge-api-v3

# 1. Create .env if not exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}📝 Creating .env file...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✅ .env created${NC}"
    echo -e "${YELLOW}⚠️  You need to configure the following in .env:${NC}"
    echo ""
    echo "   1. MONGODB_URL - MongoDB connection string"
    echo "   2. GOOGLE_PLACES_API_KEY - (optional) for Places features"
    echo "   3. OPENAI_API_KEY - (optional) for AI features"
    echo "   4. GOOGLE_OAUTH_CLIENT_ID/SECRET - (optional) for authentication"
    echo ""
    echo -e "${YELLOW}Press Enter to open .env for editing (Ctrl+C to skip)...${NC}"
    read -r
    ${EDITOR:-nano} .env
else
    echo -e "${GREEN}✅ .env already exists${NC}"
fi

# 2. Create virtual environment
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}📦 Creating Python virtual environment...${NC}"
    python3 -m venv venv
    echo -e "${GREEN}✅ Virtual environment created${NC}"
else
    echo -e "${GREEN}✅ Virtual environment already exists${NC}"
fi

# 3. Activate and install dependencies
echo -e "${YELLOW}📦 Installing Python dependencies...${NC}"
source venv/bin/activate
pip install --upgrade pip > /dev/null
pip install -r requirements.txt
echo -e "${GREEN}✅ Dependencies installed${NC}"

# 4. Test MongoDB connection (if configured)
echo ""
echo -e "${BLUE}🔍 Testing configuration...${NC}"
python3 << 'EOF'
import os
from dotenv import load_dotenv

load_dotenv()

mongodb_url = os.getenv('MONGODB_URL', '')
has_mongodb = mongodb_url and 'username:password' not in mongodb_url and 'localhost' not in mongodb_url or 'mongodb://' in mongodb_url
has_places = bool(os.getenv('GOOGLE_PLACES_API_KEY'))
has_openai = bool(os.getenv('OPENAI_API_KEY'))
has_oauth = bool(os.getenv('GOOGLE_OAUTH_CLIENT_ID'))

print("")
print("📊 Configuration Status:")
print(f"  • MongoDB:      {'✅ Configured' if has_mongodb else '⚠️  Not configured (optional)'}")
print(f"  • Places API:   {'✅ Configured' if has_places else '⚠️  Not configured (optional)'}")
print(f"  • OpenAI API:   {'✅ Configured' if has_openai else '⚠️  Not configured (optional)'}")
print(f"  • Google OAuth: {'✅ Configured' if has_oauth else '⚠️  Not configured (optional)'}")
print("")

if not has_mongodb:
    print("💡 Tip: Without MongoDB, only the Places API will work.")
    print("   To use MongoDB locally: brew install mongodb-community")
    print("   Or use MongoDB Atlas (free): https://www.mongodb.com/cloud/atlas")
    print("")
EOF

# 5. Instructions
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Setup Complete! 🎉                ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo -e "  1. Start the backend:"
echo -e "     ${GREEN}cd concierge-api-v3 && ./run_local.sh${NC}"
echo ""
echo -e "  2. Open the frontend:"
echo -e "     ${GREEN}Open index.html with VSCode Live Server${NC}"
echo -e "     Or: ${GREEN}python3 -m http.server 5500${NC}"
echo ""
echo -e "  3. Access the application:"
echo -e "     Frontend: ${BLUE}http://127.0.0.1:5500${NC}"
echo -e "     Backend:  ${BLUE}http://localhost:8000/api/v3${NC}"
echo -e "     API Docs: ${BLUE}http://localhost:8000/api/v3/docs${NC}"
echo ""
echo -e "${YELLOW}📚 For more information, see LOCAL_DEVELOPMENT.md${NC}"
echo ""
