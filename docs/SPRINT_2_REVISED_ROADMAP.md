# Sprint 2: Entity Automation + Multi-Curator Foundation

**Duration**: Days 4-8 (5 days)  
**Status**: Ready for Implementation  
**Created**: November 17, 2025  
**Sprint Focus**: Entity automation, supervised suggestions, multi-curator data model

---

## Sprint 2 Overview

This sprint transforms Concierge Collector's foundation to support:

1. **Entity-Agnostic Architecture**: Database ready for restaurants, hotels, events, etc
2. **Multi-Curator Model**: Ownership, forking, attribution built into data model
3. **Quick Entity Import**: "Import Nearby" button adds entities in bulk
4. **Supervised AI Assistance**: AI suggests, curator approves
5. **Background Automation**: Auto-curations for Concierge app (separate from curator workflow)

**Critical Architecture Decisions**:
- ✅ Entity population can be fully automated
- ✅ Curation creation MUST have curator supervision
- ✅ AI suggestions are assistants, not replacements
- ✅ Clear separation: "My Work" vs "Others' Work"
- ✅ Fork model: Copy and edit with attribution

**Related Documents**:
- [Multi-Curator Architecture](./MULTI_CURATOR_ARCHITECTURE.md) - Full architectural design
- [Sprint 1 Summary](./SPRINT_1_COMPLETE_SUMMARY.md) - Previous sprint context

---

## API V3 Integration

### Current API V3 Status

**✅ Confirmed Working**: 28/28 tests passing (100% coverage)  
**Backend**: FastAPI 0.109.0 + MongoDB Atlas  
**Location**: `/concierge-api-v3/`

### How Sprint 2 Integrates with API V3

#### 1. Local-First Architecture (Sprint 2)

During Sprint 2, we focus on **IndexedDB as primary storage**:

```
┌─────────────────────────────────────────────┐
│         Concierge Collector (Frontend)      │
│                                             │
│  ┌────────────────────────────────────┐   │
│  │       IndexedDB (Primary)          │   │
│  │  - entities                        │   │
│  │  - curations (with curator fields) │   │
│  │  - conceptSuggestions             │   │
│  └────────────┬───────────────────────┘   │
│               │                             │
│  ┌────────────▼───────────────────────┐   │
│  │    V3DataTransformer              │   │
│  │    (Schema compatibility layer)    │   │
│  └────────────┬───────────────────────┘   │
│               │                             │
│  ┌────────────▼───────────────────────┐   │
│  │    Manual Sync (Sprint 2)         │   │
│  │    "Push to Server" button         │   │
│  └────────────┬───────────────────────┘   │
└───────────────┼─────────────────────────────┘
                │
                │ HTTP REST API
                │
┌───────────────▼─────────────────────────────┐
│         API V3 (FastAPI + MongoDB)          │
│                                             │
│  - POST /api/v3/entities                   │
│  - POST /api/v3/curations                  │
│  - GET  /api/v3/curators/{id}/curations    │
└─────────────────────────────────────────────┘
```

**Why Local-First?**
- ✅ Offline capability (curators work without internet)
- ✅ Instant UI updates (no network latency)
- ✅ Simpler Sprint 2 scope (no conflict resolution yet)
- ✅ API V3 stays stable (no breaking changes needed)

#### 2. Schema Compatibility (V3DataTransformer)

**Already Implemented** (Sprint 1, Day 3):

```javascript
// scripts/services/V3DataTransformer.js

// Frontend entity → API V3 entity
const apiEntity = V3DataTransformer.entityToV3({
  id: "local_123",
  name: "Restaurant Name",
  entityType: "restaurant",  // NEW in Sprint 2
  location: { lat: -23.5505, lng: -46.6333 },
  attributes: { cuisine: "Italian" }  // NEW: flexible
});

// POST to API V3
await fetch('/api/v3/entities', {
  method: 'POST',
  body: JSON.stringify(apiEntity)
});
```

**Sprint 2 Extensions**:

```javascript
// Add curator fields to transformation
curationToV3(curation) {
  return {
    // ... existing fields ...
    curator_id: curation.curatorId,           // NEW
    curator_name: curation.curatorName,       // NEW
    forked_from: curation.forkedFrom,         // NEW
    visibility: curation.visibility,          // NEW
    source: curation.source
  };
}
```

#### 3. API V3 Schema Updates (Minimal)

**What needs to change in API V3**:

```python
# concierge-api-v3/app/models/entity.py

class Entity(BaseModel):
    entity_id: str
    entity_type: str = "restaurant"  # NEW: default to restaurant
    name: str
    location: Location
    # ... existing fields ...
    attributes: Optional[Dict[str, Any]] = {}  # NEW: flexible attributes
```

```python
# concierge-api-v3/app/models/curation.py

class Curation(BaseModel):
    curation_id: str
    entity_id: str
    entity_type: str  # NEW: denormalized
    
    # NEW: Curator fields
    curator_id: str
    curator_name: str
    curator_email: Optional[str] = ""
    
    # Existing fields
    concepts: List[str]
    category: Optional[str]
    notes: Optional[str]
    
    # NEW: Forking
    forked_from: Optional[str] = None
    original_curator: Optional[str] = None
    
    # NEW: Permissions
    visibility: str = "public"
    allow_fork: bool = True
    
    source: str  # Already exists
```

**Migration Script** (`concierge-api-v3/migrations/add_multi_curator.py`):

```python
async def migrate_to_multi_curator():
    """Add multi-curator fields to existing documents"""
    
    # Update entities
    await db.entities.update_many(
        {"entity_type": {"$exists": False}},
        {"$set": {"entity_type": "restaurant"}}
    )
    
    # Update curations
    await db.curations.update_many(
        {"curator_id": {"$exists": False}},
        {"$set": {
            "curator_id": "LEGACY_CURATOR",
            "curator_name": "Unknown",
            "curator_email": "",
            "visibility": "public",
            "allow_fork": True,
            "forked_from": None
        }}
    )
    
    # Add indexes
    await db.curations.create_index([("curator_id", 1), ("entity_id", 1)])
    await db.curations.create_index([("entity_id", 1), ("curator_id", 1)])
```

#### 4. Testing API V3 Changes

**Run existing tests** (should still pass):
```bash
cd concierge-api-v3
source venv/bin/activate
pytest tests/ -v
```

**Add new multi-curator tests**:
```python
# tests/test_multi_curator.py

async def test_create_curation_with_curator():
    """Test creating curation with curator attribution"""
    curation = {
        "entity_id": "entity_123",
        "curator_id": "curator_1",
        "curator_name": "João Silva",
        "concepts": ["romantic"],
        "source": "curator",
        "visibility": "public"
    }
    
    response = await client.post("/api/v3/curations", json=curation)
    assert response.status_code == 201
    assert response.json()["curator_id"] == "curator_1"

async def test_get_curations_by_curator():
    """Test filtering curations by curator"""
    response = await client.get("/api/v3/curators/curator_1/curations")
    assert response.status_code == 200
    assert all(c["curator_id"] == "curator_1" for c in response.json())

async def test_fork_curation():
    """Test forking another curator's curation"""
    original_id = "curation_123"
    
    response = await client.post(f"/api/v3/curations/{original_id}/fork")
    assert response.status_code == 201
    
    forked = response.json()
    assert forked["forked_from"] == original_id
    assert forked["source"] == "forked"
```

#### 5. Manual Sync UI (Sprint 2)

**Simple sync button** (real-time sync comes in Sprint 3):

```html
<!-- index.html -->
<div class="sync-panel">
  <button id="sync-to-server">
    ☁️ Push to Server
  </button>
  <span id="sync-status">Last sync: Never</span>
</div>
```

```javascript
// scripts/modules/syncModule.js

async function syncToServer() {
  showNotification("Syncing to server...");
  
  try {
    // 1. Get all local entities not yet synced
    const entities = await db.entities
      .where("synced")
      .equals(0)
      .toArray();
    
    // 2. Transform and push to API V3
    for (const entity of entities) {
      const v3Entity = V3DataTransformer.entityToV3(entity);
      
      await fetch('http://localhost:8000/api/v3/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v3Entity)
      });
      
      // Mark as synced
      await db.entities.update(entity.id, { synced: 1 });
    }
    
    // 3. Same for curations
    const curations = await db.curations
      .where("synced")
      .equals(0)
      .toArray();
    
    for (const curation of curations) {
      const v3Curation = V3DataTransformer.curationToV3(curation);
      
      await fetch('http://localhost:8000/api/v3/curations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v3Curation)
      });
      
      await db.curations.update(curation.id, { synced: 1 });
    }
    
    showNotification(`✅ Synced ${entities.length} entities, ${curations.length} curations`);
    document.getElementById('sync-status').textContent = 
      `Last sync: ${new Date().toLocaleString()}`;
    
  } catch (error) {
    showError(`Sync failed: ${error.message}`);
  }
}
```

### Sprint 2 vs Sprint 3 Sync Strategy

**Sprint 2 (Manual Sync)**:
- ✅ IndexedDB is source of truth
- ✅ Manual "Push to Server" button
- ✅ One-way sync (local → API V3)
- ✅ No conflict resolution needed
- ✅ Offline-first workflow

**Sprint 3 (Real-Time Sync)**:
- ✅ SyncManager with bidirectional sync
- ✅ Automatic background sync
- ✅ Conflict resolution (last-write-wins)
- ✅ Multi-curator updates (see others' changes)
- ✅ WebSocket for real-time notifications

### API Endpoints Used in Sprint 2

**Entity Management**:
```
POST   /api/v3/entities              # Create entity
GET    /api/v3/entities/{id}         # Get entity
PUT    /api/v3/entities/{id}         # Update entity
GET    /api/v3/entities?type=restaurant  # Filter by type
```

**Curation Management**:
```
POST   /api/v3/curations             # Create curation
GET    /api/v3/curations/{id}        # Get curation
PUT    /api/v3/curations/{id}        # Update curation
GET    /api/v3/curations?entity_id=X # Get all for entity
```

**Concept Suggestions** (new):
```
POST   /api/v3/suggestions           # Create suggestion
GET    /api/v3/suggestions?status=pending  # Get pending
PUT    /api/v3/suggestions/{id}/approve    # Approve suggestion
```

---

## Data Model Changes (Sprint 2 Foundation)

### New Entity Schema (Entity-Agnostic)

```javascript
// entities table
{
  entity_id: "uuid",
  entity_type: "restaurant",      // NEW: 'restaurant', 'hotel', 'event', etc
  name: "Entity Name",
  
  // Common to all entity types
  location: { 
    lat: -23.5505,
    lng: -46.6333,
    address: "Rua Example, 123",
    city: "São Paulo",
    country: "Brazil"
  },
  
  contacts: {
    phone: "+55 11 1234-5678",
    website: "https://example.com",
    email: "contact@example.com"
  },
  
  media: {
    photos: ["url1", "url2"],
    videos: []
  },
  
  // Type-specific attributes (flexible JSON)
  attributes: {
    // For restaurants:
    cuisine: "Italian",
    price_level: 3,
    opening_hours: {...},
    
    // Future: For hotels
    // star_rating: 4,
    // room_count: 120,
    
    // Future: For events
    // start_date: "2025-12-01",
    // duration_hours: 3
  },
  
  // Metadata
  google_place_id: "ChIJ...",      // Source reference
  source: "google_places",         // google_places, manual, import
  createdAt: "2025-11-17T10:00:00Z",
  updatedAt: "2025-11-17T10:00:00Z"
}
```

### New Curation Schema (Multi-Curator)

```javascript
// curations table
{
  curation_id: "uuid",
  entity_id: "uuid",              // Which entity this curates
  entity_type: "restaurant",      // Denormalized for fast queries
  
  // Ownership (NEW in Sprint 2)
  curator_id: "google-oauth-id",  // Owner of this curation
  curator_name: "João Silva",     // Display name
  curator_email: "joao@example.com",
  curator_avatar: "https://...",  // Profile picture
  
  // Content
  concepts: ["romantic", "cozy"],
  category: "hidden-gem",
  notes: "Perfect for date night. Ask for table by the window.",
  rating: 5,
  photos: ["photo1_url", "photo2_url"],
  
  // Forking & Attribution (NEW in Sprint 2)
  forked_from: null,              // curation_id if this is a fork
  fork_count: 0,                  // How many forked from this
  original_curator: null,         // If forked, original author's name
  
  // Permissions (NEW in Sprint 2)
  visibility: "public",           // public, private, unlisted
  allow_fork: true,               // Can others fork this?
  
  // Provenance
  source: "curator",              // curator, automated, forked
  createdAt: "2025-11-17T10:00:00Z",
  updatedAt: "2025-11-17T10:00:00Z"
}
```

### Concept Suggestions Schema (Supervised AI)

```javascript
// conceptSuggestions table
{
  suggestion_id: "uuid",
  entity_id: "uuid",
  entity_type: "restaurant",
  
  // Suggestion content
  suggested_concepts: ["romantic", "cozy"],
  confidence: 0.85,               // 0-1 confidence score
  reasoning: "Based on 12 reviews mentioning: intimate, date night, candlelit",
  
  // Review status
  status: "pending_review",       // pending_review, approved, rejected
  reviewed_by: null,              // curator_id who reviewed
  reviewed_at: null,
  
  // If rejected
  rejected_reason: null,
  
  // Metadata
  source: "automated",            // Always 'automated'
  createdAt: "2025-11-17T10:00:00Z"
}
```

---

## Day 4: Data Model Migration + Quick Import Button

### Objectives
1. Update IndexedDB schema to v4 with multi-curator support
2. Migrate existing data to new schema
3. Add "Import Nearby" quick action button
4. Implement PlacesAutomation service for entity import

### 4.1: Schema Migration

**File**: `scripts/services/DataStorage.js`

**New IndexedDB Schema**:
```javascript
db.version(4).stores({
  entities: `
    ++id,
    google_place_id,
    entity_type,
    source,
    [entity_type+city],
    createdAt
  `,
  
  curations: `
    ++id,
    entity_id,
    curator_id,
    [curator_id+entity_id],         // My curations for specific entity
    [entity_id+curator_id],         // All curations for entity
    source,
    forked_from,
    visibility,
    createdAt
  `,
  
  conceptSuggestions: `
    ++id,
    entity_id,
    [entity_id+status],             // Pending suggestions per entity
    status,
    source,
    createdAt
  `,
  
  importQueue: `
    ++id,
    status,
    type,
    createdAt,
    processedAt
  `
});
```

**Migration Function**:
```javascript
async function migrateToV4() {
  console.log("🔄 Migrating to IndexedDB v4 (Multi-Curator)...");
  
  // 1. Add entity_type to all entities
  const entities = await db.entities.toArray();
  for (const entity of entities) {
    if (!entity.entity_type) {
      await db.entities.update(entity.id, {
        entity_type: "restaurant"     // Default
      });
    }
  }
  
  // 2. Add curator metadata to curations
  const curations = await db.curations.toArray();
  for (const curation of curations) {
    if (!curation.curator_id) {
      await db.curations.update(curation.id, {
        curator_id: "LEGACY_CURATOR",
        curator_name: "Unknown Curator",
        curator_email: "",
        source: curation.source || "curator",
        visibility: "public",
        allow_fork: true,
        forked_from: null,
        fork_count: 0
      });
    }
  }
  
  console.log("✅ Migration complete");
}
```

### 4.2: Quick Import Button

**File**: `index.html` (or main app view)

**UI Addition**:
```html
<div class="quick-actions">
  <button id="import-nearby-btn" class="primary-action">
    📍 Import 20 Nearby Restaurants
  </button>
  <span class="hint">Adds entities only, no curations</span>
</div>
```

**Handler**:
```javascript
// File: scripts/modules/placesModule.js

async function handleQuickImportNearby() {
  const radius = 5000; // 5km
  const maxResults = 20;
  
  showLoadingModal("Searching nearby restaurants...");
  
  try {
    // 1. Get user location
    const location = await getUserLocation();
    
    // 2. Search Google Places
    const places = await PlacesService.searchNearby(
      location.lat,
      location.lng,
      radius,
      maxResults
    );
    
    // 3. Import as entities (automated)
    const imported = await PlacesAutomation.autoImportEntities(places);
    
    // 4. Queue concept suggestions (background)
    await ConceptSuggester.queueSuggestionsFor(imported.entities);
    
    hideLoadingModal();
    showNotification(
      `✅ Imported ${imported.count} restaurants. ` +
      `Skipped ${imported.duplicates} duplicates.`
    );
    
    // 5. Refresh entity list
    await EntityManager.refresh();
    
  } catch (error) {
    hideLoadingModal();
    showError(`Import failed: ${error.message}`);
  }
}
```

### 4.3: PlacesAutomation Service

**File**: `scripts/services/googlePlaces/PlacesAutomation.js`

```javascript
/**
 * PlacesAutomation.js
 * 
 * Orchestrates automated entity import from Google Places.
 * 
 * CRITICAL: This service creates ENTITIES ONLY.
 * Never creates curations automatically.
 * 
 * Dependencies:
 * - PlacesService (Google Places API)
 * - PlacesFormatter (Data transformation)
 * - DataStorage (Entity persistence)
 */

const PlacesAutomation = (function() {
  'use strict';
  
  /**
   * Auto-import entities from Google Places results
   * 
   * @param {Array} places - Google Places API results
   * @returns {Object} { count, duplicates, entities }
   */
  async function autoImportEntities(places) {
    let imported = 0;
    let duplicates = 0;
    const entities = [];
    
    for (const place of places) {
      // Check if already exists
      const isDuplicate = await this.checkDuplicate(place);
      
      if (isDuplicate) {
        duplicates++;
        continue;
      }
      
      // Transform to entity
      const entity = PlacesFormatter.toEntity(place);
      entity.entity_type = "restaurant";  // Hardcoded for now
      entity.source = "google_places";
      
      // Save entity
      const entityId = await db.entities.add(entity);
      entities.push({ ...entity, id: entityId });
      imported++;
    }
    
    return { count: imported, duplicates, entities };
  }
  
  /**
   * Check if place already exists in database
   * 
   * Uses fuzzy matching on name + location
   */
  async function checkDuplicate(place) {
    // Exact match by Google Place ID
    if (place.place_id) {
      const exact = await db.entities
        .where("google_place_id")
        .equals(place.place_id)
        .first();
      
      if (exact) return true;
    }
    
    // Fuzzy match by name + location (within 100m)
    const similar = await this.findSimilarEntities(
      place.name,
      place.geometry.location
    );
    
    return similar.length > 0;
  }
  
  /**
   * Find similar entities by name and location
   * 
   * @param {string} name - Entity name
   * @param {Object} location - { lat, lng }
   * @returns {Array} Similar entities
   */
  async function findSimilarEntities(name, location) {
    const allEntities = await db.entities.toArray();
    const threshold = 0.8; // 80% similarity
    const maxDistance = 0.1; // ~100 meters
    
    return allEntities.filter(entity => {
      // Name similarity
      const similarity = this.stringSimilarity(
        name.toLowerCase(),
        entity.name.toLowerCase()
      );
      
      // Distance calculation
      const distance = this.calculateDistance(
        location.lat, location.lng,
        entity.location.lat, entity.location.lng
      );
      
      return similarity >= threshold && distance <= maxDistance;
    });
  }
  
  /**
   * Calculate Levenshtein distance similarity
   */
  function stringSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }
  
  function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }
  
  /**
   * Calculate distance between two coordinates (Haversine)
   */
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
  
  // Public API
  return {
    autoImportEntities,
    checkDuplicate,
    findSimilarEntities,
    stringSimilarity,
    levenshteinDistance,
    calculateDistance
  };
})();
```

**Estimated Effort**: 3 hours

---

## Day 5: Background Processing + Progress UI

### Objectives
1. Move entity import to Web Worker (non-blocking)
2. Add progress tracking UI
3. Implement import queue system
4. Handle errors gracefully

### 5.1: Import Worker

**File**: `scripts/workers/importWorker.js`

```javascript
/**
 * importWorker.js
 * 
 * Background worker for processing entity imports
 * without blocking UI thread.
 */

self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;
  
  switch (type) {
    case 'IMPORT_ENTITIES':
      await handleImport(payload);
      break;
      
    case 'CANCEL_IMPORT':
      // Handle cancellation
      break;
  }
});

async function handleImport({ places, options }) {
  let processed = 0;
  const total = places.length;
  
  for (const place of places) {
    try {
      // Transform to entity
      const entity = transformPlace(place);
      
      // Post progress
      self.postMessage({
        type: 'PROGRESS',
        payload: {
          processed: ++processed,
          total,
          current: entity.name
        }
      });
      
      // Simulate processing time
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Post success
      self.postMessage({
        type: 'ENTITY_IMPORTED',
        payload: entity
      });
      
    } catch (error) {
      self.postMessage({
        type: 'ERROR',
        payload: {
          place: place.name,
          error: error.message
        }
      });
    }
  }
  
  self.postMessage({
    type: 'COMPLETE',
    payload: { total: processed }
  });
}

function transformPlace(place) {
  // Transform logic (PlacesFormatter equivalent)
  return {
    name: place.name,
    location: place.geometry.location,
    // ... etc
  };
}
```

### 5.2: Progress UI Component

**File**: `scripts/components/ImportProgressModal.js`

```html
<div id="import-progress-modal" class="modal">
  <div class="modal-content">
    <h3>Importing Entities</h3>
    
    <div class="progress-bar">
      <div class="progress-fill" style="width: 0%"></div>
    </div>
    
    <p class="progress-text">
      Processing <span id="current-entity">...</span>
      (<span id="progress-count">0</span>/<span id="progress-total">0</span>)
    </p>
    
    <div class="import-stats">
      <span class="stat">
        <span class="stat-value" id="imported-count">0</span>
        Imported
      </span>
      <span class="stat">
        <span class="stat-value" id="duplicate-count">0</span>
        Duplicates
      </span>
      <span class="stat">
        <span class="stat-value" id="error-count">0</span>
        Errors
      </span>
    </div>
    
    <button id="cancel-import" class="secondary">Cancel</button>
  </div>
</div>
```

**JavaScript**:
```javascript
const ImportProgressModal = (function() {
  let worker;
  let isActive = false;
  
  function show(places) {
    isActive = true;
    document.getElementById('import-progress-modal').style.display = 'block';
    
    // Initialize worker
    worker = new Worker('scripts/workers/importWorker.js');
    
    worker.addEventListener('message', handleWorkerMessage);
    
    worker.postMessage({
      type: 'IMPORT_ENTITIES',
      payload: { places }
    });
  }
  
  function handleWorkerMessage(event) {
    const { type, payload } = event.data;
    
    switch (type) {
      case 'PROGRESS':
        updateProgress(payload);
        break;
        
      case 'ENTITY_IMPORTED':
        incrementImported();
        break;
        
      case 'ERROR':
        incrementErrors();
        break;
        
      case 'COMPLETE':
        handleComplete(payload);
        break;
    }
  }
  
  function updateProgress({ processed, total, current }) {
    const percentage = (processed / total) * 100;
    document.querySelector('.progress-fill').style.width = `${percentage}%`;
    document.getElementById('current-entity').textContent = current;
    document.getElementById('progress-count').textContent = processed;
    document.getElementById('progress-total').textContent = total;
  }
  
  function incrementImported() {
    const el = document.getElementById('imported-count');
    el.textContent = parseInt(el.textContent) + 1;
  }
  
  function incrementErrors() {
    const el = document.getElementById('error-count');
    el.textContent = parseInt(el.textContent) + 1;
  }
  
  function handleComplete({ total }) {
    worker.terminate();
    isActive = false;
    
    setTimeout(() => {
      hide();
      showNotification(`✅ Import complete! ${total} entities added.`);
    }, 1000);
  }
  
  function hide() {
    document.getElementById('import-progress-modal').style.display = 'none';
  }
  
  return { show, hide };
})();
```

**Estimated Effort**: 3 hours

---

## Day 6: Concept Suggester + Supervised Workflow

### Objectives
1. Create ConceptSuggester service (AI-powered)
2. Generate concept suggestions automatically
3. Build suggestion review UI
4. Implement approval workflow

### 6.1: ConceptSuggester Service

**File**: `scripts/services/ai/ConceptSuggester.js`

```javascript
/**
 * ConceptSuggester.js
 * 
 * AI-powered concept suggestion system.
 * Generates concept suggestions for curator review.
 * 
 * CRITICAL: Never creates curations automatically.
 * Only creates SUGGESTIONS for curator approval.
 */

const ConceptSuggester = (function() {
  const OPENAI_API_KEY = config.openaiKey;
  const MODEL = "gpt-4-turbo-preview";
  
  /**
   * Queue concept suggestions for entities
   */
  async function queueSuggestionsFor(entities) {
    for (const entity of entities) {
      // Check if suggestions already exist
      const existing = await db.conceptSuggestions
        .where("entity_id")
        .equals(entity.id)
        .first();
      
      if (existing) continue;
      
      // Generate suggestions (background)
      setTimeout(() => this.generateSuggestion(entity), 1000);
    }
  }
  
  /**
   * Generate concept suggestion for entity
   */
  async function generateSuggestion(entity) {
    try {
      const analysis = await this.analyzeEntity(entity);
      
      // Save as suggestion (not curation!)
      await db.conceptSuggestions.add({
        entity_id: entity.id,
        entity_type: entity.entity_type,
        suggested_concepts: analysis.concepts,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        status: "pending_review",
        source: "automated",
        createdAt: new Date()
      });
      
      // Notify curator (optional)
      EventBus.emit('suggestion:created', {
        entity: entity.name,
        concepts: analysis.concepts
      });
      
    } catch (error) {
      console.error('Suggestion generation failed:', error);
    }
  }
  
  /**
   * Analyze entity using OpenAI
   */
  async function analyzeEntity(entity) {
    const prompt = `
Analyze this restaurant and suggest 2-3 concept tags:

Restaurant: ${entity.name}
Cuisine: ${entity.attributes.cuisine || 'Unknown'}
Price: ${entity.attributes.price_level || 'Unknown'}
Location: ${entity.location.city}

Available concepts:
- romantic
- family-friendly
- business
- casual
- upscale
- hidden-gem
- trendy
- traditional
- cozy
- lively

Return JSON:
{
  "concepts": ["concept1", "concept2"],
  "confidence": 0.85,
  "reasoning": "Brief explanation"
}
`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      })
    });
    
    const data = await response.json();
    const analysis = JSON.parse(data.choices[0].message.content);
    
    return analysis;
  }
  
  /**
   * Approve suggestion and create curation
   * 
   * CRITICAL: This is where curator supervision happens.
   * Suggestion becomes curation ONLY when curator approves.
   */
  async function approveSuggestion(suggestionId) {
    const suggestion = await db.conceptSuggestions.get(suggestionId);
    const curator = await this.getCurrentCurator();
    
    // Create REAL curation (with curator attribution)
    await db.curations.add({
      entity_id: suggestion.entity_id,
      entity_type: suggestion.entity_type,
      curator_id: curator.id,
      curator_name: curator.name,
      curator_email: curator.email,
      concepts: suggestion.suggested_concepts,
      source: "curator",  // Human-approved (not automated!)
      visibility: "public",
      allow_fork: true,
      createdAt: new Date()
    });
    
    // Mark suggestion as approved
    await db.conceptSuggestions.update(suggestionId, {
      status: "approved",
      reviewed_by: curator.id,
      reviewed_at: new Date()
    });
    
    EventBus.emit('curation:created', { suggestionId });
  }
  
  /**
   * Reject suggestion
   */
  async function rejectSuggestion(suggestionId, reason) {
    await db.conceptSuggestions.update(suggestionId, {
      status: "rejected",
      rejected_reason: reason,
      reviewed_at: new Date()
    });
  }
  
  /**
   * Get current curator (placeholder for Sprint 3 auth)
   */
  async function getCurrentCurator() {
    // TODO: Replace with real authentication in Sprint 3
    return {
      id: "TEMP_CURATOR",
      name: "Test Curator",
      email: "test@example.com"
    };
  }
  
  return {
    queueSuggestionsFor,
    generateSuggestion,
    analyzeEntity,
    approveSuggestion,
    rejectSuggestion,
    getCurrentCurator
  };
})();
```

### 6.2: Suggestion Review UI

**File**: `scripts/components/SuggestionReviewPanel.js`

```html
<div id="suggestion-review-panel">
  <h3>
    Review Concept Suggestions
    <span class="badge" id="pending-count">0</span>
  </h3>
  
  <div id="suggestion-list">
    <!-- Suggestion cards rendered here -->
  </div>
</div>

<!-- Suggestion Card Template -->
<template id="suggestion-card-template">
  <div class="suggestion-card">
    <div class="entity-info">
      <h4 class="entity-name"></h4>
      <p class="entity-location"></p>
    </div>
    
    <div class="suggestion-content">
      <div class="concepts">
        <!-- Concept badges rendered here -->
      </div>
      <p class="reasoning"></p>
      <span class="confidence"></span>
    </div>
    
    <div class="actions">
      <button class="approve-btn" data-suggestion-id="">
        ✓ Approve
      </button>
      <button class="reject-btn" data-suggestion-id="">
        ✗ Reject
      </button>
      <button class="skip-btn">
        → Skip
      </button>
    </div>
  </div>
</template>
```

**JavaScript**:
```javascript
const SuggestionReviewPanel = (function() {
  
  async function loadPendingSuggestions() {
    const suggestions = await db.conceptSuggestions
      .where("status")
      .equals("pending_review")
      .limit(10)
      .toArray();
    
    renderSuggestions(suggestions);
    updatePendingCount();
  }
  
  function renderSuggestions(suggestions) {
    const container = document.getElementById('suggestion-list');
    container.innerHTML = '';
    
    for (const suggestion of suggestions) {
      const card = createSuggestionCard(suggestion);
      container.appendChild(card);
    }
  }
  
  function createSuggestionCard(suggestion) {
    const template = document.getElementById('suggestion-card-template');
    const card = template.content.cloneNode(true);
    
    // Populate entity info
    card.querySelector('.entity-name').textContent = suggestion.entity_name;
    card.querySelector('.entity-location').textContent = suggestion.location;
    
    // Populate concepts
    const conceptsContainer = card.querySelector('.concepts');
    for (const concept of suggestion.suggested_concepts) {
      const badge = document.createElement('span');
      badge.className = 'concept-badge';
      badge.textContent = concept;
      conceptsContainer.appendChild(badge);
    }
    
    // Populate reasoning
    card.querySelector('.reasoning').textContent = suggestion.reasoning;
    card.querySelector('.confidence').textContent = 
      `${Math.round(suggestion.confidence * 100)}% confidence`;
    
    // Attach event handlers
    card.querySelector('.approve-btn').addEventListener('click', () => {
      handleApprove(suggestion.id);
    });
    
    card.querySelector('.reject-btn').addEventListener('click', () => {
      handleReject(suggestion.id);
    });
    
    return card;
  }
  
  async function handleApprove(suggestionId) {
    await ConceptSuggester.approveSuggestion(suggestionId);
    await loadPendingSuggestions();
    showNotification('✅ Suggestion approved and curation created!');
  }
  
  async function handleReject(suggestionId) {
    const reason = prompt('Why reject? (optional)');
    await ConceptSuggester.rejectSuggestion(suggestionId, reason);
    await loadPendingSuggestions();
    showNotification('Suggestion rejected');
  }
  
  async function updatePendingCount() {
    const count = await db.conceptSuggestions
      .where("status")
      .equals("pending_review")
      .count();
    
    document.getElementById('pending-count').textContent = count;
  }
  
  return {
    loadPendingSuggestions,
    updatePendingCount
  };
})();
```

**Estimated Effort**: 4 hours

---

## Day 7: Bulk Import Manager

### Objectives
1. Handle large imports (100+ entities)
2. Smart batching (avoid API rate limits)
3. Resume interrupted imports
4. Cleanup failed imports

### 7.1: BulkImportManager

**File**: `scripts/services/BulkImportManager.js`

```javascript
/**
 * BulkImportManager.js
 * 
 * Handles large-scale entity imports with:
 * - Smart batching
 * - Rate limiting
 * - Resume capability
 * - Error recovery
 */

const BulkImportManager = (function() {
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 1000;
  
  async function startBulkImport(places) {
    const importId = generateImportId();
    
    // Create import record
    await db.importQueue.add({
      id: importId,
      total: places.length,
      processed: 0,
      status: 'in_progress',
      createdAt: new Date()
    });
    
    // Process in batches
    await this.processBatches(importId, places);
  }
  
  async function processBatches(importId, places) {
    const batches = this.chunkArray(places, BATCH_SIZE);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // Process batch
      await PlacesAutomation.autoImportEntities(batch);
      
      // Update progress
      await db.importQueue.update(importId, {
        processed: (i + 1) * BATCH_SIZE
      });
      
      // Rate limiting delay
      if (i < batches.length - 1) {
        await this.delay(BATCH_DELAY_MS);
      }
    }
    
    // Mark complete
    await db.importQueue.update(importId, {
      status: 'completed',
      processedAt: new Date()
    });
  }
  
  function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  function generateImportId() {
    return `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  return {
    startBulkImport,
    processBatches,
    chunkArray,
    delay
  };
})();
```

**Estimated Effort**: 3 hours

---

## Day 8: Polish + Testing + Documentation

### Objectives
1. Integration testing of all Sprint 2 features
2. UI/UX polish
3. Error handling improvements
4. Documentation updates

### 8.1: Integration Tests

**Test Scenarios**:
```javascript
// Test 1: Quick import nearby
async function testQuickImport() {
  const initialCount = await db.entities.count();
  
  await handleQuickImportNearby();
  
  const finalCount = await db.entities.count();
  assert(finalCount > initialCount);
}

// Test 2: Deduplication
async function testDeduplication() {
  const place = { /* ... */ };
  
  await PlacesAutomation.autoImportEntities([place]);
  const countAfterFirst = await db.entities.count();
  
  await PlacesAutomation.autoImportEntities([place]);
  const countAfterSecond = await db.entities.count();
  
  assert(countAfterFirst === countAfterSecond);
}

// Test 3: Suggestion workflow
async function testSuggestionWorkflow() {
  const entity = { /* ... */ };
  
  await ConceptSuggester.generateSuggestion(entity);
  
  const suggestions = await db.conceptSuggestions
    .where("entity_id")
    .equals(entity.id)
    .toArray();
  
  assert(suggestions.length > 0);
  assert(suggestions[0].status === 'pending_review');
}

// Test 4: Approval creates curation
async function testApprovalCreatesCuration() {
  const suggestionId = /* ... */;
  
  await ConceptSuggester.approveSuggestion(suggestionId);
  
  const curation = await db.curations
    .where("source")
    .equals("curator")
    .first();
  
  assert(curation !== undefined);
  assert(curation.curator_id !== null);
}
```

### 8.2: UI Polish

**Improvements**:
1. Loading states for all async operations
2. Success/error toast notifications
3. Confirm dialogs for destructive actions
4. Keyboard shortcuts (Approve: ⌘+Enter, Reject: ⌘+R)
5. Mobile-responsive layouts

### 8.3: Documentation

**Update Files**:
- `README.md` - Add Sprint 2 features
- `CHANGELOG.md` - Document Sprint 2 changes
- `PROJECT_STATUS.md` - Mark Sprint 2 complete
- `API_INTEGRATION_GUIDE.md` - Update with new schemas

**Estimated Effort**: 2 hours

---

## Sprint 2 Summary

### What Gets Built

**Data Foundation**:
- ✅ Entity-agnostic schema (ready for hotels/events/etc)
- ✅ Multi-curator schema (ownership, forking, permissions)
- ✅ Concept suggestions table
- ✅ Import queue system

**Entity Automation**:
- ✅ "Import Nearby" quick action
- ✅ PlacesAutomation service
- ✅ Smart deduplication
- ✅ Background processing (Web Worker)
- ✅ Progress UI

**Supervised AI**:
- ✅ ConceptSuggester service
- ✅ Automatic suggestion generation
- ✅ Suggestion review UI
- ✅ Approval workflow (suggestion → curation)

**What's NOT in Sprint 2**:
- ❌ Google OAuth (Sprint 3)
- ❌ "My Work" vs "Explore" UI (Sprint 3)
- ❌ Fork workflow UI (Sprint 3)
- ❌ Curator profiles (Sprint 3)

### Success Metrics

- ✅ Can import 20 entities with one button click
- ✅ Deduplication prevents duplicates
- ✅ Suggestions generated automatically
- ✅ Curator can approve/reject suggestions
- ✅ Approved suggestions become curations with curator attribution
- ✅ Database schema supports multi-curator (ready for Sprint 3)

### Estimated Total Effort

**Day 4**: 3 hours  
**Day 5**: 3 hours  
**Day 6**: 4 hours  
**Day 7**: 3 hours  
**Day 8**: 2 hours  

**Total**: ~15 hours over 5 days

---

## Next: Sprint 3 Preview

**Sprint 3 Focus**: Authentication + Multi-Curator UI

1. Google OAuth 2.0 integration
2. "My Work" vs "Explore" tab separation
3. Fork workflow UI
4. Curator profile management
5. Permission system implementation

**Duration**: 4 days (Days 9-12)

---

**Document Status**: Ready for Implementation  
**Last Updated**: November 17, 2025  
**Related**: [Multi-Curator Architecture](./MULTI_CURATOR_ARCHITECTURE.md)
