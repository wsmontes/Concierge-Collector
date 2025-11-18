# API Reference Documentation

Complete API documentation for Concierge Collector API V3.

## 📚 Documentation Files

### Quick Reference
**[API_QUICK_REFERENCE.md](./API_QUICK_REFERENCE.md)**  
Fast lookup guide with all endpoints, examples, and common patterns.  
Perfect for: Quick lookups, during development, troubleshooting.

### Complete Documentation
**[API_DOCUMENTATION_V3.md](./API_DOCUMENTATION_V3.md)**  
Comprehensive API documentation with detailed explanations.  
Perfect for: Learning the API, integration planning, reference.

### OpenAPI Schema
**[openapi.yaml](./openapi.yaml)**  
Machine-readable API specification (OpenAPI 3.0).  
Perfect for: Code generation, API testing tools, validation.

---

## 🔗 Interactive Documentation

### Swagger UI
**https://wsmontes.pythonanywhere.com/api/v3/docs**  
Interactive API explorer - try endpoints directly in your browser.

### ReDoc
**https://wsmontes.pythonanywhere.com/api/v3/redoc**  
Beautiful, responsive API documentation.

---

## 🎯 Quick Start

### 1. Check API Status
```bash
curl https://wsmontes.pythonanywhere.com/api/v3/health
```

### 2. Create an Entity
```bash
curl -X POST https://wsmontes.pythonanywhere.com/api/v3/entities \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "my_restaurant",
    "type": "restaurant",
    "name": "My Restaurant",
    "metadata": {
      "cuisine": "Italian",
      "rating": 4.5
    }
  }'
```

### 3. Search Nearby Places
```bash
curl "https://wsmontes.pythonanywhere.com/api/v3/places/nearby?latitude=37.7749&longitude=-122.4194&radius=1000&type=restaurant"
```

### 4. Use AI Services (requires API key)
```bash
curl -X POST https://wsmontes.pythonanywhere.com/api/v3/ai/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "audio_file": "base64_encoded_audio...",
    "language": "pt-BR"
  }'
```

---

## 📋 API Overview

### Base URLs
- **Production:** `https://wsmontes.pythonanywhere.com/api/v3`
- **Local Dev:** `http://localhost:8000/api/v3`

### Endpoints Summary

#### System
- `GET /health` - Health check
- `GET /info` - API information

#### Entities
- `POST /entities` - Create entity
- `GET /entities/{id}` - Get entity
- `PATCH /entities/{id}` - Update entity
- `DELETE /entities/{id}` - Delete entity
- `GET /entities?...` - Search entities

#### Curations
- `POST /curations` - Create curation
- `GET /curations/{id}` - Get curation
- `PATCH /curations/{id}` - Update curation
- `DELETE /curations/{id}` - Delete curation
- `GET /entities/{id}/curations` - Get entity curations

#### Places (Google Places Proxy)
- `GET /places/nearby` - Search nearby
- `GET /places/details/{place_id}` - Place details
- `GET /places/autocomplete` - Autocomplete
- `GET /places/photo/{photo_ref}` - Get photo

#### AI Services 🤖 (requires API key)
- `POST /ai/orchestrate` - Intelligent workflow
- `POST /ai/transcribe` - Audio transcription
- `POST /ai/extract-concepts` - Concept extraction
- `POST /ai/analyze-image` - Image analysis

---

## 🔑 Authentication

### Public Endpoints
Most endpoints are public (no auth required):
- System, Entities, Curations, Places

### Protected Endpoints
AI endpoints require API key:
```bash
X-API-Key: your-api-key-here
```

**Generate API Key:**
```bash
cd concierge-api-v3
python scripts/generate_api_key.py
```

---

## 💡 Common Use Cases

### Use Case 1: Restaurant Discovery
```bash
# 1. Search nearby restaurants
GET /places/nearby?lat=37.7749&lng=-122.4194&type=restaurant

# 2. Get details
GET /places/details/ChIJ...

# 3. Create entity
POST /entities { "entity_id": "...", "type": "restaurant", ... }

# 4. Add curation
POST /curations { "entity_id": "...", "curator": {...}, ... }
```

### Use Case 2: Audio Review Processing
```bash
# 1. Record audio review
# 2. Transcribe with AI
POST /ai/transcribe { "audio_file": "...", "language": "pt-BR" }

# 3. Extract concepts
POST /ai/extract-concepts { "text": "...", "entity_type": "restaurant" }

# 4. Create entity and curation
POST /entities { ... }
POST /curations { ... }
```

### Use Case 3: Smart Orchestration
```bash
# One endpoint does it all!
POST /ai/orchestrate {
  "audio_file": "base64_audio...",
  "entity_type": "restaurant",
  "workflow_type": "auto",
  "output": { "save_to_db": true }
}
# Returns: transcription + concepts + entity created + curation added
```

---

## 🧪 Testing

### Manual Testing
Use interactive docs: https://wsmontes.pythonanywhere.com/api/v3/docs

### Automated Testing
```bash
cd concierge-api-v3
pytest tests/ -v
```

### cURL Examples
See [API_QUICK_REFERENCE.md](./API_QUICK_REFERENCE.md) for complete examples.

---

## 📊 Status

- **Version:** 3.0.0
- **Status:** Production Ready ✅
- **Database:** MongoDB Atlas
- **Framework:** FastAPI (async)
- **Tests:** 78 tests (79.5% passing, 100% functional coverage)
- **Deployment:** PythonAnywhere

---

## 🔗 Links

- **Interactive Docs:** https://wsmontes.pythonanywhere.com/api/v3/docs
- **Health Check:** https://wsmontes.pythonanywhere.com/api/v3/health
- **GitHub:** wsmontes/Concierge-Collector (branch: V3)
- **Backend README:** [../concierge-api-v3/README.md](../concierge-api-v3/README.md)

---

**Need Help?** Check the interactive documentation or see the complete documentation files above.
