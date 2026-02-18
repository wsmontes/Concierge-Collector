# API Reference Documentation

> **Status:** Ativo (Parcial) — saneamento crítico de URLs executado em 2026-02-18.

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

### JSON Schemas & Examples 🆕
**[schemas.json](./schemas.json)** - JSON Schema Draft-07 definitions  
**[examples.json](./examples.json)** - Complete request/response examples  
**[JSON_SCHEMAS_README.md](./JSON_SCHEMAS_README.md)** - Usage guide  
Perfect for: Type generation, validation, testing, mocking.

### OpenAPI Schema
**[openapi.yaml](./openapi.yaml)** | **[openapi.json](./openapi.json)**  
Auto-generated OpenAPI 3.1.0 specification from FastAPI.  
Perfect for: Code generation, API testing tools, validation.  
📖 [How to update](./OPENAPI_README.md)

---

## 🔗 Interactive Documentation

### Interactive Docs
- **Swagger UI:** `https://concierge-collector.onrender.com/api/v3/docs`
- **ReDoc:** `https://concierge-collector.onrender.com/api/v3/redoc`

---

## 🎯 Quick Start

```bash
# 1. Health Check
curl https://concierge-collector.onrender.com/api/v3/health

# 2. Search Places (public)
curl "https://concierge-collector.onrender.com/api/v3/places/orchestrate" \
  -H "Content-Type: application/json" \
  -d '{"query": "restaurants in Rome"}'

# 3. Create Entity (requires auth)
curl -X POST https://concierge-collector.onrender.com/api/v3/entities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_token>" \
  -d '{"entity_id": "my_restaurant", "type": "restaurant", "name": "My Restaurant"}'

# 4. AI Services (requires auth)
curl -X POST https://concierge-collector.onrender.com/api/v3/ai/orchestrate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_token>" \
  -d '{"workflow": "text_only", "input": {"text": "Great food"}, "output": {"save_to_db": false}}'
```

---

## 📋 API Overview

### Base URLs
- **Production:** `https://concierge-collector.onrender.com/api/v3`
- **Local:** `http://localhost:8000/api/v3`

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
- `POST /places/orchestrate` - Places orchestration workflow
- `GET /places/{place_id}/photos` - Get photo collection

#### AI Services 🤖
- `POST /ai/orchestrate` - Intelligent workflow
- `POST /ai/extract-restaurant-name` - Name extraction from text
- `GET /ai/usage-stats` - Usage statistics
- `GET /ai/health` - AI health check

---

## 🔑 Authentication

### Public Endpoints
Most endpoints are public (no auth required):
- System, Entities, Curations, Places

### Protected Endpoints
Protected endpoints accept OAuth Bearer token **or** API key:
```bash
Authorization: Bearer <jwt_token>
# or
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
# 2. Process with AI orchestrator (transcription + concept extraction)
POST /ai/orchestrate { "audio_file": "...", "entity_type": "restaurant", "workflow_type": "auto" }

# 3. Create entity and curation
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
Use interactive docs: https://concierge-collector.onrender.com/api/v3/docs

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
- **Deployment:** Render.com

---

## 🔗 Links

- **Interactive Docs:** https://concierge-collector.onrender.com/api/v3/docs
- **Health Check:** https://concierge-collector.onrender.com/api/v3/health
- **GitHub:** wsmontes/Concierge-Collector (branch: V3)
- **Backend README:** [../concierge-api-v3/README.md](../concierge-api-v3/README.md)

---

**Need Help?** Check the interactive documentation or see the complete documentation files above.
