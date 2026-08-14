#!/usr/bin/env python3
"""Test curation creation API directly to see the real error"""
import requests
import json
import os
from dotenv import load_dotenv

load_dotenv()

# Get token from environment or use the one from the logs
token = os.getenv("TEST_TOKEN", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ3YWduZXJAbG90aWVyLmNvbSIsImdvb2dsZV9pZCI6IjEwMzQwOTI2MDY1MTgyOTEwMzUxNiIsImV4cCI6MTc3MDM2OTUxNywiaWF0IjoxNzcwMzY1OTE3fQ.u2FCy0V6X3FzDCTxL12PYKZENK05r6kPFEiv3Baicpw")

# Test payload (exactly what frontend is sending)
payload = {
    "curation_id": "curation_test_1770366338136",
    "entity_id": "rest_teste_db_5_1770366338129",
    "curator": {
        "id": "wagner@lotier.com",
        "name": "wagner",
        "email": "wagner@lotier.com"
    },
    "categories": {
        "cuisine": ["Italian", "Northern Italian"],
        "suitable_for": ["Evening dining"]
    },
    "notes": {
        "public": "Test notes",
        "private": None
    },
    "sources": ["manual_curation"]
}

url = "https://concierge-collector.onrender.com/api/v3/curations"
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

print("=" * 80)
print("TESTING CURATION API")
print("=" * 80)
print(f"\nURL: {url}")
print(f"Token: {token[:50]}...")
print(f"\nPayload:")
print(json.dumps(payload, indent=2))

try:
    response = requests.post(url, headers=headers, json=payload, timeout=30)
    
    print(f"\n{'=' * 80}")
    print(f"RESPONSE")
    print(f"{'=' * 80}")
    print(f"Status: {response.status_code}")
    print(f"Headers: {dict(response.headers)}")
    
    try:
        print(f"\nBody:")
        print(json.dumps(response.json(), indent=2))
    except:
        print(f"\nRaw body:")
        print(response.text)
        
except requests.exceptions.Timeout:
    print("\n❌ Request timed out after 30 seconds")
except Exception as e:
    print(f"\n❌ Error: {type(e).__name__}: {e}")
