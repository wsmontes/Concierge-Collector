#!/bin/bash

# Git Status Script - Enhanced view of repository status

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}   Git Repository Status${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Branch info
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${BLUE}📍 Branch:${NC} ${GREEN}${CURRENT_BRANCH}${NC}"

# Remote info
REMOTE_URL=$(git config --get remote.origin.url)
echo -e "${BLUE}🌐 Remote:${NC} ${REMOTE_URL}"

# Last commit
echo ""
echo -e "${BLUE}📊 Last commit:${NC}"
git log -1 --oneline --decorate --color=always

# Status
echo ""
echo -e "${BLUE}📋 Status:${NC}"
git status --short --branch

# Check if there are uncommitted changes
if ! git diff-index --quiet HEAD --; then
    echo ""
    echo -e "${YELLOW}⚠️  You have uncommitted changes${NC}"
    echo -e "${CYAN}Run: ./git-auto.sh \"your commit message\"${NC}"
else
    echo ""
    echo -e "${GREEN}✓ Working tree clean${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
