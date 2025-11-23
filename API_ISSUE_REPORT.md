# Relatório de Problema: Concierge API

**Data**: 22 de Novembro de 2025  
**Endpoint Afetado**: `https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions`  
**Função com Bug**: `get_restaurant_availability`

---

## 📋 Resumo Executivo

A função `get_restaurant_availability` da Concierge API está retornando um erro de serialização JSON ao invés dos dados de disponibilidade do restaurante. Isso impede que aplicações cliente obtenham informações sobre horários de funcionamento.

---

## 🔴 Problema Identificado

### Erro Retornado
```json
{
  "error": "Object of type LLMDayAvailability is not JSON serializable"
}
```

### Descrição Técnica
O backend da API está tentando serializar um objeto Python do tipo `LLMDayAvailability` diretamente para JSON sem converter para tipos primitivos primeiro. Isso indica que:

1. **Causa Raiz**: A classe `LLMDayAvailability` é um objeto Python personalizado (provavelmente um Pydantic model ou dataclass) que não implementa o método `__dict__` ou serialização JSON apropriada.

2. **Onde Ocorre**: O erro acontece durante a tentativa de retornar os dados de disponibilidade para o cliente via JSON response.

3. **Impacto**: Qualquer chamada para `get_restaurant_availability` falha, independentemente dos parâmetros fornecidos.

---

## 🧪 Testes Realizados

### Teste 1: Verificação da Função de Disponibilidade
**Request:**
```bash
curl -s 'https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "concierge-restaurant",
    "messages": [
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "test_call_1",
            "type": "function",
            "function": {
              "name": "get_restaurant_availability",
              "arguments": "{\"place_id\": \"ChIJv6b7Up_1zpQRQ-u47vUPYYU\"}"
            }
          }
        ]
      }
    ]
  }'
```

**Response:**
```json
{
  "id": "chatcmpl-7d7e1afafc1e471e82508233",
  "object": "chat.completion",
  "created": 1763857782,
  "model": "concierge-restaurant",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "[{\"call_id\": \"test_call_1\", \"function_name\": \"get_restaurant_availability\", \"result\": \"{\\\"error\\\": \\\"Object of type LLMDayAvailability is not JSON serializable\\\"}\"}]",
        "tool_calls": null,
        "refusal": null
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

**Status**: ❌ FALHA

---

### Teste 2: Comparação com get_restaurant_snapshot
**Request:**
```bash
curl -s 'https://concierge-collector.onrender.com/api/v3/openai/v1/chat/completions' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "concierge-restaurant",
    "messages": [
      {
        "role": "assistant",
        "tool_calls": [
          {
            "id": "test_call_2",
            "type": "function",
            "function": {
              "name": "get_restaurant_snapshot",
              "arguments": "{\"place_id\": \"ChIJv6b7Up_1zpQRQ-u47vUPYYU\"}"
            }
          }
        ]
      }
    ]
  }'
```

**Response:**
```json
{
  "snapshot": {
    "entity_id": "rest_restaurante_sapporo_-23.6057,_-46.6631",
    "place_id": "ChIJv6b7Up_1zpQRQ-u47vUPYYU",
    "name": "Restaurante Sapporo",
    "canonical_address": "Praça Nossa Sra. Aparecida, 114 - Moema, São Paulo - SP, 04075-010",
    "status": {
      "is_open_now": null,
      "open_on_weekend": true,
      "weekend_days_open": ["saturday", "sunday"]
    },
    "opening_hours": {
      "source": "google_places",
      "timezone": "America/Sao_Paulo",
      "regular_hours": {
        "sunday": [{"open": "12:00", "close": "16:00"}, {"open": "18:30", "close": "22:00"}],
        "monday": [{"open": "18:30", "close": "22:30"}],
        "tuesday": [{"open": "12:00", "close": "14:30"}, {"open": "18:30", "close": "22:30"}],
        "wednesday": [{"open": "12:00", "close": "14:30"}, {"open": "18:30", "close": "22:30"}],
        "thursday": [{"open": "12:00", "close": "14:30"}, {"open": "18:30", "close": "22:30"}],
        "friday": [{"open": "12:00", "close": "14:30"}, {"open": "18:30", "close": "22:30"}],
        "saturday": [{"open": "12:00", "close": "15:00"}, {"open": "18:30", "close": "22:30"}]
      }
    },
    "price_level": "PRICE_LEVEL_EXPENSIVE",
    "website": "http://www.restaurantesapporo.com.br/"
  }
}
```

**Status**: ✅ SUCESSO

**Observação Importante**: A função `get_restaurant_snapshot` **funciona corretamente** e retorna os dados de horário dentro do objeto `opening_hours`. Isso sugere que:
- A serialização de horários funciona em `get_restaurant_snapshot`
- O problema é específico de `get_restaurant_availability`
- Provavelmente é um issue de implementação diferente entre as duas funções

---

## 🔍 Análise Comparativa

### ✅ O que funciona (get_restaurant_snapshot):
```python
# Pseudocódigo - provavelmente algo assim no backend
opening_hours = {
    "regular_hours": {
        "monday": [{"open": "12:00", "close": "14:30"}],
        # ...
    }
}
return json.dumps(opening_hours)  # Serializa corretamente
```

### ❌ O que NÃO funciona (get_restaurant_availability):
```python
# Pseudocódigo - provavelmente algo assim no backend
availability = LLMDayAvailability(
    day="monday",
    periods=[...]
)
return json.dumps(availability)  # ERRO: não pode serializar o objeto diretamente
```

---

## 💡 Solução Sugerida

### Backend Fix (Python)
```python
# Opção 1: Usar Pydantic .model_dump() ou .dict()
def get_restaurant_availability(place_id: str):
    availability = fetch_availability_from_db(place_id)
    
    # Se for Pydantic model
    return availability.model_dump()  # Pydantic v2
    # ou
    return availability.dict()  # Pydantic v1
    
    # Se for dataclass
    from dataclasses import asdict
    return asdict(availability)

# Opção 2: Serializer customizado
import json
from typing import Any

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj: Any) -> Any:
        if isinstance(obj, LLMDayAvailability):
            return {
                'day': obj.day,
                'periods': obj.periods,
                # ... outros campos
            }
        return super().default(obj)

# Usar o encoder customizado
json.dumps(availability, cls=CustomJSONEncoder)
```

---

## 🎯 Workaround para Clientes

Enquanto o bug não é corrigido na API, clientes podem usar `get_restaurant_snapshot` para obter informações de horário:

```javascript
// Ao invés de:
const availability = await callFunction('get_restaurant_availability', { place_id });

// Usar:
const snapshot = await callFunction('get_restaurant_snapshot', { place_id });
const hours = snapshot.opening_hours;
const isOpenWeekend = snapshot.status.open_on_weekend;
```

---

## 📊 Impacto

### Severidade: **ALTA** 🔴

**Funcionalidades Afetadas:**
- ❌ Verificação de horário de funcionamento
- ❌ Consulta "está aberto agora?"
- ❌ Consulta "abre aos finais de semana?"

**Funcionalidades NÃO Afetadas:**
- ✅ Busca de restaurantes (`search_restaurants`)
- ✅ Detalhes completos (`get_restaurant_snapshot`) - inclui horários
- ✅ Listagem de funções disponíveis

### Workaround Disponível: **SIM** ✅
Usar `get_restaurant_snapshot` que retorna os mesmos dados de horário funcionando corretamente.

---

## 📝 Recomendações

### Para o Time da API:
1. **Imediato**: Adicionar serialização apropriada para `LLMDayAvailability`
2. **Curto Prazo**: Implementar testes de integração para todas as funções
3. **Médio Prazo**: Considerar deprecar `get_restaurant_availability` em favor de `get_restaurant_snapshot`

### Para Desenvolvedores Clientes:
1. Usar `get_restaurant_snapshot` ao invés de `get_restaurant_availability`
2. Implementar tratamento de erro para quando a função falhar
3. Cachear dados de horário quando possível

---

## 🔗 Informações de Contexto

**API Base URL**: `https://concierge-collector.onrender.com`  
**Endpoint**: `/api/v3/openai/v1/chat/completions`  
**Modelo**: `concierge-restaurant`

**Funções Disponíveis:**
- ✅ `search_restaurants` - Funciona
- ✅ `get_restaurant_snapshot` - Funciona (inclui horários)
- ❌ `get_restaurant_availability` - Não funciona (erro de serialização)

---

## 📧 Contato

Para reportar este issue ao time da Concierge API:
- Incluir este documento como referência
- Mencionar o erro: "Object of type LLMDayAvailability is not JSON serializable"
- Sugerir verificar a serialização JSON da classe `LLMDayAvailability`

---

**Documento gerado em**: 22/11/2025  
**Testado com**: place_id `ChIJv6b7Up_1zpQRQ-u47vUPYYU` (Restaurante Sapporo)  
**Status**: Bug confirmado e documentado
