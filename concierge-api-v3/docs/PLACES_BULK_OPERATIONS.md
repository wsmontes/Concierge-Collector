# Places API - Bulk & Multi-Operation Support

## Overview

O endpoint de orquestração do Places API agora suporta:
- ✅ **Bulk Details**: Buscar dados detalhados de múltiplos place_ids em paralelo
- ✅ **Multi-Operation**: Combinar diferentes tipos de operações em uma única requisição
- ✅ **Error Tracking**: Rastreamento de erros individuais em operações bulk
- ✅ **Parallel Execution**: Execução paralela para melhor performance

## 1. Bulk Details Lookup

Busca detalhes de múltiplos lugares simultaneamente usando uma lista de place_ids.

### Request Format

```json
{
  "place_ids": [
    "ChIJfadx80xYzpQRyHnuTnmQmDA",
    "ChIJ6dsCCsZZzpQRROIslvwquqs",
    "ChIJXVTQ8tRZzpQR9oNAdi-b1W8"
  ],
  "language": "pt",
  "region_code": "BR"
}
```

### Response Format

```json
{
  "operation": "bulk",
  "results": [
    {
      "id": "ChIJfadx80xYzpQRyHnuTnmQmDA",
      "displayName": {"text": "Famiglia Mancini", "languageCode": "pt"},
      "formattedAddress": "Rua Avanhandava, 81...",
      "location": {"latitude": -23.550347, "longitude": -46.6450502},
      "rating": 4.7,
      "nationalPhoneNumber": "(11) 3256-4320",
      "websiteUri": "http://www.famigliamancini.com.br/",
      "regularOpeningHours": {...}
    },
    // ... more results
  ],
  "total_results": 3,
  "operations_executed": ["details", "details", "details"],
  "errors": null
}
```

### Use Cases

1. **Import Scripts**: Buscar dados completos do Google para múltiplas entidades
2. **Entity Enrichment**: Atualizar informações de vários lugares de uma vez
3. **Curation Management**: Obter detalhes de todos os lugares em uma curação

### Example: Python Script

```python
import requests

def get_bulk_details(place_ids: list[str]) -> dict:
    """Get details for multiple places in one request"""
    response = requests.post(
        "http://localhost:8000/api/v3/places/orchestrate",
        json={"place_ids": place_ids}
    )
    
    data = response.json()
    
    print(f"Operation: {data['operation']}")
    print(f"Total results: {data['total_results']}")
    
    if data.get('errors'):
        print(f"Errors: {len(data['errors'])}")
        for error in data['errors']:
            print(f"  - {error['place_id']}: {error['error']}")
    
    return data

# Example usage
place_ids = [
    "ChIJfadx80xYzpQRyHnuTnmQmDA",
    "ChIJ6dsCCsZZzpQRROIslvwquqs",
    "ChIJXVTQ8tRZzpQR9oNAdi-b1W8"
]

results = get_bulk_details(place_ids)
```

### Performance

- **Parallel Execution**: Todas as requisições são feitas em paralelo
- **Timeout**: 30 segundos por requisição individual
- **Error Handling**: Falhas individuais não afetam as outras requisições
- **Recommended Batch Size**: 10-50 place_ids por requisição

---

## 2. Multi-Operation Requests

Combina diferentes tipos de operações (nearby, text_search, details) em uma única requisição.

### Request Format

```json
{
  "operations": [
    {
      "query": "pizza restaurant",
      "latitude": -23.561684,
      "longitude": -46.655981,
      "max_results": 2
    },
    {
      "query": "sushi restaurant",
      "latitude": -23.561684,
      "longitude": -46.655981,
      "max_results": 2
    },
    {
      "place_id": "ChIJ6dsCCsZZzpQRROIslvwquqs"
    }
  ],
  "language": "pt",
  "combine_results": true
}
```

### Response Format

```json
{
  "operation": "bulk",
  "results": [
    // Pizza restaurants (2)
    {"id": "ChIJ...", "displayName": {"text": "Pizzaria..."}, ...},
    {"id": "ChIJ...", "displayName": {"text": "Pizza..."}, ...},
    // Sushi restaurants (2)
    {"id": "ChIJ...", "displayName": {"text": "Sushi..."}, ...},
    {"id": "ChIJ...", "displayName": {"text": "Kome..."}, ...},
    // Details lookup (1)
    {"id": "ChIJ6dsCCsZZzpQRROIslvwquqs", ...}
  ],
  "total_results": 5,
  "operations_executed": ["text_search", "text_search", "details"],
  "errors": null
}
```

### Use Cases

1. **Search Aggregation**: Buscar múltiplos tipos de lugares em uma área
2. **Comparison Queries**: Comparar diferentes categorias (ex: "pizza vs burger")
3. **Mixed Operations**: Combinar buscas com lookups de detalhes específicos
4. **Batch Processing**: Processar múltiplas operações de uma vez

### Example: Aggregate Search

```python
def aggregate_search(location: tuple[float, float], queries: list[str]) -> dict:
    """Search for multiple types of places at one location"""
    operations = []
    
    for query in queries:
        operations.append({
            "query": query,
            "latitude": location[0],
            "longitude": location[1],
            "max_results": 3
        })
    
    response = requests.post(
        "http://localhost:8000/api/v3/places/orchestrate",
        json={"operations": operations}
    )
    
    return response.json()

# Example: Find different cuisine types
location = (-23.561684, -46.655981)
cuisines = ["italian restaurant", "japanese restaurant", "brazilian restaurant"]

results = aggregate_search(location, cuisines)
print(f"Found {results['total_results']} places across {len(cuisines)} cuisines")
```

### Example: Mixed Operations

```python
def search_and_enrich(search_query: str, known_place_ids: list[str]) -> dict:
    """Combine search with details lookup"""
    operations = [
        # Search for new places
        {
            "query": search_query,
            "latitude": -23.561684,
            "longitude": -46.655981,
            "max_results": 5
        }
    ]
    
    # Add details lookup for known places
    for place_id in known_place_ids:
        operations.append({"place_id": place_id})
    
    response = requests.post(
        "http://localhost:8000/api/v3/places/orchestrate",
        json={"operations": operations}
    )
    
    return response.json()

# Example usage
results = search_and_enrich(
    "michelin star restaurant",
    ["ChIJfadx80xYzpQRyHnuTnmQmDA", "ChIJ6dsCCsZZzpQRROIslvwquqs"]
)
```

---

## 3. Error Handling

Operações bulk incluem tracking detalhado de erros.

### Error Response Example

```json
{
  "operation": "bulk",
  "results": [
    {"id": "ChIJ...", "displayName": {...}},
    {"id": "ChIJ...", "displayName": {...}}
  ],
  "total_results": 2,
  "operations_executed": ["details", "details", "details"],
  "errors": [
    {
      "place_id": "INVALID_PLACE_ID",
      "status_code": 404,
      "error": "Place not found"
    }
  ]
}
```

### Error Types

1. **404 Not Found**: Place ID não existe ou foi removido
2. **400 Bad Request**: Place ID inválido ou parâmetros incorretos
3. **Network Errors**: Timeout ou falha de conexão
4. **API Quota**: Limite de requisições atingido

### Handling Errors in Code

```python
def safe_bulk_lookup(place_ids: list[str]) -> tuple[list, list]:
    """Bulk lookup with error separation"""
    response = requests.post(
        "http://localhost:8000/api/v3/places/orchestrate",
        json={"place_ids": place_ids}
    )
    
    data = response.json()
    
    successful = data['results']
    failed = data.get('errors', [])
    
    # Log failures
    for error in failed:
        print(f"❌ Failed to fetch {error['place_id']}: {error['error']}")
    
    # Return both successful and failed
    return successful, failed

# Example usage
results, errors = safe_bulk_lookup(place_ids)
print(f"✅ Success: {len(results)}")
print(f"❌ Errors: {len(errors)}")
```

---

## 4. Parameter Combinations

Operações bulk podem compartilhar parâmetros base.

### Shared Parameters

```json
{
  "operations": [
    {"query": "pizza"},
    {"query": "sushi"},
    {"query": "burger"}
  ],
  "latitude": -23.561684,
  "longitude": -46.655981,
  "radius": 1000,
  "language": "pt",
  "max_results": 5,
  "min_rating": 4.0
}
```

Todos os parâmetros no nível raiz são aplicados a todas as operações, a menos que sobrescritos individualmente.

### Override Parameters

```json
{
  "operations": [
    {
      "query": "luxury restaurant",
      "max_results": 10,        // Override: 10 results for this
      "min_rating": 4.5          // Override: higher rating
    },
    {
      "query": "casual dining",
      "max_results": 20,         // Override: more results
      "min_rating": 3.0          // Override: lower rating
    }
  ],
  "latitude": -23.561684,      // Shared: applies to all
  "longitude": -46.655981,      // Shared: applies to all
  "language": "pt",             // Shared: applies to all
  "max_results": 5,             // Default for operations without override
  "min_rating": 4.0             // Default for operations without override
}
```

---

## 5. Performance Best Practices

### Batch Sizes

| Operation Type | Recommended Batch Size | Max Recommended |
|---------------|------------------------|-----------------|
| Bulk Details  | 10-20 place_ids        | 50              |
| Multi-Op (Text Search) | 3-5 operations | 10              |
| Multi-Op (Nearby) | 5-10 operations   | 20              |
| Mixed Operations | 5-10 total ops     | 15              |

### Parallel Execution

- Bulk details são executados **em paralelo**
- Multi-operations são executados **em sequência** (para evitar rate limits)
- Use batch processing para grandes volumes:

```python
def process_in_batches(place_ids: list[str], batch_size: int = 20):
    """Process large lists in batches"""
    results = []
    errors = []
    
    for i in range(0, len(place_ids), batch_size):
        batch = place_ids[i:i + batch_size]
        
        response = requests.post(
            "http://localhost:8000/api/v3/places/orchestrate",
            json={"place_ids": batch}
        )
        
        data = response.json()
        results.extend(data['results'])
        
        if data.get('errors'):
            errors.extend(data['errors'])
    
    return results, errors
```

### Rate Limiting

- Google Places API tem limites de QPS (Queries Per Second)
- Recomendação: Max 50 requisições por segundo
- Use delays entre batches para grandes volumes:

```python
import time

def process_with_rate_limit(place_ids: list[str], qps: int = 10):
    """Process with rate limiting"""
    batch_size = 20
    delay = batch_size / qps  # Calculate delay between batches
    
    results = []
    
    for i in range(0, len(place_ids), batch_size):
        batch = place_ids[i:i + batch_size]
        
        response = requests.post(
            "http://localhost:8000/api/v3/places/orchestrate",
            json={"place_ids": batch}
        )
        
        results.extend(response.json()['results'])
        
        if i + batch_size < len(place_ids):
            time.sleep(delay)
    
    return results
```

---

## 6. Integration Examples

### Example 1: Michelin Import Script

```python
def import_michelin_with_google_data(csv_file: str):
    """Import Michelin data and enrich with Google Places"""
    # Read Michelin CSV
    restaurants = read_michelin_csv(csv_file)
    
    # Batch process Google searches
    batch_size = 10
    
    for i in range(0, len(restaurants), batch_size):
        batch = restaurants[i:i + batch_size]
        
        # Create operations for each restaurant
        operations = []
        for restaurant in batch:
            operations.append({
                "query": f"{restaurant['name']} {restaurant['city']}",
                "latitude": restaurant['lat'],
                "longitude": restaurant['lng'],
                "max_results": 1
            })
        
        # Execute bulk search
        response = requests.post(
            "http://localhost:8000/api/v3/places/orchestrate",
            json={"operations": operations}
        )
        
        data = response.json()
        
        # Match results to restaurants
        for j, place in enumerate(data['results']):
            if j < len(batch):
                batch[j]['google_place_id'] = place['id']
                batch[j]['google_data'] = place
        
        # Save to MongoDB
        save_entities_to_mongo(batch)
```

### Example 2: Entity ID Standardization

```python
def standardize_entity_ids():
    """Update all entities to use Google Place IDs"""
    # Get all entities without proper Google Place ID
    entities = db.entities.find({
        "entity_id": {"$not": {"$regex": "^entity_ChIJ"}}
    })
    
    # Batch process in groups
    batch_size = 20
    entity_list = list(entities)
    
    for i in range(0, len(entity_list), batch_size):
        batch = entity_list[i:i + batch_size]
        
        # Create search operations
        operations = []
        for entity in batch:
            operations.append({
                "query": entity['name'],
                "latitude": entity['coordinates'][1],
                "longitude": entity['coordinates'][0],
                "max_results": 1
            })
        
        # Execute bulk search
        response = requests.post(
            "http://localhost:8000/api/v3/places/orchestrate",
            json={"operations": operations}
        )
        
        data = response.json()
        
        # Update entity IDs
        updates = []
        for j, place in enumerate(data['results']):
            if j < len(batch):
                entity_id = f"entity_{place['id']}"
                updates.append({
                    "filter": {"_id": batch[j]['_id']},
                    "update": {"$set": {"entity_id": entity_id}}
                })
        
        # Bulk update MongoDB
        for update in updates:
            db.entities.update_one(update['filter'], update['update'])
```

### Example 3: Curation Enrichment

```python
def enrich_curation(curation_id: str):
    """Enrich all places in a curation with fresh Google data"""
    # Get curation
    curation = db.curations.find_one({"curation_id": curation_id})
    place_ids = [item['place_id'] for item in curation['items']]
    
    # Bulk fetch details
    response = requests.post(
        "http://localhost:8000/api/v3/places/orchestrate",
        json={"place_ids": place_ids}
    )
    
    data = response.json()
    
    # Update curation items with fresh data
    place_data = {place['id']: place for place in data['results']}
    
    for item in curation['items']:
        place_id = item['place_id']
        if place_id in place_data:
            item['name'] = place_data[place_id]['displayName']['text']
            item['rating'] = place_data[place_id].get('rating')
            item['address'] = place_data[place_id].get('formattedAddress')
            item['phone'] = place_data[place_id].get('nationalPhoneNumber')
            item['website'] = place_data[place_id].get('websiteUri')
    
    # Save updated curation
    db.curations.update_one(
        {"curation_id": curation_id},
        {"$set": {"items": curation['items'], "updated_at": datetime.utcnow()}}
    )
```

---

## 7. Testing

### Test Bulk Details

```bash
curl -X POST http://localhost:8000/api/v3/places/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_ids": [
      "ChIJfadx80xYzpQRyHnuTnmQmDA",
      "ChIJ6dsCCsZZzpQRROIslvwquqs"
    ]
  }'
```

### Test Multi-Operation

```bash
curl -X POST http://localhost:8000/api/v3/places/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [
      {"query": "pizza", "max_results": 2},
      {"query": "sushi", "max_results": 2}
    ],
    "latitude": -23.561684,
    "longitude": -46.655981
  }'
```

### Test Error Handling

```bash
curl -X POST http://localhost:8000/api/v3/places/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "place_ids": [
      "ChIJfadx80xYzpQRyHnuTnmQmDA",
      "INVALID_PLACE_ID",
      "ChIJ6dsCCsZZzpQRROIslvwquqs"
    ]
  }'
```

---

## Summary

O endpoint de orquestração agora suporta:

✅ **Bulk Details**: Múltiplos place_ids em paralelo  
✅ **Multi-Operation**: Combinar diferentes tipos de busca  
✅ **Error Tracking**: Rastreamento de falhas individuais  
✅ **Shared Parameters**: Parâmetros base aplicados a todas operações  
✅ **Override Support**: Sobrescrever parâmetros por operação  
✅ **Performance**: Execução paralela e otimizada  

**Endpoint:** `POST /api/v3/places/orchestrate`  
**Documentation:** `/api/v3/docs`
