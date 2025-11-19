#!/bin/bash

#
# Restart Script
# Purpose: Stop and start both frontend and backend applications
# Usage: ./restart.sh
#

set -e

echo "🔄 Restarting Concierge Collector..."
echo ""

# Stop services
./stop.sh

echo ""
echo "Waiting 2 seconds before restart..."
sleep 2
echo ""

# Start services
./start.sh
