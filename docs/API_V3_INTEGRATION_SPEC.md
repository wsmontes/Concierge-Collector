# API V3 Integration Specification

**Version:** 3.0.0  
**Date:** November 18, 2025  
**API Base URL:** `http://localhost:8000/api/v3`

---

## 🎯 Overview

This document specifies exactly how the Collector frontend must integrate with the FastAPI V3 backend. All request/response formats, headers, error handling, and authentication flows are defined here.

---

## 🔐 Authentication

### API Key Authentication

**Header Name:** `X-API-Key`

**Required For:**
- All POST requests (create)
- All PATCH requests (update)
- All DELETE requests (delete)
- AI service endpoints
- Places service endpoints

**Not Required For:**
- GET requests (read operations)
- Health check endpoints

**Example:**
```javascript
fetch('http://localhost:8000/api/v3/entities', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key-here'
  },
  body: JSON.stringify(entityData)
});
```

### API Key Storage

```javascript
// Store in localStorage
localStorage.setItem('api_key_v3', apiKey);

// Retrieve
const apiKey = localStorage.getItem('api_key_v3');

// Check existence on app start
if (!apiKey) {
  promptUserForApiKey();
}
```

### Generate API Key

```bash
cd concierge-api-v3
python scripts/generate_api_key.py
```

---

## 🔄 Optimistic Locking

### Version-Based Conflict Resolution

Every entity and curation has a `version` field (integer) that increments on each update.

**Update Flow:**

1. **GET** the current resource to obtain its version
2. **PATCH** with `If-Match` header containing the version
3. Server validates version matches current state
4. Success → version increments, 200 OK
5. Conflict → 409 Conflict (version mismatch)

**Example:**

```javascript
// Step 1: GET current entity
const response = await fetch('http://localhost:8000/api/v3/entities/abc-123');
const entity = await response.json();
console.log(entity.version); // 5

// Step 2: PATCH with If-Match header
const updateResponse = await fetch('http://localhost:8000/api/v3/entities/abc-123', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
    'If-Match': String(entity.version)  // Must be string: "5"
  },
  body: JSON.stringify({
    name: 'Updated Name'
  })
});

if (updateResponse.status === 409) {
  // Version conflict - handle resolution
  handleConflict(entity);
} else if (updateResponse.ok) {
  const updated = await updateResponse.json();
  console.log(updated.version); // 6
}
```

**Required Headers for Updates:**
```javascript
{
  'X-API-Key': 'your-api-key',
  'If-Match': '5'  // String, not number
}
```

**Error Response (409 Conflict):**
```json
{
  "detail": "Version conflict or entity not found"
}
```

---

## 📡 Entity Endpoints

### Create or Upsert Entity

**Endpoint:** `POST /api/v3/entities`  
**Auth:** Required (X-API-Key)  
**Behavior:** Creates new entity OR merges with existing if entity_id exists

**Request:**
```json
{
  "entity_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "restaurant",
  "name": "Fasano",
  "status": "active",
  "externalId": "ChIJ_example_google_place_id",
  "data": {
    "location": {
      "address": "Rua Vittorio Fasano, 88",
      "city": "São Paulo",
      "state": "SP",
      "country": "Brazil",
      "postalCode": "01414-020",
      "coordinates": {
        "lat": -23.567890,
        "lng": -46.658901
      }
    },
    "contacts": {
      "phone": "+55 11 3896-4000",
      "website": "https://www.fasano.com.br",
      "email": "contato@fasano.com.br"
    },
    "attributes": {
      "cuisine": ["Italian", "Contemporary"],
      "priceRange": "$$$$",
      "rating": 4.8
    }
  },
  "metadata": [
    {
      "type": "google_places",
      "source": "google_places_api",
      "importedAt": "2025-11-18T10:00:00Z",
      "data": {
        "place_id": "ChIJ_example",
        "rating": 4.8,
        "user_ratings_total": 1234
      }
    }
  ],
  "createdBy": {
    "id": "user-uuid",
    "name": "Wagner Montes"
  }
}
```

**Response (201 Created):**
```json
{
  "entity_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "restaurant",
  "name": "Fasano",
  "status": "active",
  "externalId": "ChIJ_example_google_place_id",
  "data": { /* same as request */ },
  "metadata": [ /* same as request */ ],
  "sync": {
    "serverId": null,
    "status": "pending",
    "lastSyncedAt": null
  },
  "createdAt": "2025-11-18T10:00:00.000Z",
  "updatedAt": "2025-11-18T10:00:00.000Z",
  "version": 1,
  "createdBy": {
    "id": "user-uuid",
    "name": "Wagner Montes"
  },
  "updatedBy": null
}
```

### Get Entity by ID

**Endpoint:** `GET /api/v3/entities/{entity_id}`  
**Auth:** Not required

**Response (200 OK):**
```json
{
  "entity_id": "550e8400-e29b-41d4-a716-446655440000",
  "version": 5,
  /* ... full entity data ... */
}
```

**Error (404 Not Found):**
```json
{
  "detail": "Entity 550e8400-e29b-41d4-a716-446655440000 not found"
}
```

### List/Search Entities

**Endpoint:** `GET /api/v3/entities`  
**Auth:** Not required

**Query Parameters:**
- `type` (optional): Filter by entity type (restaurant, hotel, etc.)
- `status` (optional): Filter by status (active, inactive, draft)
- `limit` (optional): Max results (default: 50, max: 1000)
- `offset` (optional): Pagination offset (default: 0)

**Example Request:**
```
GET /api/v3/entities?type=restaurant&status=active&limit=20&offset=0
```

**Response (200 OK):**
```json
{
  "items": [
    { /* entity 1 */ },
    { /* entity 2 */ }
  ],
  "total": 100,
  "limit": 20,
  "offset": 0
}
```

### Update Entity (Partial)

**Endpoint:** `PATCH /api/v3/entities/{entity_id}`  
**Auth:** Required (X-API-Key + If-Match)

**Request:**
```json
{
  "name": "Fasano Restaurant & Hotel",
  "data": {
    "attributes": {
      "rating": 4.9
    }
  }
}
```

**Headers:**
```
X-API-Key: your-api-key
If-Match: 5
```

**Response (200 OK):**
```json
{
  "entity_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Fasano Restaurant & Hotel",
  "version": 6,  // Incremented
  "updatedAt": "2025-11-18T12:00:00.000Z",
  /* ... rest of entity ... */
}
```

**Error (409 Conflict):**
```json
{
  "detail": "Version conflict or entity not found"
}
```

**Error (428 Precondition Required):**
```json
{
  "detail": "If-Match header is required for updates"
}
```

### Delete Entity

**Endpoint:** `DELETE /api/v3/entities/{entity_id}`  
**Auth:** Required (X-API-Key)

**Response:** `204 No Content`

**Error (404 Not Found):**
```json
{
  "detail": "Entity not found"
}
```

---

## 📡 Curation Endpoints

### Create Curation

**Endpoint:** `POST /api/v3/curations`  
**Auth:** Required (X-API-Key)

**Request:**
```json
{
  "curation_id": "650e8400-e29b-41d4-a716-446655440001",
  "entity_id": "550e8400-e29b-41d4-a716-446655440000",
  "curator": {
    "id": "curator-uuid",
    "name": "Expert Curator",
    "role": "sommelier"
  },
  "content": {
    "transcription": "This is an exceptional restaurant...",
    "notes": "Additional notes here",
    "highlights": ["Excellent wine list", "Traditional Italian"]
  },
  "concepts": [
    {
      "category": "Cuisine",
      "value": "Italian",
      "confidence": 0.95
    },
    {
      "category": "Price Range",
      "value": "$$$$",
      "confidence": 0.9
    }
  ],
  "media": {
    "audio": "audio-uuid",
    "photos": ["photo-uuid-1", "photo-uuid-2"],
    "duration": 180
  },
  "status": "published"
}
```

**Response (201 Created):**
```json
{
  "curation_id": "650e8400-e29b-41d4-a716-446655440001",
  "entity_id": "550e8400-e29b-41d4-a716-446655440000",
  /* ... full curation data ... */
  "createdAt": "2025-11-18T10:00:00.000Z",
  "updatedAt": "2025-11-18T10:00:00.000Z",
  "version": 1
}
```

**Error (404 Not Found):**
```json
{
  "detail": "Entity 550e8400-e29b-41d4-a716-446655440000 not found"
}
```

### Get Curation by ID

**Endpoint:** `GET /api/v3/curations/{curation_id}`  
**Auth:** Not required

### List Curations

**Endpoint:** `GET /api/v3/curations`  
**Auth:** Not required

**Query Parameters:**
- `entity_id` (optional): Filter by entity
- `curator_id` (optional): Filter by curator
- `limit` (optional): Max results
- `offset` (optional): Pagination offset

### Get Entity's Curations

**Endpoint:** `GET /api/v3/entities/{entity_id}/curations`  
**Auth:** Not required

**Response (200 OK):**
```json
[
  { /* curation 1 */ },
  { /* curation 2 */ }
]
```

### Update Curation

**Endpoint:** `PATCH /api/v3/curations/{curation_id}`  
**Auth:** Required (X-API-Key + If-Match)

Same pattern as entity updates.

### Delete Curation

**Endpoint:** `DELETE /api/v3/curations/{curation_id}`  
**Auth:** Required (X-API-Key)

---

## 🤖 AI Service Endpoints

### Transcribe Audio

**Endpoint:** `POST /api/v3/ai/transcribe`  
**Auth:** Required (X-API-Key)

**Request (multipart/form-data):**
```javascript
const formData = new FormData();
formData.append('file', audioBlob, 'audio.m4a');
formData.append('language', 'pt');  // Optional

const response = await fetch('http://localhost:8000/api/v3/ai/transcribe', {
  method: 'POST',
  headers: {
    'X-API-Key': apiKey
  },
  body: formData
});
```

**Response (200 OK):**
```json
{
  "text": "Transcrição completa do áudio...",
  "language": "pt",
  "duration": 180.5
}
```

### Extract Concepts

**Endpoint:** `POST /api/v3/ai/extract-concepts`  
**Auth:** Required (X-API-Key)

**Request:**
```json
{
  "text": "This restaurant serves excellent Italian cuisine with a focus on traditional recipes...",
  "entity_type": "restaurant"
}
```

**Response (200 OK):**
```json
{
  "concepts": [
    {
      "category": "Cuisine",
      "value": "Italian",
      "confidence": 0.95
    },
    {
      "category": "Style",
      "value": "Traditional",
      "confidence": 0.88
    }
  ]
}
```

### Analyze Image

**Endpoint:** `POST /api/v3/ai/analyze-image`  
**Auth:** Required (X-API-Key)

**Request (multipart/form-data):**
```javascript
const formData = new FormData();
formData.append('file', imageBlob, 'photo.jpg');
formData.append('prompt', 'Describe this restaurant interior');

const response = await fetch('http://localhost:8000/api/v3/ai/analyze-image', {
  method: 'POST',
  headers: {
    'X-API-Key': apiKey
  },
  body: formData
});
```

**Response (200 OK):**
```json
{
  "analysis": "The image shows a modern restaurant interior with...",
  "details": {
    "ambiance": "elegant",
    "style": "contemporary"
  }
}
```

---

## 🗺️ Places Service Endpoints

### Search Places

**Endpoint:** `GET /api/v3/places/search`  
**Auth:** Required (X-API-Key)

**Query Parameters:**
- `query`: Search query (required)
- `location`: Lat,lng coordinates (optional)
- `radius`: Search radius in meters (optional)

**Example:**
```
GET /api/v3/places/search?query=italian+restaurant&location=-23.5505,-46.6333&radius=5000
```

**Response (200 OK):**
```json
{
  "results": [
    {
      "place_id": "ChIJ_example",
      "name": "Restaurant Name",
      "formatted_address": "Street, City",
      "geometry": {
        "location": { "lat": -23.5505, "lng": -46.6333 }
      },
      "rating": 4.5,
      "types": ["restaurant", "food"]
    }
  ]
}
```

### Get Place Details

**Endpoint:** `GET /api/v3/places/details/{place_id}`  
**Auth:** Required (X-API-Key)

**Response (200 OK):**
```json
{
  "place_id": "ChIJ_example",
  "name": "Restaurant Name",
  "formatted_address": "Full Address",
  "formatted_phone_number": "+55 11 1234-5678",
  "website": "https://example.com",
  "opening_hours": {
    "open_now": true,
    "weekday_text": ["Monday: 12:00 PM – 11:00 PM", ...]
  },
  "photos": [
    {
      "photo_reference": "ref123",
      "width": 1024,
      "height": 768
    }
  ],
  "rating": 4.5,
  "user_ratings_total": 1234,
  "price_level": 3
}
```

---

## 🎯 Concept Matching

### Match Concepts

**Endpoint:** `POST /api/v3/concepts/match`  
**Auth:** Required (X-API-Key)

**Request:**
```json
{
  "concepts": [
    "Italian food",
    "expensive",
    "wine bar"
  ]
}
```

**Response (200 OK):**
```json
{
  "matched_concepts": [
    {
      "input": "Italian food",
      "category": "Cuisine",
      "value": "Italian",
      "confidence": 0.95
    },
    {
      "input": "expensive",
      "category": "Price Range",
      "value": "$$$$",
      "confidence": 0.88
    },
    {
      "input": "wine bar",
      "category": "Type",
      "value": "Wine Bar",
      "confidence": 0.92
    }
  ]
}
```

---

## ⚠️ Error Handling

### Standard Error Response

```json
{
  "detail": "Error message here"
}
```

### HTTP Status Codes

| Code | Meaning | When |
|------|---------|------|
| 200 | OK | Successful GET, PATCH |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid data format |
| 401 | Unauthorized | Missing/invalid API key |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Version mismatch (optimistic locking) |
| 422 | Unprocessable Entity | Validation error |
| 428 | Precondition Required | Missing If-Match header |
| 500 | Internal Server Error | Server error |

### Validation Errors (422)

```json
{
  "detail": [
    {
      "loc": ["body", "name"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

### Error Handling Pattern

```javascript
async function apiRequest(url, options) {
  try {
    const response = await fetch(url, options);
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('API key invalid or missing');
      } else if (response.status === 409) {
        throw new Error('Version conflict - data was modified');
      } else if (response.status === 422) {
        const error = await response.json();
        throw new Error(`Validation error: ${JSON.stringify(error.detail)}`);
      } else {
        const error = await response.json();
        throw new Error(error.detail || 'Unknown error');
      }
    }
    
    // Handle 204 No Content
    if (response.status === 204) {
      return null;
    }
    
    return await response.json();
    
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}
```

---

## 🔧 Configuration

### config.js Updates Required

```javascript
const AppConfig = {
  api: {
    backend: {
      baseUrl: 'http://localhost:8000/api/v3',  // ✅ Updated
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      features: {
        optimisticLocking: true,  // ✅ Version field
        requiresAuth: true        // ✅ X-API-Key
      },
      endpoints: {
        // System
        health: '/health',
        info: '/info',
        
        // Entities
        entities: '/entities',
        entityById: '/entities/{id}',
        
        // Curations
        curations: '/curations',
        curationById: '/curations/{id}',
        entityCurations: '/entities/{id}/curations',
        
        // Concepts
        conceptMatch: '/concepts/match',
        
        // AI
        aiTranscribe: '/ai/transcribe',
        aiExtractConcepts: '/ai/extract-concepts',
        aiAnalyzeImage: '/ai/analyze-image',
        
        // Places
        placesSearch: '/places/search',
        placesDetails: '/places/details/{id}'
      }
    }
  }
};
```

---

## ✅ Implementation Checklist

- [ ] Update config.js with V3 endpoints
- [ ] Implement X-API-Key authentication in apiService.js
- [ ] Implement If-Match optimistic locking
- [ ] Handle all error codes properly
- [ ] Test create/read/update/delete for entities
- [ ] Test create/read/update/delete for curations
- [ ] Test conflict resolution (409)
- [ ] Test API key validation
- [ ] Implement retry logic for network errors
- [ ] Add request/response logging
- [ ] Test AI service integration
- [ ] Test Places service integration
- [ ] Update all modules to use new API

---

## 🔗 Related Documentation

- [Collector V3 Architecture](./COLLECTOR_V3_ARCHITECTURE.md)
- [API V3 README](../concierge-api-v3/README.md)
- [OpenAPI Spec](http://localhost:8000/api/v3/docs)
