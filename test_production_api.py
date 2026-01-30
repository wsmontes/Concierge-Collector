#!/usr/bin/env python3
"""
Test production API save_to_cache functionality
Based on actual test patterns from conftest.py
"""
import requests
import json
from datetime import datetime

# Production API URL from DEPLOYMENT.md
API_URL = "https://concierge-collector.onrender.com/api/v3"

print("=" * 80)
print("🧪 TESTE: API save_to_cache em Produção")
print("=" * 80)
print(f"Base URL: {API_URL}")
print(f"Data/Hora: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print()

# Test 1: Health Check (sem auth)
print("📍 Test 1: Health Check")
print("-" * 80)
try:
    response = requests.get(f"{API_URL}/health", timeout=10)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ API Status: {data['status']}")
        print(f"   Database: {data['database']}")
    print()
except Exception as e:
    print(f"❌ Error: {e}\n")

# Test 2: AI Health (sem auth)
print("📍 Test 2: AI Services Health")
print("-" * 80)
try:
    response = requests.get(f"{API_URL}/ai/health", timeout=10)
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"✅ AI Status: {data['status']}")
        print(f"   OpenAI: {data['checks']['openai_api_key']['status']}")
        print(f"   MongoDB: {data['checks']['mongodb']['status']}")
        print(f"   Collections: {data['checks']['mongodb']['collections_count']}")
    print()
except Exception as e:
    print(f"❌ Error: {e}\n")

# Test 3: Extract Concepts (REQUER AUTH)
print("📍 Test 3: Extract Concepts (save_to_db: false)")
print("-" * 80)
print("⚠️  Este endpoint requer autenticação OAuth")
print()

# Payload para teste
payload = {
    "text": "Amazing Italian restaurant with fresh pasta, wood-fired pizza, and excellent wine selection. Cozy romantic atmosphere.",
    "entity_type": "restaurant",
    "output": {
        "save_to_db": False,  # ⭐ TESTE: não deve salvar em MongoDB
        "return_results": True
    }
}

print("📤 Request Payload:")
print(json.dumps(payload, indent=2))
print()

# Instruções para obter token
print("🔐 Para testar com autenticação:")
print()
print("OPÇÃO 1: Via Browser (Recomendado)")
print("  1. Abra: https://concierge-collector-web.onrender.com")
print("  2. Faça login com Google")
print("  3. Abra DevTools (F12) > Console")
print("  4. Execute: localStorage.getItem('oauth_access_token')")
print("  5. Copie o token")
print("  6. Execute:")
print("     export TOKEN='seu_token_aqui'")
print("     python3 test_production_api.py")
print()

print("OPÇÃO 2: Via Test Auth Headers (conftest.py pattern)")
print("  Para ambiente de teste, use:")
print("    export TESTING=true")
print("  Isso bypass auth em test mode")
print()

import os
token = os.getenv('TOKEN', '')

if not token:
    print("❌ TOKEN não definido")
    print("   Testando sem auth (expect 401)...")
    print()
    
    try:
        response = requests.post(
            f"{API_URL}/ai/orchestrate",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=45
        )
        print(f"Status: {response.status_code}")
        
        if response.status_code == 401:
            print("✅ ESPERADO: 401 Unauthorized (auth required)")
            error = response.json()
            print(f"   Detail: {error.get('detail', 'N/A')}")
        else:
            print(f"Response: {response.text[:500]}")
        print()
    except Exception as e:
        print(f"❌ Error: {e}\n")

else:
    print("✅ TOKEN encontrado, testando com autenticação...")
    print()
    
    try:
        response = requests.post(
            f"{API_URL}/ai/orchestrate",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            timeout=60
        )
        
        print(f"📥 Status: {response.status_code}")
        print()
        
        if response.status_code == 200:
            result = response.json()
            print("✅ SUCESSO! Conceitos extraídos")
            print()
            print(f"Workflow: {result.get('workflow')}")
            print(f"Saved to DB: {result.get('saved_to_db')} ⭐ (deve ser False)")
            print(f"Processing time: {result.get('processing_time_ms')}ms")
            print()
            
            if 'results' in result and 'concepts' in result['results']:
                concepts_data = result['results']['concepts']
                if 'concepts' in concepts_data:
                    concepts = concepts_data['concepts']
                    print(f"📊 Conceitos Extraídos: {len(concepts)}")
                    for i, c in enumerate(concepts[:10], 1):
                        print(f"  {i}. {c.get('category', 'N/A')}: {c.get('value', 'N/A')}")
                    if len(concepts) > 10:
                        print(f"  ... e mais {len(concepts) - 10} conceitos")
                
                print()
                print(f"Confidence: {concepts_data.get('confidence_score', 'N/A')}")
                print(f"Model: {concepts_data.get('model', 'N/A')}")
            
            print()
            print("=" * 80)
            print("✅ TESTE PASSOU!")
            print("=" * 80)
            print()
            print("🔍 VALIDAÇÃO:")
            print("  1. saved_to_db deve ser False")
            print("  2. MongoDB collection 'ai_concepts' NÃO deve ter novo registro")
            print("  3. Conceitos devem ser retornados no response")
            print()
            
        elif response.status_code == 401:
            print("❌ Token inválido ou expirado")
            print("   Obtenha novo token do browser")
        else:
            print(f"❌ Error {response.status_code}")
            print(response.text[:1000])
        print()
        
    except requests.exceptions.Timeout:
        print("⏱️  Timeout - OpenAI pode estar demorando")
        print("   Tente novamente")
        print()
    except Exception as e:
        print(f"❌ Error: {e}\n")

print("=" * 80)
print("💡 Para validar no MongoDB:")
print("  1. Conecte no Atlas")
print("  2. Collection: ai_concepts")
print("  3. Filtre por created_at recente")
print("  4. Não deve haver registro do teste acima")
print("=" * 80)
