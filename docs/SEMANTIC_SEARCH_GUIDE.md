# Semantic Search Endpoint - Guia Completo

## Visão Geral

O endpoint `/api/v3/curations/semantic-search` permite buscar restaurantes e suas curadorias usando **busca semântica baseada em embeddings**. Ao invés de buscar por palavras-chave exatas, o sistema entende o **significado** da query e encontra conceitos relacionados, mesmo que as palavras sejam diferentes.

**Exemplo:** 
- Query: "comida japonesa casual"
- Encontra: restaurantes com `cuisine: japanese`, `food_style: casual`, `setting: relaxed`
- Mesmo sem usar as palavras exatas, o sistema entende o contexto

---

## Como Funciona

### 1. **Arquitetura de Dados**

#### Embeddings nos Curations
Cada curation possui um array de embeddings gerados para cada par `categoria + conceito`:

```json
{
  "curation_id": "curation-454965b23212",
  "entity_id": "entity_ChIJ...",
  "categories": {
    "cuisine": ["japanese", "asian"],
    "food_style": ["casual", "modern"],
    "setting": ["outdoor seating", "air conditioning"]
  },
  "embeddings": [
    {
      "text": "cuisine japanese",
      "category": "cuisine",
      "concept": "japanese",
      "vector": [0.123, -0.456, 0.789, ..., 0.321]  // 1536 dimensões
    },
    {
      "text": "food_style casual",
      "category": "food_style",
      "concept": "casual",
      "vector": [0.213, -0.546, 0.897, ..., 0.421]
    }
  ],
  "embeddings_metadata": {
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "total_embeddings": 75,
    "created_at": "2025-11-23T18:00:00Z"
  }
}
```

### 2. **Fluxo de Processamento**

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USUÁRIO FAZ REQUEST                                      │
│    POST /api/v3/curations/semantic-search                   │
│    Body: { "query": "casual japanese food" }                │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. GERAR EMBEDDING DA QUERY (OpenAI API)                    │
│    Input: "casual japanese food"                            │
│    Model: text-embedding-3-small                            │
│    Output: [0.234, -0.567, ..., 0.891] (1536 dims)         │
│    Tempo: ~150ms                                            │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. BUSCAR CURATIONS COM EMBEDDINGS (MongoDB)                │
│    Query: { embeddings: { $exists: true, $ne: [] } }       │
│    Filtros opcionais:                                       │
│    - entity_types: ["restaurant"]                           │
│    - categories: ["cuisine", "food_style"]                  │
│    Resultado: 55 curations                                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CALCULAR SIMILARIDADE COSINE                             │
│    Para cada curation:                                      │
│      Para cada embedding:                                   │
│        similarity = dot(query_vec, concept_vec) /          │
│                     (||query_vec|| * ||concept_vec||)      │
│                                                             │
│    Exemplo de matches:                                      │
│    - "cuisine japanese" → 0.92 (muito similar)             │
│    - "food_style casual" → 0.85 (similar)                  │
│    - "setting outdoor seating" → 0.65 (pouco similar)      │
│                                                             │
│    Filtrar: similarity >= min_similarity (0.5)             │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. AGREGAR SCORES                                           │
│    Para cada curation:                                      │
│    - max_similarity: melhor match (0.92)                    │
│    - avg_similarity: média dos matches (0.81)               │
│    - match_count: quantidade de matches (8)                 │
│                                                             │
│    Incluir entity data se include_entity=true              │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. RANKING E LIMITES                                        │
│    - Ordenar por max_similarity (descendente)               │
│    - Aplicar limit (padrão: 10 resultados)                  │
│    - Top 10 matches por resultado                           │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. RETORNAR RESPONSE                                        │
│    {                                                        │
│      "results": [...],                                      │
│      "query": "casual japanese food",                       │
│      "query_embedding_time": 0.15,                          │
│      "search_time": 0.42,                                   │
│      "total_results": 8                                     │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## API Reference

### Endpoint

```
POST /api/v3/curations/semantic-search
Content-Type: application/json
```

### Request Body

```json
{
  "query": "casual japanese food with outdoor seating",
  "limit": 10,
  "min_similarity": 0.5,
  "entity_types": ["restaurant"],
  "categories": ["cuisine", "food_style", "setting"],
  "include_entity": true
}
```

#### Parâmetros

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|---------|-----------|
| `query` | string | ✅ | - | Texto da busca (1-500 caracteres) |
| `limit` | integer | ❌ | 10 | Máximo de resultados (1-100) |
| `min_similarity` | float | ❌ | 0.5 | Threshold de similaridade (0.0-1.0) |
| `entity_types` | array | ❌ | null | Filtrar por tipos (ex: ["restaurant"]) |
| `categories` | array | ❌ | null | Buscar só em categorias específicas |
| `include_entity` | boolean | ❌ | true | Incluir dados da entity no response |

### Response

```json
{
  "results": [
    {
      "entity_id": "entity_ChIJZ2oY50JXzpQRkX11EVdu5t0",
      "entity": {
        "name": "Kosushi",
        "entity_type": "restaurant",
        "location": {
          "address": "Rua da Consolação, 3555",
          "city": "São Paulo",
          "coordinates": {
            "lat": -23.5558,
            "lng": -46.6619
          }
        },
        "contact": {
          "phone": "+55 11 3061-5559",
          "website": "https://kosushi.com.br"
        }
      },
      "curation": {
        "curation_id": "curation-454965b23212",
        "categories": {
          "cuisine": ["japanese"],
          "food_style": ["traditional", "modern"],
          "setting": ["air conditioning", "outdoor seating"]
        },
        "curator": {
          "id": "curator-import-script",
          "name": "Import Script"
        },
        "notes": {
          "public": "Curated concepts for kosushi",
          "private": "Automated import..."
        }
      },
      "matches": [
        {
          "text": "cuisine japanese",
          "category": "cuisine",
          "concept": "japanese",
          "similarity": 0.92
        },
        {
          "text": "food_style traditional",
          "category": "food_style",
          "concept": "traditional",
          "similarity": 0.87
        },
        {
          "text": "setting outdoor seating",
          "category": "setting",
          "concept": "outdoor seating",
          "similarity": 0.85
        }
      ],
      "avg_similarity": 0.88,
      "max_similarity": 0.92,
      "match_count": 3
    }
  ],
  "query": "casual japanese food with outdoor seating",
  "query_embedding_time": 0.15,
  "search_time": 0.42,
  "total_results": 1
}
```

#### Campos do Response

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `results` | array | Lista de resultados ranqueados |
| `results[].entity_id` | string | ID da entity |
| `results[].entity` | object | Dados da entity (se include_entity=true) |
| `results[].curation` | object | Dados da curation |
| `results[].matches` | array | Top 10 conceitos mais similares |
| `results[].avg_similarity` | float | Média de similaridade dos matches |
| `results[].max_similarity` | float | Melhor similaridade encontrada |
| `results[].match_count` | int | Total de matches acima do threshold |
| `query` | string | Query original |
| `query_embedding_time` | float | Tempo para gerar embedding (segundos) |
| `search_time` | float | Tempo de busca e processamento (segundos) |
| `total_results` | int | Quantidade de resultados retornados |

---

## Entendendo Similaridade Cosine

### O que é?

**Similaridade Cosine** mede o ângulo entre dois vetores em espaço multidimensional (1536 dimensões no nosso caso).

- **1.0**: Vetores idênticos (mesma direção)
- **0.0**: Vetores perpendiculares (sem relação)
- **-1.0**: Vetores opostos

### Fórmula

```
similarity = (A · B) / (||A|| × ||B||)

Onde:
- A · B = produto escalar (dot product)
- ||A|| = norma (magnitude) do vetor A
- ||B|| = norma (magnitude) do vetor B
```

### Interpretação dos Scores

| Score | Significado | Exemplo |
|-------|-------------|---------|
| 0.9 - 1.0 | Praticamente idêntico | "japanese food" → "cuisine japanese" |
| 0.8 - 0.9 | Muito similar | "casual dining" → "food_style casual" |
| 0.7 - 0.8 | Similar | "outdoor seating" → "setting outdoor" |
| 0.6 - 0.7 | Moderadamente similar | "wine bar" → "drinks wine list" |
| 0.5 - 0.6 | Pouco similar | "romantic" → "mood intimate" |
| < 0.5 | Não relacionado | "japanese" → "italian" |

### Exemplo Prático

```python
import numpy as np

# Vetores exemplo (simplificados)
query_vec = [0.8, 0.6, 0.2]      # "japanese food"
concept_vec_1 = [0.9, 0.5, 0.1]  # "cuisine japanese"
concept_vec_2 = [0.1, 0.8, 0.9]  # "italian cuisine"

# Cálculo de similaridade
def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

sim1 = cosine_similarity(query_vec, concept_vec_1)  # 0.95 (muito similar)
sim2 = cosine_similarity(query_vec, concept_vec_2)  # 0.42 (não relacionado)
```

---

## Exemplos de Uso

### 1. Busca Simples

**Query:** "japanese food"

```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/curations/semantic-search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "japanese food",
    "limit": 5
  }'
```

**Resultados Esperados:**
- Restaurantes com `cuisine: japanese`
- Restaurantes com `menu: sushi, sashimi, tempura`
- Score alto para matches diretos

### 2. Busca Composta

**Query:** "romantic italian restaurant with wine"

```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/curations/semantic-search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "romantic italian restaurant with wine",
    "limit": 10,
    "min_similarity": 0.7
  }'
```

**Resultados Esperados:**
- Restaurantes com `cuisine: italian`
- Restaurantes com `mood: romantic, intimate`
- Restaurantes com `drinks: wine, wine list`
- Múltiplos matches aumentam o score

### 3. Busca com Filtros

**Query:** "outdoor seating casual" + apenas restaurantes + apenas setting e food_style

```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/curations/semantic-search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "outdoor seating casual",
    "entity_types": ["restaurant"],
    "categories": ["setting", "food_style"],
    "min_similarity": 0.75,
    "limit": 5
  }'
```

**Resultados Esperados:**
- Apenas `setting` e `food_style` são considerados
- Ignora `cuisine`, `menu`, etc.
- Busca mais focada e rápida

### 4. Busca Sem Entity Data

**Query:** Apenas curation data (mais rápido)

```bash
curl -X POST https://concierge-collector.onrender.com/api/v3/curations/semantic-search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "business lunch",
    "include_entity": false,
    "limit": 20
  }'
```

**Vantagem:** Response menor e mais rápido (não busca entities no MongoDB)

---

## Performance

### Tempos Típicos

| Operação | Tempo | Descrição |
|----------|-------|-----------|
| Embedding Generation | 100-200ms | OpenAI API call |
| MongoDB Query | 50-100ms | Fetch curations com embeddings |
| Similarity Calculation | 200-400ms | Para 55 curations × ~70 embeddings |
| Entity Lookup | 50-150ms | Se include_entity=true |
| **Total** | **~500ms** | Tempo total de resposta |

### Otimizações Implementadas

1. **Filtros Antecipados**: entity_types e categories reduzem dados processados
2. **Threshold Early Exit**: min_similarity evita cálculos desnecessários
3. **Top 10 Matches**: Limita response size
4. **NumPy Vectorização**: Cálculos otimizados para arrays

### Limitações Atuais

1. **Scan Completo**: Calcula similaridade para todas as curations (sem índice vetorial)
2. **In-Memory Processing**: Todos os embeddings carregados na memória
3. **Sync OpenAI**: Blocking call para gerar embedding da query

### Melhorias Futuras

1. **MongoDB Atlas Vector Search**: Índice nativo para busca vetorial (10-100x mais rápido)
2. **Caching**: Redis para queries comuns
3. **Batch Embeddings**: Processar múltiplas queries em paralelo
4. **Async Processing**: Non-blocking OpenAI calls

---

## Casos de Uso

### 1. Busca Natural do Usuário

**Cenário:** Usuário digita "quero comer comida japonesa num lugar descontraído"

```json
{
  "query": "comida japonesa lugar descontraído",
  "min_similarity": 0.7
}
```

**Benefício:** Sistema entende contexto mesmo com linguagem informal

### 2. Recomendações Contextuais

**Cenário:** Sistema recomenda restaurantes baseado em preferências

```json
{
  "query": "romantic dinner fine dining wine",
  "limit": 5,
  "min_similarity": 0.8
}
```

**Benefício:** Alta precisão para recomendações específicas

### 3. Descoberta de Conceitos Relacionados

**Cenário:** "Mostre restaurantes similares a este"

```python
# Pegar conceitos de um restaurante existente
concepts = ["casual", "japanese", "sushi", "outdoor seating"]
query = " ".join(concepts)

# Buscar similares
response = search(query=query, min_similarity=0.75)
```

**Benefício:** Encontra restaurantes com perfil similar

### 4. Filtros Avançados

**Cenário:** "Restaurantes italianos românticos com vinho"

```json
{
  "query": "romantic atmosphere wine selection",
  "entity_types": ["restaurant"],
  "categories": ["mood", "drinks"],
  "min_similarity": 0.7
}
```

**Benefício:** Busca focada em aspectos específicos

---

## Troubleshooting

### Problema: Nenhum resultado

**Causa:** min_similarity muito alto ou query muito específica

**Solução:**
```json
{
  "query": "sua query",
  "min_similarity": 0.3,  // Reduzir threshold
  "limit": 20             // Aumentar limite
}
```

### Problema: Resultados irrelevantes

**Causa:** min_similarity muito baixo

**Solução:**
```json
{
  "query": "sua query",
  "min_similarity": 0.75,  // Aumentar threshold
  "categories": ["cuisine", "food_style"]  // Focar em categorias relevantes
}
```

### Problema: Response muito lento

**Causa:** Muitas curations ou include_entity=true

**Solução:**
```json
{
  "query": "sua query",
  "include_entity": false,  // Não buscar entities
  "entity_types": ["restaurant"],  // Filtrar por tipo
  "limit": 5  // Reduzir quantidade
}
```

### Problema: Erro "OpenAI API key not configured"

**Causa:** OPENAI_API_KEY não configurada no .env

**Solução:**
```bash
# No arquivo .env
OPENAI_API_KEY=sk-proj-...
```

---

## Comparação: Busca Tradicional vs Semântica

### Busca Tradicional (Texto)

```
Query: "japanese"
Encontra: Apenas restaurantes com palavra "japanese" no nome ou descrição
Limitação: Não encontra "asian", "sushi", "sashimi"
```

### Busca Semântica (Embeddings)

```
Query: "japanese food"
Encontra:
- cuisine: japanese (0.95)
- cuisine: asian (0.82)
- menu: sushi (0.88)
- menu: sashimi (0.86)
- menu: ramen (0.84)
Vantagem: Entende conceitos relacionados
```

### Exemplo Comparativo

| Query | Busca Texto | Busca Semântica |
|-------|-------------|-----------------|
| "japanese" | Kosushi | Kosushi, Huto Izakaya, Asian restaurants |
| "casual dining" | (nenhum) | Restaurants com food_style: casual |
| "romantic dinner" | (nenhum) | Restaurants com mood: romantic, intimate |
| "wine bar" | (nenhum) | Restaurants com drinks: wine, wine list |

---

## Integração Frontend

### JavaScript Example

```javascript
async function semanticSearch(query, options = {}) {
  const response = await fetch(
    'https://concierge-collector.onrender.com/api/v3/curations/semantic-search',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query,
        limit: options.limit || 10,
        min_similarity: options.minSimilarity || 0.7,
        entity_types: options.entityTypes || ['restaurant'],
        include_entity: options.includeEntity !== false
      })
    }
  );
  
  return await response.json();
}

// Uso
const results = await semanticSearch('casual japanese food', {
  limit: 5,
  minSimilarity: 0.75
});

console.log(`Found ${results.total_results} restaurants`);
results.results.forEach(result => {
  console.log(`${result.entity.name}: ${result.max_similarity.toFixed(2)}`);
  console.log('Top matches:');
  result.matches.slice(0, 3).forEach(match => {
    console.log(`  - ${match.concept} (${match.similarity.toFixed(2)})`);
  });
});
```

### React Hook Example

```javascript
import { useState } from 'react';

function useSemanticSearch() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const search = async (query, options = {}) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(
        'https://concierge-collector.onrender.com/api/v3/curations/semantic-search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            limit: options.limit || 10,
            min_similarity: options.minSimilarity || 0.7
          })
        }
      );
      
      const data = await response.json();
      setResults(data.results);
      return data;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };
  
  return { results, loading, error, search };
}

// Uso no componente
function RestaurantSearch() {
  const { results, loading, search } = useSemanticSearch();
  const [query, setQuery] = useState('');
  
  const handleSearch = () => {
    search(query, { minSimilarity: 0.7 });
  };
  
  return (
    <div>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <button onClick={handleSearch} disabled={loading}>
        {loading ? 'Searching...' : 'Search'}
      </button>
      
      {results.map(result => (
        <div key={result.entity_id}>
          <h3>{result.entity.name}</h3>
          <p>Similarity: {result.max_similarity.toFixed(2)}</p>
          <ul>
            {result.matches.slice(0, 3).map(match => (
              <li key={match.text}>{match.concept}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

---

## Conclusão

O endpoint de busca semântica permite:

✅ **Busca Natural**: Usuários podem digitar linguagem natural  
✅ **Entendimento Contextual**: Sistema entende significado, não apenas palavras  
✅ **Ranking Inteligente**: Resultados ordenados por relevância real  
✅ **Flexibilidade**: Múltiplos filtros e opções de customização  
✅ **Performance**: Resposta em ~500ms para queries típicas  
✅ **Escalabilidade**: Suporta centenas de curations eficientemente  

**Próximos passos:**
- Implementar cache para queries comuns
- Adicionar MongoDB Atlas Vector Search para performance 10-100x melhor
- Implementar feedback learning baseado em clicks
- Adicionar analytics de queries para melhorar resultados
