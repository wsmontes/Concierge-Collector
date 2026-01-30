#!/usr/bin/env python3
"""
Test API health and basic endpoints
"""
import requests
import json

# Correct URL from DEPLOYMENT.md
API_URL = "https://concierge-collector.onrender.com/api/v3"

print("=" * 70)
print("🏥 TESTE: API Health Check")
print("=" * 70)
print(f"Base URL: {API_URL}\n")

# Test 1: Health endpoint
print("📍 Test 1: Health Check")
print(f"GET {API_URL}/health\n")

try:
    response = requests.get(f"{API_URL}/health", timeout=10)
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print("✅ API is healthy!")
        print(json.dumps(data, indent=2))
    else:
        print(f"❌ Error: {response.status_code}")
        print(response.text[:500])
        
except Exception as e:
    print(f"❌ Error: {str(e)}")

print("\n" + "-" * 70 + "\n")

# Test 2: Info endpoint
print("📍 Test 2: API Info")
print(f"GET {API_URL}/info\n")

try:
    response = requests.get(f"{API_URL}/info", timeout=10)
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print("✅ API info retrieved!")
        print(json.dumps(data, indent=2))
    else:
        print(f"❌ Error: {response.status_code}")
        print(response.text[:500])
        
except Exception as e:
    print(f"❌ Error: {str(e)}")

print("\n" + "-" * 70 + "\n")

# Test 3: AI Health endpoint
print("📍 Test 3: AI Services Health")
print(f"GET {API_URL}/ai/health\n")

try:
    response = requests.get(f"{API_URL}/ai/health", timeout=10)
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        data = response.json()
        print("✅ AI services are healthy!")
        print(json.dumps(data, indent=2))
    else:
        print(f"❌ Error: {response.status_code}")
        print(response.text[:500])
        
except Exception as e:
    print(f"❌ Error: {str(e)}")

print("\n" + "=" * 70)
print("\n💡 Para testar endpoints protegidos, adicione JWT_TOKEN ao .env")
print("   Arquivo: concierge-api-v3/.env")
print("   Variável: JWT_TOKEN=seu_token_aqui")
print("\n" + "=" * 70)
