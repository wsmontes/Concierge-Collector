#!/bin/bash

# Automated Git Script for Concierge Collector
# Adds, commits, and pushes changes to current branch

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Git Automation Script${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if we're in a git repository
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    echo -e "${RED}✗ Error: Not in a git repository${NC}"
    exit 1
fi

# Get current branch
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${BLUE}📍 Current branch:${NC} ${GREEN}${CURRENT_BRANCH}${NC}"
echo ""

# Check for changes
if git diff-index --quiet HEAD --; then
    echo -e "${YELLOW}ℹ No changes to commit${NC}"
    exit 0
fi

# Show status
echo -e "${BLUE}📋 Changes detected:${NC}"
git status --short
echo ""

# Get commit message (use parameter or ask)
if [ -z "$1" ]; then
    echo -e "${YELLOW}Enter commit message:${NC}"
    read -r COMMIT_MESSAGE
else
    COMMIT_MESSAGE="$1"
fi

if [ -z "$COMMIT_MESSAGE" ]; then
    COMMIT_MESSAGE="Auto-commit: $(date '+%Y-%m-%d %H:%M:%S')"
fi

echo ""
echo -e "${BLUE}📝 Commit message:${NC} ${COMMIT_MESSAGE}"
echo ""

# Add all changes
echo -e "${BLUE}➕ Adding changes...${NC}"
git add -A

# Commit
echo -e "${BLUE}💾 Committing...${NC}"
git commit -m "$COMMIT_MESSAGE"

# Push
echo -e "${BLUE}🚀 Pushing to ${CURRENT_BRANCH}...${NC}"
if git push origin "$CURRENT_BRANCH"; then
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✓ Successfully pushed to ${CURRENT_BRANCH}${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
else
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}✗ Push failed${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}💡 Tips:${NC}"
    echo "   • Check your internet connection"
    echo "   • Verify remote repository access"
    echo "   • Try: git push -u origin ${CURRENT_BRANCH}"
    exit 1
fi

# Show last commit
echo ""
echo -e "${BLUE}📊 Last commit:${NC}"
git log -1 --oneline --decorate
echo ""
