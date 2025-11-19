# Concierge Collector V3 - Architecture & Implementation Plan

**Version:** 3.0.0  
**Date:** November 18, 2025  
**Status:** Planning Complete → Implementation Ready  

---

## 🎯 Executive Summary

Complete modernization of Concierge Collector frontend to work seamlessly with FastAPI V3 backend. No backward compatibility required - clean slate implementation following modern best practices.

### Key Objectives

1. **API V3 Integration**: Full integration with FastAPI + MongoDB backend
2. **Clean Architecture**: Entity-Curation model with proper separation of concerns
3. **Optimistic Locking**: Version-based conflict resolution with If-Match headers
4. **Modern Data Flow**: IndexedDB ↔ API V3 with bi-directional sync
5. **Remove Legacy**: Archive all obsolete code (PostgreSQL staging, old sync, etc.)

---

## 📊 Current State Analysis

### ✅ Completed (API V3 Backend)

- FastAPI 0.109.0 with Motor 3.3.2 (async MongoDB)
- 28/28 pytest tests passing (100% coverage)
- Entity-Curation architecture with metadata arrays
- Optimistic locking via version field + If-Match headers
- API key authentication (X-API-Key header)
- CORS configured, auto-reload enabled
- Background scripts (start-api.sh, stop-api.sh)

### ⚠️ Needs Migration (Collector Frontend)

| Component | Status | Action Required |
|-----------|--------|----------------|
| `config.js` | Partial | Update endpoints to /api/v3 prefix |
| `apiService.js` | Outdated | Implement V3 auth + optimistic locking |
| `dataStorage.js` | Old schema | Update to V3 entity/curation structure |
| `syncManager.js` | Broken | Complete rewrite for V3 |
| `V3DataTransformer.js` | ✅ Good | Already compatible |
| Old API docs | Obsolete | Archive to /archive/old-docs |

---

## 🏗️ V3 Architecture

### Data Model

```
┌─────────────────────────────────────────────────────────────┐
│                        MongoDB (Server)                       │
│  Collections: entities, curations, concepts                   │
│  - version field for optimistic locking                       │
│  - metadata[] for multiple data sources                       │
│  - data{} for flexible attributes                             │
└─────────────────────────────────────────────────────────────┘
                            ↕ HTTPS (FastAPI)
                    ┌──────────────────┐
                    │   API V3 Layer   │
                    │   /api/v3/*      │
                    │  - X-API-Key auth│
                    │  - If-Match ETag │
                    └──────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    IndexedDB (Client)                         │
│  Stores: entities, curations, sync_metadata                   │
│  - version field synced with server                           │
│  - sync_status: 'synced' | 'pending' | 'conflict'            │
│  - lastSyncedAt timestamp                                     │
└─────────────────────────────────────────────────────────────┘
```

### Entity Structure (V3)

```javascript
{
  entity_id: "uuid-v4",              // Client-generated ID
  type: "restaurant",                // restaurant | hotel | venue | bar | cafe
  name: "Restaurant Name",
  status: "active",                  // active | inactive | draft
  externalId: "ChIJxxxxx",          // Optional (Google Place ID, etc.)
  
  // Flexible data storage
  data: {
    location: {
      address: "123 Main St",
      city: "São Paulo",
      coordinates: { lat: -23.5, lng: -46.6 }
    },
    contacts: {
      phone: "+55 11 1234-5678",
      website: "https://example.com",
      email: "contact@example.com"
    },
    media: {
      photos: ["url1", "url2"],
      logo: "url"
    },
    attributes: {
      cuisine: ["Italian", "Contemporary"],
      priceRange: "$$$$",
      rating: 4.5
    }
  },
  
  // Multiple metadata sources
  metadata: [
    {
      type: "google_places",
      source: "google_places_api",
      importedAt: "2025-11-18T10:00:00Z",
      data: { place_id: "ChIJxxxxx", ... }
    },
    {
      type: "michelin",
      source: "michelin_guide",
      importedAt: "2025-11-18T11:00:00Z",
      data: { stars: 2, ... }
    }
  ],
  
  // Sync metadata
  sync: {
    serverId: 123,                   // Optional server ID
    status: "synced",                // pending | synced | conflict
    lastSyncedAt: "2025-11-18T12:00:00Z"
  },
  
  // Timestamps and versioning
  createdAt: "2025-11-18T10:00:00Z",
  updatedAt: "2025-11-18T12:00:00Z",
  version: 5,                        // For optimistic locking
  
  createdBy: { id: "user-uuid", name: "User Name" },
  updatedBy: { id: "user-uuid", name: "User Name" }
}
```

### Curation Structure (V3)

```javascript
{
  curation_id: "uuid-v4",            // Client-generated ID
  entity_id: "entity-uuid",          // Parent entity
  
  curator: {
    id: "curator-uuid",
    name: "Curator Name",
    role: "sommelier"                // Optional
  },
  
  content: {
    transcription: "Full audio transcription...",
    notes: "Additional notes...",
    highlights: ["Key point 1", "Key point 2"]
  },
  
  concepts: [
    {
      category: "Cuisine",
      value: "Italian",
      confidence: 0.95             // Optional AI confidence
    },
    {
      category: "Price Range",
      value: "$$$$",
      confidence: 0.85
    }
  ],
  
  media: {
    audio: "audio-uuid",           // Reference to audio file
    photos: ["photo-uuid-1"],      // References to photos
    duration: 180                  // Audio duration in seconds
  },
  
  status: "published",             // draft | published | archived
  
  // Timestamps and versioning
  createdAt: "2025-11-18T10:00:00Z",
  updatedAt: "2025-11-18T12:00:00Z",
  version: 3,
  
  sync: {
    serverId: 456,
    status: "synced",
    lastSyncedAt: "2025-11-18T12:00:00Z"
  }
}
```

---

## 🔌 API V3 Integration

### Endpoints (All with /api/v3 prefix)

#### System Endpoints
```
GET  /api/v3/info         - API info (no auth)
GET  /api/v3/health       - Health check (no auth)
```

#### Entity Endpoints
```
GET    /api/v3/entities              - List entities (filters: type, status, limit, offset)
POST   /api/v3/entities              - Create/upsert entity (X-API-Key required)
GET    /api/v3/entities/{id}         - Get single entity (no auth)
PATCH  /api/v3/entities/{id}         - Update entity (X-API-Key + If-Match required)
DELETE /api/v3/entities/{id}         - Delete entity (X-API-Key required)
GET    /api/v3/entities/search       - Search with filters
```

#### Curation Endpoints
```
GET    /api/v3/curations             - List curations (filters: entity_id, curator_id)
POST   /api/v3/curations             - Create curation (X-API-Key required)
GET    /api/v3/curations/{id}        - Get single curation (no auth)
PATCH  /api/v3/curations/{id}        - Update curation (X-API-Key + If-Match required)
DELETE /api/v3/curations/{id}        - Delete curation (X-API-Key required)
GET    /api/v3/curations/search      - Search with filters
GET    /api/v3/entities/{id}/curations - Get all curations for entity
```

#### Concepts Endpoint
```
POST   /api/v3/concepts/match        - Match concepts to categories (X-API-Key required)
```

#### AI Endpoints
```
POST   /api/v3/ai/transcribe         - Transcribe audio (X-API-Key required)
POST   /api/v3/ai/extract-concepts   - Extract concepts from text (X-API-Key required)
POST   /api/v3/ai/analyze-image      - Analyze image with GPT-4 Vision (X-API-Key required)
```

#### Places Endpoint
```
GET    /api/v3/places/search         - Search Google Places (X-API-Key required)
GET    /api/v3/places/details/{id}   - Get place details (X-API-Key required)
```

### Authentication

**API Key Header:**
```
X-API-Key: your-api-key-here
```

**Generate API Key:**
```bash
cd concierge-api-v3
python scripts/generate_api_key.py
```

### Optimistic Locking

**Update Flow:**
```javascript
// 1. GET entity to get current version
GET /api/v3/entities/123
Response: { entity_id: "123", version: 5, ... }

// 2. PATCH with If-Match header
PATCH /api/v3/entities/123
Headers: {
  "X-API-Key": "key",
  "If-Match": "5"          // Current version
}
Body: { name: "New Name" }

// 3. Success → version increments to 6
// 4. Conflict → 409 if version doesn't match
```

---

## 🔄 Sync Strategy

### Sync States

```javascript
// Sync status for each entity/curation
{
  local: { version: 5, updatedAt: "2025-11-18T12:00:00Z" },
  remote: { version: 5, updatedAt: "2025-11-18T12:00:00Z" },
  status: "synced" | "pending_push" | "pending_pull" | "conflict"
}
```

### Sync Flow

```
1. PULL (Server → Client)
   - GET /api/v3/entities?limit=100
   - GET /api/v3/curations?limit=100
   - Compare versions with local IndexedDB
   - Update local if server version > local version
   - Mark as "synced"

2. PUSH (Client → Server)
   - Find all local items with status="pending_push"
   - For each item:
     - POST (if new) or PATCH (if exists)
     - Include If-Match: version header for updates
     - Handle conflicts (409) → mark as "conflict"
   - Mark as "synced" on success

3. CONFLICT RESOLUTION
   - Show conflict UI to user
   - Options: Keep Local | Use Server | Merge
   - Manual resolution required
```

### Sync Manager Operations

```javascript
class SyncManagerV3 {
  // Pull changes from server
  async pullEntities()
  async pullCurations()
  
  // Push changes to server
  async pushEntities()
  async pushCurations()
  
  // Full sync (pull then push)
  async fullSync()
  
  // Conflict handling
  async resolveConflict(id, resolution)
  
  // Status tracking
  async getSyncStatus()
  async markAsSynced(id)
  async markAsPending(id)
}
```

---

## 📁 File Structure

### Files to Update

```
scripts/
├── config.js                      ⚠️ UPDATE endpoints
├── apiService.js                  ⚠️ REWRITE for V3
├── dataStorage.js                 ⚠️ UPDATE schema
├── syncManager.js                 ⚠️ REWRITE for V3
├── main.js                        ⚠️ UPDATE initialization
│
├── services/
│   ├── V3DataTransformer.js      ✅ Already compatible
│   └── googlePlaces/             ✅ Good
│
└── modules/
    ├── entityModule.js           ⚠️ CREATE (new UI for entities)
    ├── curationModule.js         ⚠️ UPDATE (adapt to V3)
    └── placesModule.js           ✅ Good (use Places API endpoint)
```

### Files to Archive

```
archive/
├── old-api-integration/
│   ├── syncManager_broken.js     ← Move from scripts/
│   ├── API_INTEGRATION_COMPLETE.md  ← Old API docs
│   └── old API references
│
└── old-modules/
    └── michelinStagingModule.js  ← Already archived
```

---

## 🛠️ Implementation Steps

### Phase 1: Configuration & Core Services (Day 1)

1. **Update config.js**
   - Change all endpoints to `/api/v3` prefix
   - Remove obsolete endpoints
   - Add X-API-Key configuration

2. **Rewrite apiService.js**
   - Implement X-API-Key authentication
   - Add If-Match header support
   - Handle version conflicts (409)
   - Update all CRUD methods

3. **Update dataStorage.js**
   - Update schema to V3 structure
   - Add version field to all objects
   - Add sync metadata
   - Migration from old schema (if needed)

### Phase 2: Sync Manager (Day 2)

4. **Rewrite syncManager.js**
   - Implement pull operations
   - Implement push operations
   - Version comparison logic
   - Conflict detection and resolution

5. **Test sync flow**
   - Create entity locally → push
   - Create entity on server → pull
   - Update both → detect conflict
   - Resolve conflicts manually

### Phase 3: UI Updates (Day 3)

6. **Update modules**
   - entityModule.js - new UI for entity management
   - curationModule.js - adapt to V3 structure
   - Update forms to match V3 schema

7. **Test end-to-end**
   - Create/edit/delete entities
   - Create/edit/delete curations
   - Sync with server
   - Handle conflicts

### Phase 4: Cleanup (Day 4)

8. **Archive obsolete code**
   - Move old API integration code
   - Move broken sync manager
   - Update documentation

9. **Final testing**
   - Full sync cycle
   - Offline mode
   - Conflict resolution
   - Performance testing

---

## 🎯 Success Criteria

- ✅ All CRUD operations work with API V3
- ✅ Optimistic locking prevents data loss
- ✅ Sync works bi-directionally
- ✅ Conflicts are detected and resolvable
- ✅ No obsolete code in main codebase
- ✅ All modules follow ModuleWrapper pattern
- ✅ Clean separation of concerns
- ✅ IndexedDB schema matches MongoDB
- ✅ Comprehensive error handling
- ✅ Full test coverage

---

## 📝 Notes

### No Backward Compatibility

- Clean break from old API
- Archive all obsolete code
- Fresh start with V3 architecture

### API Key Management

- Store in localStorage
- Prompt user if missing
- Validate on app start

### Offline Support

- Continue working without server
- Queue changes locally
- Sync when connection restored
- Handle conflicts gracefully

### Performance

- Lazy load entities/curations
- Pagination for large lists
- Cache API responses
- Debounce search queries

---

## 🔗 Related Documentation

- [API V3 README](../concierge-api-v3/README.md)
- [V3 Data Transformer](./V3DataTransformer.md)
- [Collector Modernization Plan](./COLLECTOR_MODERNIZATION_PLAN.md)
- [Project Status](../PROJECT_STATUS.md)
