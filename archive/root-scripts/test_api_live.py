#!/usr/bin/env python3
"""
Test live API with API Key authentication
Tests extract-concepts endpoint with save_to_db: false
"""

import requests
import json
import os
from pathlib import Path

# Load API_SECRET_KEY from .env
env_file = Path(__file__).parent / "concierge-api-v3" / ".env"
with open(env_file) as f:
    for line in f:
        if line.startswith("API_SECRET_KEY="):
            API_KEY = line.strip().split("=", 1)[1]
            break

API_URL = "https://concierge-collector.onrender.com/api/v3"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

# Test 1: Health check
print("=" * 70)
print("🏥 HEALTH CHECK")
print("=" * 70)
health = requests.get(f"{API_URL}/health")
print(f"Status: {health.status_code}")
print(f"Response: {json.dumps(health.json(), indent=2)}\n")

# Test 2: AI Health
print("=" * 70)
print("🤖 AI HEALTH CHECK")
print("=" * 70)
ai_health = requests.get(f"{API_URL}/ai/health")
print(f"Status: {ai_health.status_code}")
print(f"Response: {json.dumps(ai_health.json(), indent=2)}\n")

# Test 3: Extract concepts WITHOUT saving to MongoDB
print("=" * 70)
print("🧠 EXTRACT CONCEPTS (save_to_db: false)")
print("=" * 70)
payload = {
    "workflow": "text_only",
    "input": {
        "text": "Amazing Italian restaurant in Rome. Best carbonara I ever had. Chef was very friendly and the atmosphere was romantic.",
        "entity_type": "restaurant"
    },
    "output": {
        "save_to_db": False,
        "return_results": True
    }
}

print(f"Request: {json.dumps(payload, indent=2)}\n")

response = requests.post(
    f"{API_URL}/ai/orchestrate",
    headers=headers,
    json=payload,
    timeout=60
)

print(f"Status: {response.status_code}")
if response.status_code == 200:
    result = response.json()
    print("✅ SUCCESS!\n")
    print(f"Concepts extracted: {len(result.get('concepts', []))}")
    print(f"\nSample concepts:")
    print(json.dumps(result.get("concepts", [])[:3], indent=2))
else:
    print(f"❌ ERROR")
    print(response.text)
