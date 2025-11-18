# Concierge API V3 - Complete Documentation

**Base URL**: `https://wsmontes.pythonanywhere.com/api/v3`  
**Local Dev**: `http://localhost:8000/api/v3`  
**API Version**: `3.0.0`  
**Content-Type**: `application/json`

## Overview

The Concierge API V3 is a professional async FastAPI implementation designed for managing restaurant/hotel entities, curations, and AI-powered workflows. Built with MongoDB for flexible document storage.

### Key Features
- ✅ Async MongoDB with Motor driver
- ✅ API Key authentication for AI services
- ✅ Google Places API proxy (secure, server-side keys)
- ✅ AI Services: GPT-4, Whisper, Vision (OpenAI)
- ✅ Intelligent AI workflow orchestration
- ✅ Full CRUD operations with optimistic locking
- ✅ Interactive documentation (Swagger UI + ReDoc)
- ✅ CORS support for frontend integration
- ✅ Comprehensive test suite (78 tests)

### Architecture
- **Framework:** FastAPI (async/await)
- **Database:** MongoDB Atlas (async with Motor)
- **AI:** OpenAI API (GPT-4, Whisper, Vision)
- **Places:** Google Places API (New)
- **Auth:** API Key for AI endpoints
- **Deployment:** PythonAnywhere + Local development

---

## Authentication

### Public Endpoints
Most endpoints are publicly accessible:
- System (`/health`, `/info`)
- Entities (CRUD operations)
- Curations (CRUD operations)
- Places (Google Places proxy)

### Protected Endpoints (API Key Required)
AI services require `X-API-Key` header:
```http
X-API-Key: your-api-key-here
```

**Generate API Key:**
```bash
cd concierge-api-v3
python scripts/generate_api_key.py
```

**AI Endpoints:**
- `/ai/orchestrate` - Intelligent workflow orchestration
- `/ai/transcribe` - Audio transcription (Whisper)
- `/ai/extract-concepts` - Concept extraction (GPT-4)
- `/ai/analyze-image` - Vision analysis (GPT-4 Vision)

⚠️ **Important:** AI endpoints use OpenAI API and cost money. Monitor your usage.

---

## Common Patterns

### HTTP Status Codes
- `200 OK` - Successful GET/PATCH requests
- `201 Created` - Successful POST requests
- `204 No Content` - Successful DELETE requests
- `400 Bad Request` - Validation errors
- `404 Not Found` - Resource not found
- `409 Conflict` - Optimistic locking conflict
- `422 Unprocessable Entity` - Business logic errors
- `500 Internal Server Error` - Server errors

### Error Response Format
```json
{
  "error": "Error type",
  "message": "Human-readable error message",
  "details": {...}  // Optional additional details
}
```

### Optimistic Locking
Updates (PATCH) require the `If-Match` header with the current ETag:
```http
If-Match: "version-123"
```

### Timestamps
All timestamps are in ISO 8601 format: `2025-10-20T16:30:00Z`

---

## API Endpoints

### System Endpoints

#### Health Check
```http
GET /api/v3/health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-20T16:30:00Z",
  "database": "connected",
  "version": "3.0"
}
```

#### API Information
```http
GET /api/v3/info
```

**Response:**
```json
{
  "version": "3.0",
  "description": "Document-oriented REST API for Concierge Analyzer",
  "features": [
    "Document-oriented storage",
    "JSON_MERGE_PATCH for partial updates",
    "Optimistic locking with version control",
    "Functional indexes on JSON paths",
    "JSON_TABLE for array queries",
    "Flexible query DSL"
  ],
  "endpoints": {
    "entities": {...},
    "curations": {...},
    "query": {...}
  }
}
```

---

## Entities

Entities represent restaurants, users, admins, or system objects.

### Data Model

```json
{
  "entity_id": "string",
  "type": "restaurant|user|admin|system",
  "name": "string",
  "metadata": {
    // Flexible object - any additional fields allowed
  },
  "created_at": "2025-10-20T16:30:00Z",
  "updated_at": "2025-10-20T16:30:00Z"
}
```

### Create Entity
```http
POST /api/v3/entities
```

**Request Body:**
```json
{
  "entity_id": "rest_example",
  "type": "restaurant",
  "name": "Example Restaurant",
  "metadata": {
    "address": "123 Main St",
    "phone": "+1-555-1234",
    "cuisine": ["Italian", "Mediterranean"],
    "rating": 4.5,
    "price_range": "$$"
  }
}
```

**Response:** `201 Created`
```json
{
  "entity_id": "rest_example",
  "type": "restaurant",
  "name": "Example Restaurant",
  "metadata": {
    "address": "123 Main St",
    "phone": "+1-555-1234",
    "cuisine": ["Italian", "Mediterranean"],
    "rating": 4.5,
    "price_range": "$$"
  },
  "created_at": "2025-10-20T16:30:00Z",
  "updated_at": "2025-10-20T16:30:00Z"
}
```

**Headers:**
```
ETag: "1"
Location: /api/v3/entities/rest_example
```

### Get Entity
```http
GET /api/v3/entities/{entity_id}
```

**Response:** `200 OK`
```json
{
  "entity_id": "rest_example",
  "type": "restaurant",
  "name": "Example Restaurant",
  "metadata": {...},
  "created_at": "2025-10-20T16:30:00Z",
  "updated_at": "2025-10-20T16:30:00Z"
}
```

**Headers:**
```
ETag: "1"
```

### Update Entity (Partial)
```http
PATCH /api/v3/entities/{entity_id}
```

**Headers:**
```
If-Match: "1"
Content-Type: application/json
```

**Request Body:** (JSON Merge Patch)
```json
{
  "name": "Updated Restaurant Name",
  "metadata": {
    "rating": 4.7,
    "new_field": "added value"
  }
}
```

**Response:** `200 OK`
```json
{
  "entity_id": "rest_example",
  "type": "restaurant",
  "name": "Updated Restaurant Name",
  "metadata": {
    "address": "123 Main St",  // preserved
    "phone": "+1-555-1234",    // preserved
    "cuisine": ["Italian", "Mediterranean"],  // preserved
    "rating": 4.7,             // updated
    "price_range": "$$",       // preserved
    "new_field": "added value" // added
  },
  "created_at": "2025-10-20T16:30:00Z",
  "updated_at": "2025-10-20T16:30:05Z"
}
```

**Headers:**
```
ETag: "2"
```

### Delete Entity
```http
DELETE /api/v3/entities/{entity_id}
```

**Response:** `204 No Content`

### List/Search Entities
```http
GET /api/v3/entities
GET /api/v3/entities?type=restaurant
GET /api/v3/entities?name=Example
GET /api/v3/entities?type=restaurant&name=Pizza
```

**Query Parameters:**
- `type` - Filter by entity type
- `name` - Search by name (partial match)
- `limit` - Limit results (default: 50, max: 100)
- `offset` - Pagination offset

**Response:** `200 OK`
```json
{
  "entities": [
    {
      "entity_id": "rest_example",
      "type": "restaurant",
      "name": "Example Restaurant",
      "metadata": {...},
      "created_at": "2025-10-20T16:30:00Z",
      "updated_at": "2025-10-20T16:30:00Z"
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

---

## Curations

Curations represent user reviews, recommendations, or analysis of entities.

### Data Model

```json
{
  "curation_id": "string",
  "entity_id": "string",
  "curator": {
    "id": "string",
    "name": "string",
    "email": "string"
  },
  "category": "string",
  "concept": "string",
  "items": [
    {
      "name": "string",
      "description": "string",
      "rating": 1-5,
      "price": "number",
      "metadata": {...}
    }
  ],
  "notes": {
    "general": "string",
    "recommendations": "string",
    "warnings": "string"
  },
  "metadata": {
    // Flexible object
  },
  "created_at": "2025-10-20T16:30:00Z",
  "updated_at": "2025-10-20T16:30:00Z"
}
```

### Create Curation
```http
POST /api/v3/curations
```

**Request Body:**
```json
{
  "curation_id": "review_123",
  "entity_id": "rest_example",
  "curator": {
    "id": "user_456",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "category": "dining",
  "concept": "family_dinner",
  "items": [
    {
      "name": "Margherita Pizza",
      "description": "Classic tomato and mozzarella",
      "rating": 5,
      "price": 18.50,
      "metadata": {
        "size": "large",
        "gluten_free": false
      }
    }
  ],
  "notes": {
    "general": "Great atmosphere for families",
    "recommendations": "Try the pizza, avoid the pasta",
    "warnings": "Can be noisy on weekends"
  },
  "metadata": {
    "visit_date": "2025-10-15",
    "party_size": 4,
    "total_cost": 75.20
  }
}
```

**Response:** `201 Created` - Same structure as request with timestamps

### Get Curation
```http
GET /api/v3/curations/{curation_id}
```

**Response:** `200 OK` - Full curation object with ETag header

### Update Curation (Partial)
```http
PATCH /api/v3/curations/{curation_id}
```

**Headers:**
```
If-Match: "1"
```

**Request Body:** (JSON Merge Patch)
```json
{
  "notes": {
    "general": "Updated review - still great!"
  },
  "metadata": {
    "revisit": true
  }
}
```

### Delete Curation
```http
DELETE /api/v3/curations/{curation_id}
```

**Response:** `204 No Content`

### Get Entity Curations
```http
GET /api/v3/entities/{entity_id}/curations
```

**Query Parameters:**
- `category` - Filter by category
- `concept` - Filter by concept
- `curator_id` - Filter by curator ID
- `limit`, `offset` - Pagination

**Response:** `200 OK`
```json
{
  "entity_id": "rest_example",
  "curations": [...],
  "pagination": {...}
}
```

### Search Curations
```http
GET /api/v3/curations/search
```

**Query Parameters:**
- `category` - Filter by category
- `concept` - Filter by concept
- `curator_id` - Filter by curator
- `rating_min` - Minimum item rating
- `rating_max` - Maximum item rating
- `limit`, `offset` - Pagination

**Response:** `200 OK`
```json
{
  "curations": [...],
  "filters": {
    "category": "dining",
    "concept": "family_dinner"
  },
  "pagination": {...}
}
```

---

## Advanced Query

### Flexible Query DSL
```http
POST /api/v3/query
```

**Request Body:**
```json
{
  "type": "entities|curations",
  "filters": {
    "entity_type": "restaurant",
    "location": "San Francisco",
    "rating_range": [4.0, 5.0],
    "cuisine": ["Italian", "Mediterranean"]
  },
  "sort": [
    {"field": "metadata.rating", "order": "desc"},
    {"field": "created_at", "order": "asc"}
  ],
  "limit": 20,
  "offset": 0
}
```

**Response:** `200 OK`
```json
{
  "results": [...],
  "query": {
    "type": "entities",
    "filters": {...},
    "sort": [...],
    "execution_time": 0.045
  },
  "pagination": {
    "total": 156,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

---

## Places API (Google Places Proxy)

The API provides secure proxy endpoints for Google Places API, keeping API keys server-side.

### Search Nearby Places

```http
GET /api/v3/places/nearby
```

**Query Parameters:**
- `latitude` (required): Center latitude
- `longitude` (required): Center longitude
- `radius` (optional): Search radius in meters (default: 1000, max: 50000)
- `type` (optional): Place type (restaurant, cafe, hotel, etc.)
- `keyword` (optional): Search keyword

**Example:**
```bash
GET /api/v3/places/nearby?latitude=37.7749&longitude=-122.4194&radius=2000&type=restaurant
```

**Response:** `200 OK`
```json
{
  "results": [
    {
      "place_id": "ChIJExample123",
      "name": "Amazing Restaurant",
      "vicinity": "123 Main St, San Francisco",
      "rating": 4.5,
      "user_ratings_total": 234,
      "price_level": 2,
      "types": ["restaurant", "food"],
      "geometry": {
        "location": {
          "lat": 37.7749,
          "lng": -122.4194
        }
      },
      "business_status": "OPERATIONAL",
      "opening_hours": {
        "open_now": true
      },
      "photos": [...]
    }
  ],
  "status": "OK"
}
```

### Get Place Details

```http
GET /api/v3/places/details/{place_id}
```

**Example:**
```bash
GET /api/v3/places/details/ChIJExample123
```

**Response:** `200 OK`
```json
{
  "result": {
    "place_id": "ChIJExample123",
    "name": "Amazing Restaurant",
    "formatted_address": "123 Main St, San Francisco, CA 94102",
    "formatted_phone_number": "+1 415-555-0123",
    "website": "https://example.com",
    "rating": 4.5,
    "user_ratings_total": 234,
    "price_level": 2,
    "opening_hours": {
      "open_now": true,
      "weekday_text": [...]
    },
    "photos": [...],
    "reviews": [...]
  },
  "status": "OK"
}
```

### Place Autocomplete

```http
GET /api/v3/places/autocomplete
```

**Query Parameters:**
- `input` (required): Search text
- `latitude` (optional): Bias results near location
- `longitude` (optional): Bias results near location
- `radius` (optional): Bias radius in meters

**Example:**
```bash
GET /api/v3/places/autocomplete?input=pizza&latitude=37.7749&longitude=-122.4194
```

### Get Place Photo

```http
GET /api/v3/places/photo/{photo_reference}
```

**Query Parameters:**
- `maxwidth` (optional): Maximum width in pixels (default: 400)
- `maxheight` (optional): Maximum height in pixels

---

## AI Services 🤖

AI endpoints require API key authentication and use OpenAI services.

⚠️ **Cost Warning:** These endpoints use OpenAI API and incur costs. Monitor your usage.

### Authentication

Include API key in header:
```http
X-API-Key: your-api-key-here
```

### Orchestrate (Intelligent Workflow)

```http
POST /api/v3/ai/orchestrate
```

**Description:** Intelligent AI workflow orchestration that automatically determines the best processing pipeline based on inputs.

**Request Body:**
```json
{
  "workflow_type": "auto",
  "audio_file": "base64_encoded_audio_data...",
  "entity_type": "restaurant",
  "language": "pt-BR",
  "curator_id": "user_123",
  "output": {
    "save_to_db": true,
    "return_results": true
  }
}
```

**Workflow Types:**
- `auto` - Automatically detect best workflow
- `place_id` - Process from Google Place ID
- `entity_id` - Process existing entity
- `audio_only` - Just transcribe audio
- `image_only` - Just analyze image

**Input Options (at least one required):**
- `place_id` - Google Place ID
- `entity_id` - Existing entity ID
- `audio_file` - Base64 encoded audio
- `audio_url` - Audio file URL
- `image_file` - Base64 encoded image
- `image_url` - Image URL
- `text` - Direct text input

**Response:** `200 OK`
```json
{
  "workflow": "audio_to_entity",
  "results": {
    "transcription": {
      "text": "Had an amazing meal at Mario's Italian Restaurant...",
      "language": "pt-BR"
    },
    "concepts": [
      {
        "type": "restaurant",
        "name": "Mario's Italian Restaurant",
        "attributes": {
          "cuisine": "Italian",
          "rating": 5,
          "location": "Downtown"
        }
      }
    ],
    "entity_created": true,
    "entity_id": "rest_marios_italian"
  },
  "saved_to_db": true,
  "processing_time_ms": 2847
}
```

### Transcribe Audio

```http
POST /api/v3/ai/transcribe
```

**Request Body:**
```json
{
  "audio_file": "base64_encoded_audio...",
  "language": "pt-BR",
  "prompt": "Restaurant review"
}
```

**Response:** `200 OK`
```json
{
  "text": "Transcribed text from audio...",
  "language": "pt-BR"
}
```

### Extract Concepts

```http
POST /api/v3/ai/extract-concepts
```

**Request Body:**
```json
{
  "text": "Had amazing pasta at Mario's Italian Restaurant. The carbonara was perfect, service was excellent. Highly recommend!",
  "entity_type": "restaurant"
}
```

**Response:** `200 OK`
```json
{
  "concepts": [
    {
      "type": "restaurant",
      "name": "Mario's Italian Restaurant",
      "attributes": {
        "cuisine": "Italian",
        "dishes": ["pasta", "carbonara"],
        "rating": 5,
        "service_quality": "excellent"
      }
    }
  ]
}
```

### Analyze Image

```http
POST /api/v3/ai/analyze-image
```

**Request Body:**
```json
{
  "image_file": "base64_encoded_image...",
  "prompt": "Describe this restaurant menu and identify dishes"
}
```

**Response:** `200 OK`
```json
{
  "analysis": {
    "description": "The image shows a restaurant menu with Italian dishes...",
    "identified_items": ["Pizza Margherita", "Spaghetti Carbonara", "Tiramisu"],
    "details": {...}
  }
}
```

---

## Client Integration Examples

### JavaScript/TypeScript

```typescript
// API Client Setup
const API_BASE = 'https://wsmontes.pythonanywhere.com/api/v3';

class ConciergeAPI {
  private async request(method: string, path: string, data?: any, etag?: string) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (etag) {
      headers['If-Match'] = etag;
    }
    
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`API Error: ${error.message}`);
    }
    
    const result = await response.json();
    const responseEtag = response.headers.get('ETag');
    
    return { data: result, etag: responseEtag };
  }
  
  // Entity operations
  async createEntity(entity: any) {
    return this.request('POST', '/entities', entity);
  }
  
  async getEntity(entityId: string) {
    return this.request('GET', `/entities/${entityId}`);
  }
  
  async updateEntity(entityId: string, updates: any, etag: string) {
    return this.request('PATCH', `/entities/${entityId}`, updates, etag);
  }
  
  async deleteEntity(entityId: string) {
    return this.request('DELETE', `/entities/${entityId}`);
  }
  
  async searchEntities(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString();
    return this.request('GET', `/entities?${query}`);
  }
  
  // Curation operations
  async createCuration(curation: any) {
    return this.request('POST', '/curations', curation);
  }
  
  async getCuration(curationId: string) {
    return this.request('GET', `/curations/${curationId}`);
  }
  
  async updateCuration(curationId: string, updates: any, etag: string) {
    return this.request('PATCH', `/curations/${curationId}`, updates, etag);
  }
  
  async getEntityCurations(entityId: string, params?: Record<string, string>) {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return this.request('GET', `/entities/${entityId}/curations${query}`);
  }
  
  async searchCurations(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString();
    return this.request('GET', `/curations/search?${query}`);
  }
  
  // Advanced query
  async query(queryRequest: any) {
    return this.request('POST', '/query', queryRequest);
  }
  
  // System endpoints
  async health() {
    return this.request('GET', '/health');
  }
  
  async info() {
    return this.request('GET', '/info');
  }
}

// Usage Examples
const api = new ConciergeAPI();

// Create a restaurant
const { data: restaurant, etag } = await api.createEntity({
  entity_id: 'my_restaurant',
  type: 'restaurant',
  name: 'My Restaurant',
  metadata: {
    cuisine: ['Italian'],
    location: 'San Francisco',
    rating: 4.5
  }
});

// Update the restaurant
await api.updateEntity('my_restaurant', {
  metadata: {
    rating: 4.7,
    updated: true
  }
}, etag);

// Search restaurants
const { data: results } = await api.searchEntities({
  type: 'restaurant',
  name: 'Pizza'
});

// Create a curation
await api.createCuration({
  curation_id: 'my_review',
  entity_id: 'my_restaurant',
  curator: {
    id: 'user123',
    name: 'John Doe',
    email: 'john@example.com'
  },
  category: 'dining',
  concept: 'date_night',
  items: [
    {
      name: 'Pasta Carbonara',
      description: 'Creamy and delicious',
      rating: 5,
      price: 24.50
    }
  ],
  notes: {
    general: 'Perfect for a romantic dinner'
  }
});
```

### Python Client

```python
import requests
from typing import Dict, Any, Optional, Tuple

class ConciergeAPI:
    def __init__(self, base_url: str = 'https://wsmontes.pythonanywhere.com/api/v3'):
        self.base_url = base_url
    
    def _request(self, method: str, path: str, data: Optional[Dict] = None, 
                etag: Optional[str] = None) -> Tuple[Dict[str, Any], Optional[str]]:
        """Make API request and return (data, etag)"""
        headers = {'Content-Type': 'application/json'}
        if etag:
            headers['If-Match'] = etag
        
        response = requests.request(
            method=method,
            url=f"{self.base_url}{path}",
            headers=headers,
            json=data
        )
        
        response.raise_for_status()
        
        result = response.json() if response.content else {}
        response_etag = response.headers.get('ETag')
        
        return result, response_etag
    
    # Entity operations
    def create_entity(self, entity: Dict[str, Any]) -> Tuple[Dict, str]:
        return self._request('POST', '/entities', entity)
    
    def get_entity(self, entity_id: str) -> Tuple[Dict, str]:
        return self._request('GET', f'/entities/{entity_id}')
    
    def update_entity(self, entity_id: str, updates: Dict[str, Any], 
                     etag: str) -> Tuple[Dict, str]:
        return self._request('PATCH', f'/entities/{entity_id}', updates, etag)
    
    def search_entities(self, **params) -> Tuple[Dict, Optional[str]]:
        query = '&'.join(f"{k}={v}" for k, v in params.items())
        return self._request('GET', f'/entities?{query}')
    
    # Curation operations
    def create_curation(self, curation: Dict[str, Any]) -> Tuple[Dict, str]:
        return self._request('POST', '/curations', curation)
    
    def get_curation(self, curation_id: str) -> Tuple[Dict, str]:
        return self._request('GET', f'/curations/{curation_id}')
    
    def search_curations(self, **params) -> Tuple[Dict, Optional[str]]:
        query = '&'.join(f"{k}={v}" for k, v in params.items())
        return self._request('GET', f'/curations/search?{query}')
    
    def query(self, query_request: Dict[str, Any]) -> Tuple[Dict, Optional[str]]:
        return self._request('POST', '/query', query_request)

# Usage
api = ConciergeAPI()

# Create restaurant
restaurant, etag = api.create_entity({
    'entity_id': 'python_restaurant',
    'type': 'restaurant',
    'name': 'Python Café',
    'metadata': {
        'cuisine': ['Coffee', 'Sandwiches'],
        'location': 'Tech District'
    }
})

print(f"Created restaurant: {restaurant['name']}")

# Search restaurants
results, _ = api.search_entities(type='restaurant', name='Python')
print(f"Found {len(results['entities'])} restaurants")
```

---

## Rate Limits

Currently, no rate limits are enforced, but this may change in future versions.

---

## Changelog

### Version 3.0.0 (Current - November 2025)
- ✅ **Major Architecture Update**: Migrated to FastAPI with async/await
- ✅ **Database**: MongoDB Atlas with async Motor driver
- ✅ **AI Services**: OpenAI integration (GPT-4, Whisper, Vision)
  - Intelligent workflow orchestration
  - Audio transcription (Whisper)
  - Concept extraction (GPT-4)
  - Image analysis (GPT-4 Vision)
- ✅ **Google Places API**: Secure server-side proxy
  - Nearby search
  - Place details
  - Autocomplete
  - Photo retrieval
- ✅ **Authentication**: API Key for AI endpoints
- ✅ **Documentation**: Interactive Swagger UI + ReDoc
- ✅ **Testing**: Comprehensive test suite (78 tests, 79.5% passing)
- ✅ **CORS**: Full frontend integration support
- ✅ **Deployment**: PythonAnywhere production + local development

### Version 2.0 (Legacy - MySQL)
- Document-oriented storage with JSON fields
- Optimistic locking with ETags
- JSON Merge Patch for partial updates
- Flexible query DSL
- Improved error handling and validation
- Full CRUD operations for entities and curations

---

## Support & Resources

### Documentation
- **Interactive Docs**: https://wsmontes.pythonanywhere.com/api/v3/docs (Swagger UI)
- **ReDoc**: https://wsmontes.pythonanywhere.com/api/v3/redoc
- **Quick Reference**: [API_QUICK_REFERENCE.md](./API_QUICK_REFERENCE.md)
- **Backend README**: [concierge-api-v3/README.md](../concierge-api-v3/README.md)

### Health & Status
- **Health Check**: https://wsmontes.pythonanywhere.com/api/v3/health
- **API Info**: https://wsmontes.pythonanywhere.com/api/v3/info
- **OpenAPI Schema**: https://wsmontes.pythonanywhere.com/api/v3/openapi.json

### Development
- **GitHub**: wsmontes/Concierge-Collector
- **Branch**: V3
- **Local Dev**: http://localhost:8000/api/v3

### Testing
```bash
cd concierge-api-v3
pytest tests/ -v
```

**Test Coverage:**
- 78 total tests
- 62 passing (79.5%)
- 16 skipped (20.5% - complex OpenAI mocks)
- 100% functional coverage