# Usando MCP de Restaurantes com LM Studio

## 🎯 Visão Geral

LM Studio não suporta MCP nativamente, mas você pode usar as mesmas funcionalidades através de **OpenAI Function Calling**.

✅ **Agora implementado:** Endpoint OpenAI-compatible na API!

---

## ⚡ Opção Recomendada: Endpoint OpenAI-Compatible (IMPLEMENTADO)

A API Concierge agora tem um endpoint totalmente compatível com OpenAI Function Calling!

### 📍 Endpoints Disponíveis:

**Produção:**
```
https://concierge-collector.onrender.com/api/v3/openai/v1/models
https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions
```

**Local:**
```
http://localhost:8000/api/v3/openai/v1/models
http://localhost:8000/api/v3/openai/v1/chat/completions
```

---

## 🚀 Como Usar com LM Studio

### 1. Configure LM Studio

1. Abra **LM Studio**
2. Vá na aba **Developer** ou **Chat**
3. Carregue um modelo com suporte a function calling (recomendado: Qwen2.5-7B-Instruct)
4. Configure o endpoint customizado:

```
Base URL: https://concierge-collector.onrender.com/api/v3/openai
```

### 2. Teste com Curl

```bash
curl https://concierge-collector.onrender.com/api/v3/openai/v1/models
```

### 3. Exemplo Completo de Function Calling

```bash
curl https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "concierge-restaurant",
    "messages": [
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "call_123",
            "type": "function",
            "function": {
              "name": "search_restaurants",
              "arguments": "{\"query\":\"D.O.M São Paulo\",\"max_results\":5}"
            }
          }
        ]
      }
    ]
  }'
```

---

## 📚 Funções Disponíveis

### 1. **search_restaurants**
Busca restaurantes por nome ou query.

**Parâmetros:**
- `query` (string, required): Nome ou termo de busca
- `max_results` (integer, optional): Máximo de resultados (1-20, padrão: 20)
- `latitude` (number, optional): Latitude para busca geolocalizada
- `longitude` (number, optional): Longitude para busca geolocalizada
- `radius_m` (integer, optional): Raio de busca em metros (100-50000, padrão: 5000)

**Exemplo:**
```json
{
  "name": "search_restaurants",
  "arguments": "{\"query\":\"Maní\",\"max_results\":10}"
}
```

### 2. **get_restaurant_snapshot**
Obtém informações completas de um restaurante.

**Parâmetros:**
- `place_id` (string, optional): Google Place ID
- `entity_id` (string, optional): ID interno da entidade

**Exemplo:**
```json
{
  "name": "get_restaurant_snapshot",
  "arguments": "{\"place_id\":\"ChIJxxx...\"}"
}
```

### 3. **get_restaurant_availability**
Verifica disponibilidade e horários de funcionamento.

**Parâmetros:**
- `place_id` (string, optional): Google Place ID
- `entity_id` (string, optional): ID interno da entidade

**Exemplo:**
```json
{
  "name": "get_restaurant_availability",
  "arguments": "{\"place_id\":\"ChIJxxx...\"}"
}
```

---

## 🐍 Exemplo Python Completo

```python
from openai import OpenAI

# Conectar ao endpoint Concierge (não precisa de API key)
client = OpenAI(
    base_url="https://concierge-collector.onrender.com/api/v3/openai",
    api_key="not-needed"
)

# Definir as funções disponíveis
tools = [
    {
        "type": "function",
        "function": {
            "name": "search_restaurants",
            "description": "Search for restaurants by name or query",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Restaurant name or search term"
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum results (1-20)",
                        "default": 20
                    }
                },
                "required": ["query"]
            }
        }
    }
]

# Simular chamada de função (normalmente o LLM faria isso)
# 1. LLM decide chamar a função
response = client.chat.completions.create(
    model="concierge-restaurant",
    messages=[
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call_abc123",
                    "type": "function",
                    "function": {
                        "name": "search_restaurants",
                        "arguments": '{"query":"D.O.M","max_results":5}'
                    }
                }
            ]
        }
    ]
)

# 2. API executa a função e retorna resultados
print(response.choices[0].message.content)
```

---

## 🔧 Integração com LM Studio (Passo a Passo)

### Para usar com modelo local (Gemma, Qwen, etc):

1. **Inicie LM Studio como servidor:**
```bash
lms server start
```

2. **Carregue um modelo com suporte a function calling:**
```bash
lms load lmstudio-community/Qwen2.5-7B-Instruct-GGUF
```

3. **No seu código Python:**
```python
from openai import OpenAI
import json

# Cliente LM Studio (modelo local)
lm_studio = OpenAI(
    base_url="http://localhost:1234/v1",
    api_key="lm-studio"
)

# Cliente Concierge API (funções)
concierge = OpenAI(
    base_url="https://concierge-collector.onrender.com/api/v3/openai",
    api_key="not-needed"
)

# Definir funções
tools = [...]  # Ver exemplo acima

# Conversa com o modelo
messages = [
    {"role": "user", "content": "Find D.O.M restaurant in São Paulo"}
]

# 1. Perguntar ao LLM (local)
response = lm_studio.chat.completions.create(
    model="qwen2.5-7b-instruct",
    messages=messages,
    tools=tools
)

# 2. Se o LLM pediu para chamar função
if response.choices[0].message.tool_calls:
    tool_call = response.choices[0].message.tool_calls[0]
    
    # 3. Executar função na API Concierge
    function_response = concierge.chat.completions.create(
        model="concierge-restaurant",
        messages=[
            {
                "role": "assistant",
                "tool_calls": [tool_call.dict()]
            }
        ]
    )
    
    # 4. Dar resultado de volta ao LLM
    messages.append(response.choices[0].message)
    messages.append({
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": function_response.choices[0].message.content
    })
    
    # 5. LLM gera resposta final
    final_response = lm_studio.chat.completions.create(
        model="qwen2.5-7b-instruct",
        messages=messages
    )
    
    print(final_response.choices[0].message.content)
```

---

## 🎯 Modelos Recomendados

| Modelo | Tamanho | Suporte Function Calling |
|--------|---------|--------------------------|
| Qwen2.5-7B-Instruct | 4.68 GB | ⭐⭐⭐ Nativo |
| Llama-3.1-8B-Instruct | 4.92 GB | ⭐⭐⭐ Nativo |
| Ministral-8B-Instruct | 4.67 GB | ⭐⭐⭐ Nativo |
| Gemma-2-9B-Instruct | ~5 GB | ⭐⭐ Default |

---

## 📋 Comparação das Opções:

| Opção | Dificuldade | Function Calling | Melhor Para |
|-------|------------|------------------|-------------|
| **OpenAI Endpoint** ✅ | Fácil | ✅ Sim | **Uso geral (RECOMENDADO)** |
| API REST Direta | Fácil | ❌ Não | Testes rápidos, scripts |
| LangChain | Difícil | ✅ Sim | Aplicações Python complexas |

---

## ❓ Troubleshooting

### Erro "Connection refused"
- Verifique se a API está rodando (produção sempre disponível)
- Para local: `cd concierge-api-v3 && uvicorn main:app --reload`

### LLM não chama funções
- Use modelos com suporte **nativo** a function calling (Qwen2.5, Llama-3.1)
- Verifique se as funções estão bem descritas
- Ajuste a temperatura (valores mais baixos = mais determinístico)

### Funções retornam erro
- Valide os parâmetros JSON
- Verifique logs da API: `lms log stream` (local) ou Render dashboard (produção)

---

## 📚 Documentação Completa:

- **Swagger UI**: https://concierge-collector.onrender.com/api/v3/docs
- **OpenAPI Spec**: https://concierge-collector.onrender.com/api/v3/openapi.json
- **API Reference**: `/API-REF/API_DOCUMENTATION_V3.md`

---

## 🎉 Pronto!

Agora você pode usar modelos locais (Gemma, Qwen, etc) no LM Studio com acesso às funções de restaurantes da API Concierge!


### 1. Instalar dependências adicionais:

```bash
cd /Users/wagnermontes/Documents/GitHub/Concierge-Collector
source .venv/bin/activate
pip install fastapi uvicorn openai
```

### 2. Criar wrapper FastAPI

Arquivo: `mcp-openai-wrapper.py`

```python
#!/usr/bin/env python3
"""
OpenAI-compatible wrapper for Concierge Restaurant MCP
Exposes MCP tools as OpenAI function calling
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import httpx
import uvicorn

app = FastAPI(title="Concierge Restaurant API Wrapper")

API_BASE = "https://concierge-collector.onrender.com/api/v3/llm"

# OpenAI-compatible request/response models
class Message(BaseModel):
    role: str
    content: str
    function_call: Optional[Dict[str, Any]] = None

class ChatRequest(BaseModel):
    model: str
    messages: List[Message]
    functions: Optional[List[Dict[str, Any]]] = None
    function_call: Optional[str] = None

class ChatResponse(BaseModel):
    choices: List[Dict[str, Any]]
    model: str
    usage: Dict[str, int]

# Function definitions (OpenAI format)
FUNCTIONS = [
    {
        "name": "search_restaurants",
        "description": "Search for restaurants by name or query. Returns up to 20 candidates with place_id and entity_id.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Restaurant name or search term"
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum results (1-20)",
                    "default": 20
                },
                "latitude": {
                    "type": "number",
                    "description": "Optional latitude for location-biased search"
                },
                "longitude": {
                    "type": "number",
                    "description": "Optional longitude for location-biased search"
                }
            },
            "required": ["query"]
        }
    },
    {
        "name": "get_restaurant_snapshot",
        "description": "Get complete restaurant information including hours, ratings, Michelin data, and curated content.",
        "parameters": {
            "type": "object",
            "properties": {
                "place_id": {
                    "type": "string",
                    "description": "Google Place ID"
                },
                "entity_id": {
                    "type": "string",
                    "description": "Internal entity ID"
                }
            }
        }
    },
    {
        "name": "get_restaurant_availability",
        "description": "Check restaurant opening hours and weekend availability.",
        "parameters": {
            "type": "object",
            "properties": {
                "place_id": {
                    "type": "string",
                    "description": "Google Place ID"
                },
                "entity_id": {
                    "type": "string",
                    "description": "Internal entity ID"
                }
            }
        }
    }
]

@app.get("/v1/models")
async def list_models():
    """List available models"""
    return {
        "data": [
            {
                "id": "concierge-restaurant",
                "object": "model",
                "owned_by": "concierge"
            }
        ]
    }

@app.post("/v1/chat/completions")
async def chat_completions(request: ChatRequest):
    """
    OpenAI-compatible chat completions endpoint.
    Handles function calling for restaurant tools.
    """
    
    # If there's a function call in the last message, execute it
    last_message = request.messages[-1]
    
    if last_message.function_call:
        function_name = last_message.function_call.get("name")
        arguments = last_message.function_call.get("arguments", {})
        
        # Map to MCP endpoint
        endpoint_map = {
            "search_restaurants": f"{API_BASE}/search-restaurants",
            "get_restaurant_snapshot": f"{API_BASE}/get-restaurant-snapshot",
            "get_restaurant_availability": f"{API_BASE}/get-restaurant-availability"
        }
        
        if function_name in endpoint_map:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    endpoint_map[function_name],
                    json=arguments,
                    headers={"Content-Type": "application/json"}
                )
                data = response.json()
            
            return {
                "choices": [{
                    "message": {
                        "role": "function",
                        "name": function_name,
                        "content": str(data)
                    },
                    "finish_reason": "function_call"
                }],
                "model": request.model,
                "usage": {"total_tokens": 0}
            }
    
    # Regular chat response with available functions
    return {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "I have access to restaurant search and information tools. What would you like to know?"
            },
            "finish_reason": "stop"
        }],
        "model": request.model,
        "usage": {"total_tokens": 0}
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

### 3. Executar o wrapper:

```bash
python mcp-openai-wrapper.py
```

### 4. Configurar LM Studio:

1. Abra LM Studio
2. Vá em **Settings → Server**
3. Configure:
   - **Base URL**: `http://localhost:8001/v1`
   - Habilite **Function Calling** se disponível

---

## ⚡ Opção 2: Chamar API REST Diretamente (Mais Simples)

Você pode simplesmente fazer chamadas HTTP diretas para a API REST do Concierge:

### Endpoint Base:
```
https://concierge-collector.onrender.com/api/v3/llm
```

### Endpoints Disponíveis:

#### 1. Buscar Restaurantes:
```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/llm/search-restaurants \
  -H "Content-Type: application/json" \
  -d '{
    "query": "D.O.M São Paulo",
    "max_results": 20
  }'
```

#### 2. Obter Informações Completas:
```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/llm/get-restaurant-snapshot \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJXxxx..."
  }'
```

#### 3. Verificar Disponibilidade:
```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/llm/get-restaurant-availability \
  -H "Content-Type: application/json" \
  -d '{
    "place_id": "ChIJXxxx..."
  }'
```

---

## 🔧 Opção 3: Usar via LangChain (Avançado)

Se estiver usando Python com LM Studio:

```python
from langchain.tools import tool
from langchain.agents import initialize_agent
import httpx

@tool
def search_restaurants(query: str, max_results: int = 20) -> dict:
    """Search for restaurants by name or query"""
    response = httpx.post(
        "https://concierge-collector.onrender.com/api/v3/llm/search-restaurants",
        json={"query": query, "max_results": max_results}
    )
    return response.json()

@tool
def get_restaurant_info(place_id: str) -> dict:
    """Get complete restaurant information"""
    response = httpx.post(
        "https://concierge-collector.onrender.com/api/v3/llm/get-restaurant-snapshot",
        json={"place_id": place_id}
    )
    return response.json()

# Initialize agent with LM Studio
from langchain.llms import OpenAI

llm = OpenAI(
    base_url="http://localhost:1234/v1",  # LM Studio local server
    api_key="not-needed"
)

agent = initialize_agent(
    tools=[search_restaurants, get_restaurant_info],
    llm=llm,
    agent="zero-shot-react-description"
)

# Use it
result = agent.run("Find information about D.O.M restaurant in São Paulo")
```

---

## 📋 Comparação das Opções:

| Opção | Dificuldade | Function Calling | Melhor Para |
|-------|------------|------------------|-------------|
| Wrapper OpenAI | Média | ✅ Sim | Integração nativa com LM Studio |
| API REST Direta | Fácil | ❌ Não | Testes rápidos, scripts |
| LangChain | Difícil | ✅ Sim | Aplicações Python complexas |

---

## 🎯 Recomendação:

Para uso com **LM Studio**, recomendo a **Opção 2 (API REST Direta)** por enquanto, pois:

1. ✅ Funciona imediatamente
2. ✅ Não requer configuração complexa
3. ✅ LM Studio ainda não tem suporte robusto para function calling

Quando o LM Studio melhorar o suporte a function calling, migre para a **Opção 1**.

---

## 📚 Documentação API:

Toda a documentação da API está disponível em:
- **Swagger UI**: https://concierge-collector.onrender.com/docs
- **OpenAPI Spec**: https://concierge-collector.onrender.com/openapi.json

---

## ❓ Dúvidas?

Consulte também:
- `MCP_SETUP_README.md` - Setup para Claude Desktop
- `API-REF/API_DOCUMENTATION_V3.md` - Documentação completa da API
