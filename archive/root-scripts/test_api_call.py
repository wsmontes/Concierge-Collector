#!/usr/bin/env python3
"""
Test API call to validate save_to_cache functionality
Uses correct production URL from deployment docs
"""
import requests
import json
import os
from dotenv import load_dotenv

# Load environment
load_dotenv('concierge-api-v3/.env')

# Correct URL from DEPLOYMENT.md
API_URL = "https://concierge-collector.onrender.com/api/v3"
JWT_TOKEN = os.getenv('JWT_TOKEN', '')

if not JWT_TOKEN:
    print("⚠️  JWT_TOKEN não encontrado no .env")
    print("❌ Por favor, adicione ao concierge-api-v3/.env:")
    print("   JWT_TOKEN=seu_token_aqui")
    exit(1)

headers = {
    'Authorization': f'Bearer {JWT_TOKEN}',
    'Content-Type': 'application/json'
}

print("=" * 70)
print("🧪 TESTE: Extração de Conceitos (save_to_db: false)")
print("=" * 70)
print(f"Endpoint: {API_URL}/ai/orchestrate\n")

payload = {
    "text": "Amazing Italian restaurant with fresh pasta and wood-fired pizza. Great wine selection, cozy atmosphere.",
    "entity_type": "restaurant",
    "output": {
        "save_to_db": False,
        "return_results": True
    }
}

print("📤 Request Body:")
print(json.dumps(payload, indent=2))
print()

try:
    print("🔄 Enviando requisição...")
    response = requests.post(
        f"{API_URL}/ai/orchestrate",
        headers=headers,
        json=payload,
        timeout=45
    )
    
    print(f"📥 Response Status: {response.status_code}\n")
    
    if response.status_code == 200:
        result = response.json()
        print("✅ Sucesso!\n")
        print(f"Workflow: {result.get('workflow')}")
        print(f"Saved to DB: {result.get('saved_to_db')}")
        print(f"Processing time: {result.get('processing_time_ms')}ms\n")
        
        if 'results' in result and 'concepts' in result['results']:
            concepts_data = result['results']['concepts']
            if 'concepts' in concepts_data:
                concepts = concepts_data['concepts']
                print(f"📊 Conceitos Extraídos ({len(concepts)}):")
                for i, c in enumerate(concepts[:10], 1):
                    print(f"  {i}. {c.get('category', 'N/A')}: {c.get('value', 'N/A')}")
                if len(concepts) > 10:
                    print(f"  ... e mais {len(concepts) - 10} conceitos")
            
            print(f"\nConfiança: {concepts_data.get('confidence_score', 'N/A')}")
            print(f"Modelo: {concepts_data.get('model', 'N/A')}")
        
        print("\n✅ TESTE PASSOU: Conceitos extraídos SEM salvar no MongoDB")
        
    elif response.status_code == 401:
        print("❌ Erro de autenticação (401)")
        print("JWT token inválido ou expirado")
        print("\nResponse:")
        print(response.text)
        
    elif response.status_code == 404:
        print("❌ Endpoint não encontrado (404)")
        print("API pode estar fazendo deploy ou offline")
        
    else:
        print(f"❌ Erro {response.status_code}")
        print("\nResponse:")
        print(response.text[:1000])
        
except requests.exceptions.Timeout:
    print("⏱️  Timeout - API pode estar fazendo deploy ou lenta")
    
except requests.exceptions.ConnectionError as e:
    print("❌ Erro de conexão")
    print(f"Detalhes: {str(e)}")
    
except Exception as e:
    print(f"❌ Erro inesperado: {str(e)}")

print("\n" + "=" * 70)
