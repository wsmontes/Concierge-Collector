#!/bin/bash

# Quick Git Commit - Fast commit with auto-generated message

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check for changes
if git diff-index --quiet HEAD --; then
    echo -e "${BLUE}ℹ No changes to commit${NC}"
    exit 0
fi

# Get current branch
BRANCH=$(git branch --show-current)

# Generate commit message based on changed files
CHANGED_FILES=$(git diff --name-only --cached 2>/dev/null || git diff --name-only)
NUM_FILES=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')

# Detect change type
if echo "$CHANGED_FILES" | grep -q "test"; then
    TYPE="test"
elif echo "$CHANGED_FILES" | grep -q "\.md$"; then
    TYPE="docs"
elif echo "$CHANGED_FILES" | grep -q "\.py$"; then
    TYPE="feat"
elif echo "$CHANGED_FILES" | grep -q "\.js$\|\.html$\|\.css$"; then
    TYPE="ui"
else
    TYPE="chore"
fi

# Generate message
if [ "$NUM_FILES" -eq 1 ]; then
    FILE=$(echo "$CHANGED_FILES" | head -1)
    MESSAGE="${TYPE}: update ${FILE}"
else
    MESSAGE="${TYPE}: update ${NUM_FILES} files"
fi

echo -e "${BLUE}📝 ${MESSAGE}${NC}"

# Execute
git add -A
git commit -m "$MESSAGE"
git push origin "$BRANCH"

echo -e "${GREEN}✓ Done!${NC}"
