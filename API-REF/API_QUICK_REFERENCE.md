# Concierge API V3 - Quick Reference

**Base URL**: `https://wsmontes.pythonanywhere.com/api/v3`  
**Local Dev**: `http://localhost:8000/api/v3`

## Quick Links
- [Full Documentation](./API_DOCUMENTATION_V3.md)
- [Interactive Docs](https://wsmontes.pythonanywhere.com/api/v3/docs) 🔗 Swagger UI
- [ReDoc](https://wsmontes.pythonanywhere.com/api/v3/redoc) 📚 Alternative docs
- [Health Check](https://wsmontes.pythonanywhere.com/api/v3/health)

## 🔑 Authentication

Most endpoints are public. AI endpoints require API key:
```
X-API-Key: your-api-key-here
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
| POST | `/entities` | ❌ | Create entity |
| GET | `/entities/{id}` | ❌ | Get entity |
| PATCH | `/entities/{id}` | ❌ | Update entity (requires ETag) |
| DELETE | `/entities/{id}` | ❌ | Delete entity |
| GET | `/entities?type=X&name=Y` | ❌ | Search entities |

### Curations
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/curations` | ❌ | Create curation |
| GET | `/curations/{id}` | ❌ | Get curation |
| PATCH | `/curations/{id}` | ❌ | Update curation (requires ETag) |
| DELETE | `/curations/{id}` | ❌ | Delete curation |
| GET | `/entities/{id}/curations` | ❌ | Get entity curations |
| GET | `/curations/search?category=X` | ❌ | Search curations |

### Places (Google Places API Proxy)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/places/nearby` | ❌ | Search nearby places |
| GET | `/places/details/{place_id}` | ❌ | Get place details |
| GET | `/places/autocomplete` | ❌ | Place autocomplete |
| GET | `/places/photo/{photo_reference}` | ❌ | Get place photo |

### AI Services 🤖
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/ai/orchestrate` | ✅ | Intelligent AI workflow |
| POST | `/ai/transcribe` | ✅ | Audio transcription |
| POST | `/ai/extract-concepts` | ✅ | Extract concepts from text |
| POST | `/ai/analyze-image` | ✅ | Vision analysis |

### Advanced
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/query` | ❌ | Flexible query DSL |

## Common Headers
```
Content-Type: application/json
If-Match: "etag-value"  // Required for updates
X-API-Key: your-key     // Required for AI endpoints
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
X-API-Key: your-key

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

### Transcribe Audio
```bash
POST /ai/transcribe
X-API-Key: your-key

{
  "audio_file": "base64_encoded_audio...",
  "language": "pt-BR"
}
```

### Extract Concepts
```bash
POST /ai/extract-concepts
X-API-Key: your-key

{
  "text": "Had amazing pasta at Mario's Italian Restaurant...",
  "entity_type": "restaurant"
}
```

### Analyze Image
```bash
POST /ai/analyze-image
X-API-Key: your-key

{
  "image_file": "base64_encoded_image...",
  "prompt": "Describe this restaurant menu"
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
- `409` - Conflict (ETag mismatch)
- `500` - Server Error

## JavaScript Quick Start
```javascript
const API_BASE = 'https://wsmontes.pythonanywhere.com/api/v3';

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
const etag = response.headers.get('ETag');

// Update entity (requires ETag)
await fetch(`${API_BASE}/entities/my_restaurant`, {
  method: 'PATCH',
  headers: { 
    'Content-Type': 'application/json',
    'If-Match': etag 
  },
  body: JSON.stringify({
    metadata: { rating: 4.7, updated: true }
  })
});
```

## Python Quick Start
```python
import requests

API_BASE = 'https://wsmontes.pythonanywhere.com/api/v3'

# Create entity
response = requests.post(f'{API_BASE}/entities', json={
    'entity_id': 'my_restaurant',
    'type': 'restaurant', 
    'name': 'My Restaurant',
    'metadata': {'cuisine': ['Italian'], 'rating': 4.5}
})

entity = response.json()
etag = response.headers.get('ETag')

# Update entity
requests.patch(f'{API_BASE}/entities/my_restaurant', 
    headers={'If-Match': etag},
    json={'metadata': {'rating': 4.7, 'updated': True}}
)
```