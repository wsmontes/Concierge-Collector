# Frontend Architecture Investigation
**Date**: 2025-11-17  
**Sprint**: Sprint 2 Day 4  
**Context**: User reported display issues (duplicates, invalid dates, "Server" label)

---

## Current State Analysis

### 1. Data Model Confusion

**Problem**: System has TWO parallel data structures:

```
LEGACY (being phased out):
├── restaurants (table)
└── Used by: restaurantModule.js, dataStorage.js

NEW (V3 Architecture):
├── entities (table) 
├── curations (table)
└── Used by: dataStore.js, PlacesAutomation.js
```

**Result**: Display shows `restaurants` (legacy), but `PlacesAutomation` creates `entities` (new).  
**Impact**: 60 entities in IndexedDB not showing because UI renders from wrong table!

---

### 2. Display Architecture

#### Current UI Flow:
```
index.html
  └── #restaurants-container (grid layout)
       └── restaurantModule.loadRestaurantList()
            └── dataStorage.getRestaurants() 
                 └── db.restaurants.toArray()  ❌ Wrong table!
```

#### What Should Happen:
```
index.html
  └── #restaurants-container OR #entities-container
       └── entityModule.loadEntityList()  (NEW)
            └── dataStore.getEntities()
                 └── db.entities.toArray()  ✅ Correct table!
```

---

### 3. Duplicate Display Issue

**Root Cause**: PlacesAutomation imported 20 entities **3 times** with different internal IDs:

```
Elements Casino Victoria:
- ID: 1  (first import)
- ID: 21 (second import) 
- ID: 41 (third import)
```

**Why?**: 
1. ✅ Backend deduplication working (place_id based)
2. ❌ Frontend deduplication NOT checking before display
3. ❌ `entity_id` not being used as unique key for display

**Expected**: Show only entity with latest `id` OR deduplicate by `entity_id`/`place_id`

---

### 4. Invalid Date Issue

**Code Location**: `restaurantModule.js:220`
```javascript
<span>Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</span>
```

**Problem**: 
- Field name changed: `timestamp` → `createdAt`
- Entities don't have `timestamp` field
- Result: `new Date(undefined)` = Invalid Date

**Fix**: Use `createdAt` field

---

### 5. "Server" Label Issue

**Code Location**: `restaurantModule.js:220`
```javascript
<span>Added: ${new Date(restaurant.timestamp).toLocaleDateString()}</span>
```

**Problem**: Showing `restaurant.source` but label says "Server" instead of curator name

**Expected**: 
```javascript
const curatorName = restaurant.createdBy || 'Unknown';
<span>by: ${curatorName}</span>
```

---

## Architecture Decision: Entity-First UX

### Conceptual Model

```
┌──────────────────────────────────────────────────────────┐
│  ENTITIES = Raw Restaurant Data (Google Places)         │
│  - Name, address, phone, photos, hours                   │
│  - Source: google_places, michelin, manual               │
│  - Purpose: Searchable database of ALL restaurants       │
│  - UI: Compact list with search/filter                   │
└──────────────────────────────────────────────────────────┘
                       ↓ Curator adds review
┌──────────────────────────────────────────────────────────┐
│  CURATIONS = Curator's Opinion + Context                 │
│  - References entity_id                                   │
│  - Contains: concepts, description, personal notes       │
│  - Purpose: Curator's curated recommendations            │
│  - UI: Rich cards with entity metadata + review          │
└──────────────────────────────────────────────────────────┘
```

### User Flow

```
1. Import 20 Places
   → Creates 20 ENTITIES (no curations yet)
   → Shows in compact searchable list

2. User searches/filters entities
   → "Italian restaurants in Victoria"
   → "Fine dining with patio"
   → Click entity → See details

3. User curates an entity
   → Adds concepts, description, photos
   → Creates CURATION linked to entity
   → Curation shows in "My Curations" with rich card

4. Browse curations
   → Shows curator's picks with full context
   → Card displays: Entity data + Curator's review
   → Example:
     ┌────────────────────────────────────────┐
     │ 🍕 Pizzeria Bella (Victoria)         │
     │ 📍 123 Main St | ☎ 250-123-4567      │
     │ ⭐⭐⭐⭐ (245 reviews)                │
     │                                        │
     │ "Amazing authentic Neapolitan pizza"   │
     │ 🏷️ Italian • Fine Dining • Romantic   │
     │                                        │
     │ 👤 Curated by: John Smith             │
     └────────────────────────────────────────┘
```

---

## Required Changes

### Phase 1: Fix Immediate Display Issues (2h)

1. **Create `entityModule.js`** (new file)
   - Copy structure from `restaurantModule.js`
   - Update to use `dataStore.getEntities()`
   - Compact list view (not cards)
   - Search/filter by name, city, type

2. **Update `index.html`**
   - Add `#entities-section` (compact list)
   - Keep `#restaurant-list-section` as `#curations-section`
   - Add search/filter UI for entities

3. **Fix display bugs**:
   - Use `createdAt` instead of `timestamp`
   - Use `createdBy` instead of `source` for curator name
   - Deduplicate by `entity_id` before display

### Phase 2: Curation Cards Enhancement (3h)

4. **Update curation cards** to show entity metadata:
   ```javascript
   async renderCurationCard(curation) {
     const entity = await dataStore.getEntity(curation.entity_id);
     
     return `
       <div class="curation-card">
         <!-- Entity Info -->
         <h3>${entity.name}</h3>
         <p>${entity.data.location.address}</p>
         <p>${entity.data.contacts.phone}</p>
         
         <!-- Curation Info -->
         <p>"${curation.description}"</p>
         <div>${curation.concepts}</div>
       </div>
     `;
   }
   ```

5. **Migrate legacy restaurants** to entities/curations:
   - One-time migration script
   - Convert restaurants → entities
   - Create curations for existing concepts

### Phase 3: Search & Discovery (2h)

6. **Entity search component**:
   - Full-text search on name, city, cuisine
   - Filter by entity_type, city, rating
   - Sort by name, rating, distance

7. **Quick actions**:
   - "Import Nearby" → Add to entities
   - "Curate This" → Create curation from entity
   - "View Details" → Entity detail modal

---

## File Changes Required

### New Files:
```
scripts/modules/entityModule.js       (NEW - entity list & search)
scripts/modules/entitySearchModule.js (NEW - search/filter logic)
scripts/components/entityCard.js      (NEW - compact entity display)
scripts/components/curationCard.js    (NEW - rich curation display)
```

### Modified Files:
```
index.html                            (Add entities section, update layout)
scripts/main.js                       (Initialize new modules)
scripts/modules/restaurantModule.js   (Deprecate or migrate to curations)
scripts/dataStore.js                  (Add entity deduplication logic)
```

### Deprecated Files:
```
scripts/modules/restaurantListModule.js  (Replace with entityModule)
scripts/dataStorage.js (restaurants)     (Phase out restaurants table)
```

---

## Migration Strategy

### Option A: Big Bang (NOT RECOMMENDED)
- Replace everything at once
- High risk of breaking existing functionality
- Downtime while refactoring

### Option B: Gradual Migration (RECOMMENDED)
1. **Sprint 2 Day 4 (TODAY)**:
   - Create `entityModule.js` alongside existing
   - Add entities section WITHOUT removing restaurants
   - Users can see both until migration complete

2. **Sprint 2 Day 5**:
   - Create migration script: restaurants → entities/curations
   - Test migration with sample data
   - Add "Migrate Now" button in settings

3. **Sprint 3**:
   - Deprecate restaurants table
   - Remove restaurantModule.js
   - Clean up legacy code

---

## Data Model Alignment

### Current IndexedDB Schema (v6):
```javascript
entities: `
  ++id,                    // Auto-increment internal ID
  entity_id,               // Global unique ID (place_ChIJ...)
  google_place_id,         // Google reference
  entity_type,             // restaurant, bar, hotel
  source,                  // google_places, michelin, manual
  [entity_type+city],      // Compound index for filtering
  createdAt,
  synced
`

curations: `
  ++id,
  curation_id,             // Global unique ID
  entity_id,               // Foreign key to entities
  curator_id,              // Who curated this
  [curator_id+entity_id],  // My curations per entity
  source,
  visibility,
  createdAt,
  synced
`
```

### Proposed Display Logic:
```javascript
// Deduplicate entities by entity_id before display
const uniqueEntities = {};
for (const entity of allEntities) {
  const key = entity.entity_id || entity.id;
  if (!uniqueEntities[key] || entity.id > uniqueEntities[key].id) {
    uniqueEntities[key] = entity; // Keep latest
  }
}
const displayEntities = Object.values(uniqueEntities);
```

---

## Next Steps

**Immediate (Today)**:
1. ✅ Document investigation (this file)
2. ⏳ Create `entityModule.js` with compact list view
3. ⏳ Add deduplication logic to display
4. ⏳ Fix date/curator display bugs
5. ⏳ Add entities section to `index.html`

**Tomorrow**:
6. Create migration script
7. Enhance curation cards with entity metadata
8. Add search/filter UI

**Sprint 3**:
9. Deprecate restaurants table
10. Remove legacy code

---

## Questions for User

1. **UX Decision**: Should entities show as:
   - A) Compact list (like Gmail)
   - B) Mini cards (like contacts)
   - C) Table view (like Excel)

2. **Migration**: When to migrate existing restaurants?
   - A) Automatic on next page load
   - B) Manual "Migrate" button
   - C) Keep both until Sprint 3

3. **Priority**: What's most important?
   - A) Fix current duplicates (quick fix)
   - B) Build proper entity UI (proper solution)
   - C) Both (2x effort)

---

**Status**: Investigation complete, awaiting user decisions before implementing.
