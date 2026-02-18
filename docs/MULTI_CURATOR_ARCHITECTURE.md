# Multi-Curator Architecture & Entity-Agnostic System

> **Nota:** menções a “Sprint” neste documento são nomenclatura histórica de fases e não correspondem ao modelo atual de execução contínua (vibe coding).

**Created**: November 17, 2025  
**Status**: Architecture Design Document  
**Related**: Historical sprint planning docs (`docs/archive/sprints/`)

---

## Vision Summary

Transform Concierge Collector from a single-curator tool into a **professional multi-curator platform** with:

1. ✅ **Curator Authentication**: Google OAuth for commercial-grade login
2. ✅ **Personal Workspace**: Each curator focuses on their own curations
3. ✅ **Curation Discovery**: Access others' curations without mixing with yours
4. ✅ **Curation Forking**: Copy and edit others' work with proper attribution
5. ✅ **Entity Agnostic**: Support restaurants now, hotels/events/etc later
6. ✅ **Supervised Automation**: AI assists curators without replacing them

---

## API V3 Compatibility & Integration

**Status**: ✅ **API V3 is fully compatible** with multi-curator architecture

### Current API V3 State (Confirmed Working)

**Backend**: FastAPI 0.109.0  
**Database**: MongoDB Atlas  
**Test Coverage**: 28/28 tests passing (100%)  
**Status**: Production-ready, stable

The existing API V3 implementation **already supports** the foundation for multi-curator features:

#### 1. Entity Model Support

**Current V3 Entity Schema** (`app/models/entity.py`):
```python
class Entity(BaseModel):
    entity_id: str
    name: str
    location: Location
    contacts: Optional[Contacts]
    cuisine: Optional[str]
    price_level: Optional[int]
    google_place_id: Optional[str]
    source: str
    created_at: datetime
    updated_at: datetime
```

**✅ Ready for multi-type**: Just add `entity_type` field to support restaurants/hotels/events
**✅ Flexible attributes**: MongoDB's schema-less nature allows easy extension

#### 2. Curation Model Support

**Current V3 Curation Schema** (`app/models/curation.py`):
```python
class Curation(BaseModel):
    curation_id: str
    entity_id: str
    concepts: List[str]
    category: Optional[str]
    notes: Optional[str]
    rating: Optional[int]
    source: str
    created_at: datetime
    updated_at: datetime
```

**✅ Already has `source` field**: Can distinguish curator/automated/forked
**🔧 Needs extension**: Add curator_id, forked_from, visibility fields

#### 3. Data Transformation Layer

**V3DataTransformer** (Sprint 1, Day 3) ensures compatibility:
```javascript
// Frontend → API V3 → MongoDB
const entity = V3DataTransformer.entityToV3(localEntity);
await ApiClient.createEntity(entity);

// MongoDB → API V3 → Frontend
const apiEntity = await ApiClient.getEntity(id);
const localEntity = V3DataTransformer.v3ToEntity(apiEntity);
```

**✅ Handles schema differences**: API uses snake_case, frontend uses camelCase
**✅ Validates data**: Ensures MongoDB constraints met
**✅ Bidirectional**: Read and write operations work seamlessly

### Migration Path for API V3

#### Phase 1: Add Multi-Curator Fields (Sprint 2)

**Update Pydantic Models**:
```python
# app/models/entity.py
class Entity(BaseModel):
    entity_id: str
    entity_type: str = "restaurant"  # NEW: default to restaurant
    name: str
    # ... existing fields ...
    attributes: Optional[Dict[str, Any]] = {}  # NEW: flexible attributes

# app/models/curation.py
class Curation(BaseModel):
    curation_id: str
    entity_id: str
    entity_type: str  # NEW: denormalized for queries
    
    # Ownership (NEW)
    curator_id: str
    curator_name: str
    curator_email: str
    
    # Content
    concepts: List[str]
    category: Optional[str]
    # ... existing fields ...
    
    # Forking (NEW)
    forked_from: Optional[str] = None
    original_curator: Optional[str] = None
    
    # Permissions (NEW)
    visibility: str = "public"
    allow_fork: bool = True
    
    source: str  # curator, automated, forked
```

**MongoDB Indexes** (add to `app/db/mongodb.py`):
```python
# Multi-curator indexes
await db.curations.create_index([("curator_id", 1), ("entity_id", 1)])
await db.curations.create_index([("entity_id", 1), ("curator_id", 1)])
await db.curations.create_index([("visibility", 1)])
await db.curations.create_index([("forked_from", 1)])

# Entity-agnostic indexes
await db.entities.create_index([("entity_type", 1)])
await db.entities.create_index([("entity_type", 1), ("location.city", 1)])
```

#### Phase 2: Add Authentication Endpoints (Sprint 3)

**New Routes** (`app/routes/auth.py`):
```python
@router.post("/api/v3/auth/google")
async def google_oauth_callback(token: str):
    """Handle Google OAuth callback"""
    user_info = verify_google_token(token)
    
    curator = await create_or_get_curator(user_info)
    session_token = create_session(curator)
    
    return {
        "curator": curator,
        "token": session_token
    }

@router.get("/api/v3/curators/me")
async def get_current_curator(token: str = Depends(verify_token)):
    """Get current authenticated curator"""
    return await get_curator_by_token(token)
```

**New Routes** (`app/routes/curators.py`):
```python
@router.get("/api/v3/curators/{curator_id}/curations")
async def get_curator_curations(curator_id: str):
    """Get all curations by specific curator"""
    curations = await db.curations.find({
        "curator_id": curator_id,
        "visibility": {"$in": ["public", "unlisted"]}
    }).to_list(None)
    
    return curations

@router.post("/api/v3/curations/{curation_id}/fork")
async def fork_curation(
    curation_id: str,
    curator: dict = Depends(get_current_curator)
):
    """Fork another curator's curation"""
    original = await db.curations.find_one({"curation_id": curation_id})
    
    if not original.get("allow_fork"):
        raise HTTPException(403, "Forking not allowed")
    
    forked = {
        **original,
        "curation_id": str(uuid4()),
        "curator_id": curator["curator_id"],
        "curator_name": curator["name"],
        "forked_from": curation_id,
        "original_curator": original["curator_name"],
        "source": "forked",
        "created_at": datetime.utcnow()
    }
    
    await db.curations.insert_one(forked)
    return forked
```

#### Phase 3: Update Frontend Integration (Sprint 2-3)

**V3DataTransformer Extensions**:
```javascript
// scripts/services/V3DataTransformer.js

// Add curator fields to curation transformation
curationToV3(curation) {
  return {
    curation_id: curation.id,
    entity_id: curation.entityId,
    entity_type: curation.entityType || 'restaurant',  // NEW
    
    // Curator fields (NEW)
    curator_id: curation.curatorId,
    curator_name: curation.curatorName,
    curator_email: curation.curatorEmail,
    
    // Content
    concepts: curation.concepts,
    category: curation.category,
    notes: curation.notes,
    rating: curation.rating,
    
    // Forking (NEW)
    forked_from: curation.forkedFrom,
    original_curator: curation.originalCurator,
    
    // Permissions (NEW)
    visibility: curation.visibility || 'public',
    allow_fork: curation.allowFork !== false,
    
    source: curation.source || 'curator',
    created_at: curation.createdAt,
    updated_at: curation.updatedAt
  };
}

v3ToCuration(v3Curation) {
  return {
    id: v3Curation.curation_id,
    entityId: v3Curation.entity_id,
    entityType: v3Curation.entity_type,
    
    // Curator fields (NEW)
    curatorId: v3Curation.curator_id,
    curatorName: v3Curation.curator_name,
    curatorEmail: v3Curation.curator_email,
    
    // Content
    concepts: v3Curation.concepts,
    category: v3Curation.category,
    notes: v3Curation.notes,
    rating: v3Curation.rating,
    
    // Forking (NEW)
    forkedFrom: v3Curation.forked_from,
    originalCurator: v3Curation.original_curator,
    
    // Permissions (NEW)
    visibility: v3Curation.visibility,
    allowFork: v3Curation.allow_fork,
    
    source: v3Curation.source,
    createdAt: v3Curation.created_at,
    updatedAt: v3Curation.updated_at
  };
}
```

### API V3 Benefits for Multi-Curator

**1. Centralized Data**: MongoDB Atlas ensures all curators see consistent data  
**2. Schema Flexibility**: MongoDB's document model allows easy field additions  
**3. Query Performance**: Compound indexes support multi-curator filtering  
**4. Test Coverage**: 100% API coverage ensures stability during migration  
**5. Production Ready**: Already deployed and battle-tested

### Sync Strategy (API V3 ↔ IndexedDB)

**Sprint 2**: Local-first (IndexedDB primary)
- Entities and curations stored locally
- Manual sync to API V3 when online
- Offline-first workflow

**Sprint 3**: Real-time sync
- SyncManager coordinates IndexedDB ↔ API V3
- Conflict resolution (last-write-wins with curator_id tie-breaker)
- Background sync for multi-curator updates

**Sprint 4**: Optimistic UI
- Instant local updates
- Background API sync
- Rollback on conflict

### Testing Multi-Curator with API V3

**Create test curators**:
```bash
curl -X POST http://localhost:8000/api/v3/curators \
  -H "Content-Type: application/json" \
  -d '{
    "curator_id": "curator_1",
    "name": "João Silva",
    "email": "joao@example.com"
  }'
```

**Create curation with ownership**:
```bash
curl -X POST http://localhost:8000/api/v3/curations \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "entity_123",
    "curator_id": "curator_1",
    "curator_name": "João Silva",
    "concepts": ["romantic", "cozy"],
    "visibility": "public",
    "source": "curator"
  }'
```

**Fork curation**:
```bash
curl -X POST http://localhost:8000/api/v3/curations/curation_123/fork \
  -H "Authorization: Bearer <curator_2_token>"
```

---

## Core Architectural Principles

### 1. Curator-Centric Model

**Current State**: 
- No authentication
- No clear curator boundaries
- Curations mixed together

**Target State**:
```
┌─────────────────────────────────────────┐
│        Curator Authentication           │
│         (Google OAuth 2.0)              │
└──────────────┬──────────────────────────┘
               │
       ┌───────┴────────┐
       │                │
┌──────▼─────┐   ┌─────▼──────┐
│  My Work   │   │   Explore  │
│            │   │            │
│ • My       │   │ • Other    │
│   Curations│   │   Curators │
│ • Drafts   │   │ • Public   │
│ • Private  │   │   Curations│
└────────────┘   └────────────┘
```

**Key Features**:
- **Login Required**: No anonymous editing (read-only OK for explore)
- **Personal Dashboard**: "My Curations" as primary view
- **Clean Separation**: Never mix my curations with others' in main view
- **Permission System**: Own (edit) vs Others (read/fork)

---

### 2. Entity-Agnostic Design

**Current State**:
- Hardcoded for restaurants
- Database schema tied to restaurant fields

**Target State**:
```javascript
// Generic Entity Model
{
  entity_id: "uuid",
  entity_type: "restaurant",  // hotel, event, bar, cafe, etc
  name: "Entity Name",
  
  // Common to all entity types
  location: { lat, lng, address },
  contacts: { phone, website, email },
  media: { photos, videos },
  
  // Type-specific attributes (flexible JSON)
  attributes: {
    // For restaurants:
    cuisine: "Italian",
    price_level: 3,
    
    // For hotels:
    // star_rating: 4,
    // room_count: 120,
    
    // For events:
    // start_date: "2025-12-01",
    // duration_hours: 3
  },
  
  // Metadata
  source: "google_places",
  createdAt: "2025-11-17T...",
  updatedAt: "2025-11-17T..."
}
```

**Implementation Strategy**:
1. **Phase 1 (Sprint 2)**: Prepare schema with `entity_type` field (all = "restaurant")
2. **Phase 2 (Sprint 4)**: Abstract UI components for entity type switching
3. **Phase 3 (Future)**: Add hotel/event/bar support with type-specific forms

**Benefits**:
- Single codebase for all entity types
- Easy to add new types (just add to enum + attributes)
- Consistent UX across entity types
- Scalable for future expansion

---

### 3. Curation Ownership & Forking

**Current State**:
- No ownership tracking
- Can't tell who created what
- No way to build on others' work

**Target State**:

#### Curation Schema with Ownership

```javascript
{
  curation_id: "uuid",
  entity_id: "uuid",           // Which entity this curates
  entity_type: "restaurant",   // Denormalized for queries
  
  // Ownership
  curator_id: "google-oauth-id",
  curator_name: "João Silva",
  curator_email: "joao@example.com",
  
  // Content
  concepts: ["romantic", "cozy"],
  category: "hidden-gem",
  notes: "Perfect for date night",
  rating: 5,
  
  // Forking & Attribution
  forked_from: null,           // curation_id if forked
  fork_count: 0,               // How many forked from this
  original_curator: null,      // If forked, original author
  
  // Permissions
  visibility: "public",        // public, private, unlisted
  allow_fork: true,            // Can others fork this?
  
  // Provenance
  source: "curator",           // curator, automated, forked
  createdAt: "2025-11-17",
  updatedAt: "2025-11-17"
}
```

#### Forking Workflow

```
Curator A creates curation for Restaurant X
    ↓
Curator B discovers Restaurant X
    ↓
Curator B sees Curator A's curation
    ↓
Curator B clicks "Edit" (not owner)
    ↓
System offers: "Fork this curation?"
    ↓
System creates NEW curation:
  - curator_id: Curator B
  - forked_from: Curator A's curation_id
  - original_curator: Curator A's name
  - concepts: [copied from A]
    ↓
Curator B edits freely (their own curation now)
    ↓
Both curations exist independently
```

**UI Example**:
```html
<div class="curation-card">
  <h3>Restaurant X</h3>
  
  <!-- If viewing another curator's work -->
  <div class="curator-attribution">
    <img src="curator_avatar" />
    <span>Curated by Maria Santos</span>
  </div>
  
  <!-- Fork indicator if this is a fork -->
  <div class="fork-badge">
    <span>🍴 Forked from João Silva</span>
  </div>
  
  <!-- Actions based on ownership -->
  <div class="actions">
    <!-- If mine -->
    <button>Edit</button>
    <button>Delete</button>
    
    <!-- If others' -->
    <button>Fork & Edit</button>
    <button>Save to My Collections</button>
  </div>
</div>
```

---

### 4. Supervised Automation Model

**Goal**: AI assists, curator decides.

#### Automation Types

**Type 1: Entity Import (Fully Automated)**
```javascript
// User action: "Import nearby restaurants"
async function quickImportNearby() {
  const places = await PlacesService.searchNearby(userLocation, radius=5000);
  const entities = places.map(p => PlacesFormatter.toEntity(p));
  
  // Save as entities only (NO curations created)
  await db.entities.bulkAdd(entities);
  
  showNotification(`${entities.length} restaurants added`);
  
  // Background: Generate suggestions for curator review later
  queueConceptSuggestions(entities);
}
```

**Type 2: Concept Suggestions (Supervised)**
```javascript
// System generates suggestions in background
async function generateSuggestions(entity) {
  const suggestions = await ConceptSuggester.analyze(entity);
  
  // Save as SUGGESTIONS (not curations)
  await db.conceptSuggestions.add({
    entity_id: entity.id,
    suggested_concepts: suggestions.concepts,
    confidence: suggestions.confidence,
    reasoning: suggestions.why,
    status: "pending_review",
    source: "automated"
  });
}

// Curator reviews suggestions
async function approveSuggestion(suggestionId) {
  const suggestion = await db.conceptSuggestions.get(suggestionId);
  const curator = await getCurrentCurator();
  
  // Create REAL curation (with curator attribution)
  await db.curations.add({
    entity_id: suggestion.entity_id,
    curator_id: curator.id,
    concepts: suggestion.suggested_concepts,
    source: "curator",  // Human approved
    createdAt: new Date()
  });
  
  // Mark suggestion as used
  await db.conceptSuggestions.update(suggestionId, {
    status: "approved"
  });
}
```

**Type 3: Auto-Curations (Background Only)**
```javascript
// System creates "automated" curations for Concierge app
// But these are INVISIBLE to curator workflow
async function createAutomatedCuration(entity) {
  const concepts = await ConceptSuggester.quickAnalyze(entity);
  
  await db.curations.add({
    entity_id: entity.id,
    curator_id: "SYSTEM",  // Special ID for automated
    curator_name: "Auto-Curator",
    concepts: concepts,
    source: "automated",  // Client app can filter
    visibility: "unlisted",  // Not shown in explore
    createdAt: new Date()
  });
}
```

**Client App (Concierge) Decision Logic**:
```javascript
// Concierge app decides what to show
async function getRecommendations(user, mode) {
  if (mode === "premium") {
    // Only human curators
    return db.curations.where("source").equals("curator").toArray();
  } else if (mode === "discovery") {
    // Mix of curator + automated
    return db.curations.where("source").anyOf(["curator", "automated"]).toArray();
  }
}
```

---

### 5. UI/UX Separation

**Collector App Views**:

```
┌─────────────────────────────────────┐
│  🏠 My Work                         │
├─────────────────────────────────────┤
│  • My Curations (10)                │
│  • Pending Suggestions (5)          │
│  • Drafts (2)                       │
│                                     │
│  [+ Import Nearby Restaurants]      │
│  [+ Create New Curation]            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  🔍 Explore                         │
├─────────────────────────────────────┤
│  Filter: All Curators ▼             │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ Restaurant X                 │  │
│  │ 👤 Maria Santos              │  │
│  │ Concepts: Romantic, Cozy     │  │
│  │ [Fork & Edit]                │  │
│  └──────────────────────────────┘  │
│                                     │
│  ┌──────────────────────────────┐  │
│  │ Restaurant Y                 │  │
│  │ 👤 João Silva                │  │
│  │ Concepts: Family, Affordable │  │
│  │ [Fork & Edit]                │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

**Key Principle**: **Never mix "My Work" with "Others' Work" in the same list.**

---

## Sprint 2 Revised Scope

### What Changes in Sprint 2

1. **Data Model Preparation**:
   - Add `entity_type` field to entities (all = "restaurant" for now)
   - Add `curator_id`, `curator_name`, `curator_email` to curations
   - Add `forked_from`, `original_curator` to curations
   - Add `visibility`, `allow_fork` permissions
   - Add `source` field ("curator", "automated", "forked")

2. **Entity Automation**:
   - "Import Nearby" button → adds 20 closest restaurants as entities
   - Background concept suggestion generation
   - NO automatic curation creation in main workflow

3. **Supervised Suggestions**:
   - `conceptSuggestions` table as designed
   - ConceptSuggester generates suggestions
   - Simple review UI (approve/reject)

4. **Authentication Placeholder**:
   - Add `getCurrentCurator()` function (returns mock for now)
   - Prepare for Google OAuth in Sprint 3

### What Moves to Sprint 3

1. **Authentication**:
   - Google OAuth 2.0 integration
   - Curator profile management
   - Session handling

2. **Multi-Curator UI**:
   - "My Work" vs "Explore" tabs
   - Curator filtering
   - Fork workflow UI

3. **Permissions**:
   - Ownership checks
   - Edit/delete permissions
   - Public/private curations

---

## Implementation Notes

### Database Indexes for Multi-Curator

```javascript
// IndexedDB Schema Updates
db.version(4).stores({
  entities: "++id, entity_type, source, [entity_type+location]",
  
  curations: `
    ++id, 
    entity_id, 
    curator_id, 
    [curator_id+entity_id],  // My curations for entity
    [entity_id+curator_id],  // All curations for entity
    source,                   // Filter automated vs curator
    visibility                // Filter public/private
  `,
  
  conceptSuggestions: `
    ++id,
    entity_id,
    [entity_id+status],      // Pending suggestions for entity
    status,                   // All pending
    source
  `
});
```

### API Changes for Multi-Curator

```python
# API V3 Endpoints (new)
POST   /api/v3/auth/google                  # OAuth callback
GET    /api/v3/curators/me                  # Current curator profile
GET    /api/v3/curators/{id}/curations      # Curations by curator
POST   /api/v3/curations                    # Create curation (requires auth)
PUT    /api/v3/curations/{id}               # Update (owner only)
POST   /api/v3/curations/{id}/fork          # Fork curation
GET    /api/v3/entities?entity_type=restaurant  # Filter by type
```

---

## Success Metrics

### Sprint 2 (Foundation)
- ✅ Entity schema supports `entity_type`
- ✅ Curation schema supports multi-curator
- ✅ "Import Nearby" adds entities in bulk
- ✅ ConceptSuggester generates supervised suggestions
- ✅ Basic suggestion review UI works

### Sprint 3 (Multi-Curator)
- ✅ Google OAuth login works
- ✅ "My Work" vs "Explore" separation clear
- ✅ Forking creates new curation with attribution
- ✅ Can't edit others' curations (only fork)

### Sprint 4 (Polish)
- ✅ UI handles 1000+ curations smoothly
- ✅ Curator filtering is fast
- ✅ Fork attribution is visible
- ✅ Entity-agnostic UI ready for new types

---

## Open Questions

1. **Curation Limits**: Max curations per entity per curator? (Prevent spam)
2. **Fork Visibility**: Should forked curations link back to original? (GitHub-style)
3. **Automated Curation Cleanup**: Delete old automated curations? (Keep DB lean)
4. **Entity Type Priorities**: After restaurants, what's next? (Hotels, bars, cafes?)
5. **Curator Reputation**: Track fork counts, approval ratings? (Gamification?)

---

## Next Steps

1. Review this architecture with stakeholders
2. Validate Google OAuth approach
3. Design curator profile schema
4. Update Sprint 2 roadmap with revised scope
5. Begin implementation with data model changes

---

**Document Status**: Ready for Review  
**Feedback Requested By**: November 18, 2025  
**Implementation Target**: Sprint 2 (Data Model) + Sprint 3 (Auth & UI)
