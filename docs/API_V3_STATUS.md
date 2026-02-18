<!--
Purpose: Registrar um snapshot histórico do status de integração da API V3 durante a fase inicial de rollout.
Main responsibilities: Preservar contexto de evolução e decisões antigas sem competir com a documentação operacional ativa.
Dependencies: docs/API/API_DOCUMENTATION_V3.md, docs/API/API_QUICK_REFERENCE.md, docs/API/README.md.
-->

# API V3 - Status & Integration Guide

> **Status:** Histórico (Supersedido) — use a documentação ativa em `docs/API/` para operação atual.

**Last Updated**: November 17, 2025  
**Status**: ⚠️ **Historical Snapshot** (superseded)  
**Version**: 1.0.0

---

## Quick Status

| Component | Status | Details |
|-----------|--------|---------|
| **Backend** | ✅ Working | FastAPI 0.109.0 |
| **Database** | ✅ Working | MongoDB Atlas |
| **Tests** | ✅ 100% Pass | 28/28 tests green |
| **Deployment** | ✅ Ready | Dockerized |
| **Multi-Curator** | 🔧 Ready for Extension | Schema supports it |

---

## What API V3 Does Today

### 1. Entity Management

**Create Entity**:
```bash
curl -X POST http://localhost:8000/api/v3/entities \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Restaurante Exemplo",
    "location": {
      "lat": -23.5505,
      "lng": -46.6333,
      "address": "Rua Exemplo, 123",
      "city": "São Paulo"
    },
    "cuisine": "Italian",
    "price_level": 3,
    "google_place_id": "ChIJ...",
    "source": "google_places"
  }'
```

**Get Entity**:
```bash
curl http://localhost:8000/api/v3/entities/{entity_id}
```

**List Entities**:
```bash
curl http://localhost:8000/api/v3/entities?limit=20
```

### 2. Curation Management

**Create Curation**:
```bash
curl -X POST http://localhost:8000/api/v3/curations \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "entity_123",
    "concepts": ["romantic", "cozy"],
    "category": "hidden-gem",
    "notes": "Perfect for date night",
    "rating": 5,
    "source": "curator"
  }'
```

**Get Curations for Entity**:
```bash
curl http://localhost:8000/api/v3/curations?entity_id={entity_id}
```

### 3. Bulk Operations

**Bulk Sync Entities**:
```bash
curl -X POST http://localhost:8000/api/v3/entities/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "entities": [
      { "name": "Restaurant 1", ... },
      { "name": "Restaurant 2", ... }
    ]
  }'
```

**Bulk Sync Curations**:
```bash
curl -X POST http://localhost:8000/api/v3/curations/bulk \
  -H "Content-Type: application/json" \
  -d '{
    "curations": [
      { "entity_id": "...", "concepts": [...] },
      { "entity_id": "...", "concepts": [...] }
    ]
  }'
```

---

## Current Architecture

```
┌─────────────────────────────────────────────┐
│   Concierge Collector (Frontend)           │
│   - IndexedDB (offline storage)             │
│   - V3DataTransformer (compatibility)       │
└──────────────┬──────────────────────────────┘
               │
               │ REST API (JSON)
               │
┌──────────────▼──────────────────────────────┐
│   FastAPI Application                       │
│   - app/routes/ (endpoints)                 │
│   - app/models/ (Pydantic schemas)          │
│   - app/services/ (business logic)          │
└──────────────┬──────────────────────────────┘
               │
               │ Motor (async driver)
               │
┌──────────────▼──────────────────────────────┐
│   MongoDB Atlas                             │
│   - entities collection                     │
│   - curations collection                    │
│   - Indexes for performance                 │
└─────────────────────────────────────────────┘
```

---

## How Frontend Integrates

### V3DataTransformer (Sprint 1, Day 3)

**Purpose**: Bridge between frontend camelCase and API snake_case

**Entity Transformation**:
```javascript
// Frontend → API
const apiEntity = V3DataTransformer.entityToV3({
  id: "local_123",
  name: "Restaurant",
  googlePlaceId: "ChIJ...",  // camelCase
  createdAt: new Date()
});

// Result (snake_case for API):
{
  entity_id: "local_123",
  name: "Restaurant",
  google_place_id: "ChIJ...",
  created_at: "2025-11-17T10:00:00Z"
}
```

**Curation Transformation**:
```javascript
// API → Frontend
const localCuration = V3DataTransformer.v3ToCuration({
  curation_id: "api_456",
  entity_id: "entity_123",
  created_at: "2025-11-17T10:00:00Z"
});

// Result (camelCase for frontend):
{
  id: "api_456",
  entityId: "entity_123",
  createdAt: Date object
}
```

### ApiClient Service

**Location**: `scripts/services/ApiClient.js`

**Usage**:
```javascript
// Create entity
const entity = await ApiClient.createEntity({
  name: "Restaurant",
  location: { lat: -23.5505, lng: -46.6333 }
});

// Get entity
const entity = await ApiClient.getEntity(entityId);

// Create curation
const curation = await ApiClient.createCuration({
  entityId: "entity_123",
  concepts: ["romantic"]
});

// Bulk sync
const result = await ApiClient.bulkSyncEntities([entity1, entity2]);
```

---

## Test Coverage

**Location**: `/concierge-api-v3/tests/`

**Test Files**:
```
tests/
├── test_entities.py          # Entity CRUD operations
├── test_curations.py         # Curation CRUD operations
├── test_bulk_sync.py         # Bulk operations
├── test_validation.py        # Input validation
└── test_integration.py       # End-to-end tests
```

**Running Tests**:
```bash
cd concierge-api-v3
source venv/bin/activate
pytest tests/ -v

# Expected output:
# ======================= 28 passed in 2.34s =======================
```

**Coverage Report**:
```bash
pytest tests/ --cov=app --cov-report=html
open htmlcov/index.html
```

---

## How Multi-Curator Fits In

### Current Schema (Before Multi-Curator)

**Entity** (already flexible):
```python
class Entity(BaseModel):
    entity_id: str
    name: str
    location: Location
    cuisine: Optional[str]
    price_level: Optional[int]
    google_place_id: Optional[str]
    source: str  # Already has source tracking
    created_at: datetime
    updated_at: datetime
```

**Curation** (needs extension):
```python
class Curation(BaseModel):
    curation_id: str
    entity_id: str
    concepts: List[str]
    category: Optional[str]
    notes: Optional[str]
    rating: Optional[int]
    source: str  # ✅ Already exists
    created_at: datetime
    updated_at: datetime
```

### Extended Schema (Sprint 2)

**Add these fields to Curation**:
```python
class Curation(BaseModel):
    # ... existing fields ...
    
    # NEW: Curator ownership
    curator_id: str
    curator_name: str
    curator_email: Optional[str] = ""
    curator_avatar: Optional[str] = ""
    
    # NEW: Forking support
    forked_from: Optional[str] = None
    original_curator: Optional[str] = None
    fork_count: int = 0
    
    # NEW: Permissions
    visibility: str = "public"  # public, private, unlisted
    allow_fork: bool = True
    
    # Existing
    source: str  # curator, automated, forked
```

**Add these fields to Entity**:
```python
class Entity(BaseModel):
    # ... existing fields ...
    
    # NEW: Entity type for multi-entity support
    entity_type: str = "restaurant"  # restaurant, hotel, event, bar
    
    # NEW: Flexible attributes
    attributes: Optional[Dict[str, Any]] = {}
```

### Migration Strategy

**Step 1**: Update Pydantic models (add fields with defaults)  
**Step 2**: Run migration script to add fields to existing documents  
**Step 3**: Update indexes for new queries  
**Step 4**: Run tests (should still pass)  
**Step 5**: Update V3DataTransformer to handle new fields

**Migration Script** (`migrations/add_multi_curator.py`):
```python
async def migrate():
    # Add entity_type to entities
    await db.entities.update_many(
        {"entity_type": {"$exists": False}},
        {"$set": {"entity_type": "restaurant", "attributes": {}}}
    )
    
    # Add curator fields to curations
    await db.curations.update_many(
        {"curator_id": {"$exists": False}},
        {"$set": {
            "curator_id": "LEGACY_CURATOR",
            "curator_name": "Unknown Curator",
            "curator_email": "",
            "visibility": "public",
            "allow_fork": True,
            "forked_from": None,
            "fork_count": 0
        }}
    )
    
    # Add indexes
    await db.curations.create_index([("curator_id", 1), ("entity_id", 1)])
    await db.curations.create_index([("entity_id", 1), ("curator_id", 1)])
    await db.curations.create_index([("visibility", 1)])
    
    print("✅ Migration complete")
```

---

## Current API Endpoints

### Entities

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v3/entities` | Create entity |
| GET | `/api/v3/entities/{id}` | Get entity by ID |
| PUT | `/api/v3/entities/{id}` | Update entity |
| DELETE | `/api/v3/entities/{id}` | Delete entity |
| GET | `/api/v3/entities` | List entities (with pagination) |
| POST | `/api/v3/entities/bulk` | Bulk create/update |

### Curations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v3/curations` | Create curation |
| GET | `/api/v3/curations/{id}` | Get curation by ID |
| PUT | `/api/v3/curations/{id}` | Update curation |
| DELETE | `/api/v3/curations/{id}` | Delete curation |
| GET | `/api/v3/curations` | List curations (with filters) |
| POST | `/api/v3/curations/bulk` | Bulk create/update |

### Health & Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v3/health` | API health check |
| GET | `/api/v3/status` | Database connection status |

---

## New Endpoints for Multi-Curator (Sprint 3)

### Authentication

```
POST   /api/v3/auth/google          # Google OAuth callback
POST   /api/v3/auth/logout          # Logout
GET    /api/v3/auth/me              # Current user info
```

### Curators

```
GET    /api/v3/curators/{id}                  # Get curator profile
GET    /api/v3/curators/{id}/curations        # Get curator's curations
PUT    /api/v3/curators/{id}                  # Update profile
```

### Forking

```
POST   /api/v3/curations/{id}/fork            # Fork curation
GET    /api/v3/curations/{id}/forks           # Get all forks
```

### Suggestions

```
POST   /api/v3/suggestions                    # Create suggestion
GET    /api/v3/suggestions?status=pending     # Get pending
PUT    /api/v3/suggestions/{id}/approve       # Approve
PUT    /api/v3/suggestions/{id}/reject        # Reject
```

---

## Running API V3 Locally

### Start Development Server

```bash
cd concierge-api-v3

# Activate virtual environment
source venv/bin/activate

# Install dependencies (if needed)
pip install -r requirements.txt

# Start server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Server runs at**: `http://localhost:8000`  
**API docs**: `http://localhost:8000/docs` (Swagger UI)  
**Alternative docs**: `http://localhost:8000/redoc`

### Environment Variables

Create `.env` file:
```bash
MONGODB_URI=mongodb+srv://...
DATABASE_NAME=concierge
GOOGLE_OAUTH_CLIENT_ID=...  # For Sprint 3
GOOGLE_OAUTH_SECRET=...     # For Sprint 3
```

### Docker Deployment

```bash
# Build image
docker build -t concierge-api-v3 .

# Run container
docker run -p 8000:8000 \
  -e MONGODB_URI="mongodb+srv://..." \
  concierge-api-v3
```

---

## Monitoring & Debugging

### Check API Health

```bash
curl http://localhost:8000/api/v3/health
# Response: {"status": "healthy", "database": "connected"}
```

### View Logs

```bash
# Development (console output)
uvicorn main:app --reload --log-level debug

# Production (Docker logs)
docker logs concierge-api-v3 -f
```

### Database Access

**MongoDB Atlas Dashboard**: https://cloud.mongodb.com  
**Collections**:
- `entities` - Restaurant/entity data
- `curations` - Curator opinions
- `conceptSuggestions` - AI suggestions (Sprint 2)

---

## Performance Characteristics

**Entity Creation**: ~50ms average  
**Entity Query**: ~20ms with indexes  
**Bulk Sync (100 entities)**: ~2-3 seconds  
**Concurrent Requests**: Handles 100+ req/sec

**Indexes** (current):
```python
# Entities
entities.google_place_id  # Unique lookup
entities.source            # Filter by source
entities.created_at        # Sorting

# Curations
curations.entity_id        # Get curations for entity
curations.source           # Filter curator vs automated
curations.created_at       # Sorting
```

---

## Next Steps for Multi-Curator

### Sprint 2 (This Sprint)
1. ✅ Update Pydantic models (add curator fields with defaults)
2. ✅ Run migration script (backward compatible)
3. ✅ Update V3DataTransformer (handle new fields)
4. ✅ Test existing functionality (should still work)
5. ✅ Add new tests for multi-curator fields

### Sprint 3 (Next Sprint)
1. ✅ Add authentication endpoints (Google OAuth)
2. ✅ Add curator profile endpoints
3. ✅ Add forking endpoints
4. ✅ Implement permission checks (can only edit own curations)
5. ✅ Add WebSocket for real-time updates

---

## Troubleshooting

### "Cannot connect to MongoDB"
**Solution**: Check `.env` file has correct `MONGODB_URI`

### "Tests failing after schema change"
**Solution**: Run migration script, then re-run tests

### "Port 8000 already in use"
**Solution**: 
```bash
lsof -ti:8000 | xargs kill -9
```

### "Import errors when running tests"
**Solution**:
```bash
cd concierge-api-v3
source venv/bin/activate
export PYTHONPATH="${PYTHONPATH}:$(pwd)"
pytest tests/
```

---

## Summary

**API V3 Status**: ✅ Production-ready, stable, well-tested

**Multi-Curator Ready**: 🔧 Schema supports extension, minimal changes needed

**Integration**: ✅ V3DataTransformer already handles compatibility

**Next Action**: Extend Pydantic models → Run migration → Update tests

**Confidence Level**: 🟢 High - Existing tests ensure stability during migration

---

**Document Status**: Current  
**Last Test Run**: November 17, 2025 (28/28 passing)  
**API Version**: 1.0.0  
**Database**: MongoDB Atlas (production)
