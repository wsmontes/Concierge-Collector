# Concierge API V3 - Quick Reference

> **Status:** Ativo (Parcial) — saneamento crítico de URLs executado em 2026-02-18.

**Production**: `https://concierge-collector.onrender.com/api/v3`  
**Local**: `http://localhost:8000/api/v3`

## 🔗 Quick Links
- [Full Docs](./API_DOCUMENTATION_V3.md) | [Interactive](https://concierge-collector.onrender.com/api/v3/docs) | [Health](https://concierge-collector.onrender.com/api/v3/health)

## 🔑 Authentication

**Dual Auth:** OAuth JWT or API Key accepted
```http
Authorization: Bearer <jwt_token>  # Web users
X-API-Key: <api_secret_key>        # Bots/scripts
```

## Endpoints Summary

### System
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | ❌ | Health check |
| GET | `/info` | ❌ | API information |

### Entities
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/entities` | ✅ | Create entity |
| GET | `/entities/{id}` | ❌ | Get entity |
| PATCH | `/entities/{id}` | ✅ | Update entity (requires `If-Match` with current version) |
| DELETE | `/entities/{id}` | ✅ | Delete entity |
| GET | `/entities?type=X&name=Y` | ❌ | Search entities |

### Curations
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/curations` | ✅ | Create curation |
| GET | `/curations/{id}` | ❌ | Get curation |
| PATCH | `/curations/{id}` | ✅ | Update curation (requires `If-Match` with current version) |
| DELETE | `/curations/{id}` | ✅ | Delete curation |
| GET | `/entities/{id}/curations` | ❌ | Get entity curations |
| GET | `/curations/search?...` | ❌ | Search curations |
| POST | `/curations/semantic-search` | ❌ | Semantic search by embeddings |
| POST | `/curations/hybrid-search` | ❌ | Hybrid search (entity + semantic) |

### Places (Google Places API Proxy)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/places/nearby` | ❌ | Search nearby places |
| GET | `/places/details/{place_id}` | ❌ | Get place details |
| POST | `/places/orchestrate` | ❌ | Places orchestration workflow |
| GET | `/places/{place_id}/photos` | ❌ | Get place photos |
| GET | `/places/health` | ❌ | Places API health check |

### Concepts (Dynamic Categories)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/concepts/{entity_type}` | ❌ | Get categories for entity type |
| GET | `/concepts/` | ❌ | List all concept configurations |

### AI Services 🤖
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/ai/orchestrate` | ✅ | Intelligent AI workflow (all-in-one) |
| POST | `/ai/extract-restaurant-name` | ✅ | Extract restaurant name from text |
| GET | `/ai/usage-stats` | ❌ | AI usage statistics |
| GET | `/ai/health` | ❌ | AI services health check |

> **Note:** AI services use a single `/orchestrate` endpoint with different `workflow_type` values:
> - `audio_only` - Transcribe audio + extract concepts
> - `image_only` - Analyze image
> - `auto` - Smart detection based on inputs
> - `place_id_with_audio` - Full workflow: Place → Entity + Curation

### Advanced
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| n/a | `/query` | n/a | Endpoint not active in current API |

## Common Headers
```
Content-Type: application/json
If-Match: "<current_version>"  // Required for PATCH updates
Authorization: Bearer <jwt_token> or X-API-Key: <api_secret_key>
```

## 📍 Places API Examples

### Search Nearby Places
```bash
GET /places/nearby?latitude=37.7749&longitude=-122.4194&radius=1000&type=restaurant
```

### Get Place Details
```bash
GET /places/details/ChIJ... 
```

## 🤖 AI Services Examples

### Orchestrate (Smart Workflow)
```bash
POST /ai/orchestrate
Authorization: Bearer <jwt_token>
# or: X-API-Key: your-key

{
  "audio_file": "base64_encoded_audio...",
  "entity_type": "restaurant",
  "workflow_type": "auto"
}
```

**Response:**
```json
{
  "workflow": "audio_to_entity",
  "results": {
    "transcription": "...",
    "concepts": [...],
    "entity_created": true
  },
  "saved_to_db": true,
  "processing_time_ms": 2500
}
```

### Extract Restaurant Name
```bash
POST /ai/extract-restaurant-name
Authorization: Bearer <jwt_token>
# or: X-API-Key: your-key

{
  "text": "Jantei ontem no A Casa do Porco e foi excelente"
}
```

## 📦 Entity Example
```json
{
  "entity_id": "restaurant_123",
  "type": "restaurant",
  "name": "Example Restaurant",
  "metadata": {
    "cuisine": ["Italian"],
    "rating": 4.5,
    "location": "San Francisco"
  }
}
```

## Curation Example
```json
{
  "curation_id": "review_456",
  "entity_id": "restaurant_123",
  "curator": {
    "id": "user_789",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "category": "dining",
  "concept": "family_dinner",
  "items": [
    {
      "name": "Pizza Margherita",
      "rating": 5,
      "price": 18.50,
      "description": "Classic and delicious"
    }
  ],
  "notes": {
    "general": "Great atmosphere",
    "recommendations": "Try the pizza"
  }
}
```

## Error Response
```json
{
  "error": "Validation error",
  "message": "Missing required field",
  "details": {...}
}
```

## Status Codes
- `200` - Success (GET/PATCH)
- `201` - Created (POST)
- `204` - No Content (DELETE)
- `400` - Bad Request
- `404` - Not Found
- `409` - Conflict (version mismatch)
- `500` - Server Error

## JavaScript Quick Start
```javascript
const API_BASE = 'https://concierge-collector.onrender.com/api/v3';

// Create entity
const response = await fetch(`${API_BASE}/entities`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    entity_id: 'my_restaurant',
    type: 'restaurant',
    name: 'My Restaurant',
    metadata: { cuisine: ['Italian'], rating: 4.5 }
  })
});

const entity = await response.json();
const currentVersion = entity.version;

// Update entity (requires current version)
await fetch(`${API_BASE}/entities/my_restaurant`, {
  method: 'PATCH',
  headers: { 
    'Content-Type': 'application/json',
    'If-Match': String(currentVersion)
  },
  body: JSON.stringify({
    metadata: { rating: 4.7, updated: true }
  })
});
```

## Python Quick Start
```python
import requests

API_BASE = 'https://concierge-collector.onrender.com/api/v3'

# Create entity
response = requests.post(f'{API_BASE}/entities', json={
    'entity_id': 'my_restaurant',
    'type': 'restaurant', 
    'name': 'My Restaurant',
    'metadata': {'cuisine': ['Italian'], 'rating': 4.5}
})

entity = response.json()
current_version = entity.get('version')

# Update entity
requests.patch(f'{API_BASE}/entities/my_restaurant', 
  headers={'If-Match': str(current_version)},
    json={'metadata': {'rating': 4.7, 'updated': True}}
)
```