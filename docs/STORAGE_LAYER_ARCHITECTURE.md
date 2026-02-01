# Storage Layer Architecture

**Last Updated:** 2026-01-31 (Phase 6: Cleanup Documentation)

---

## Overview

The Concierge Collector storage layer consists of three files, each with distinct responsibilities:

```
scripts/storage/
├── dataStorage.js          (3020 lines) - Legacy IndexedDB layer
├── dataStore.js           (1513 lines) - New Entity-Curation model  
└── dataStorageWrapper.js    (78 lines) - Compatibility bridge
```

---

## 1. dataStorage.js (Legacy - IndexedDB Layer)

**Purpose:** Original database layer using Dexie.js for IndexedDB.

**Key Features:**
- Direct IndexedDB access via Dexie
- V3DataTransformer integration for MongoDB compatibility
- Handles: restaurants, concepts, curators, photos, locations
- Synchronization with MongoDB V3 API

**Status:** ⚠️ LEGACY - Still in use but being phased out

**Used by:** Older UI modules, recording workflow

**Schema:**
```javascript
{
  curators: '++id, name, lastActive, serverId, origin',
  concepts: '++id, category, value, timestamp, [category+value]',
  restaurants: '++id, name, curatorId, timestamp, transcription',
  restaurantConcepts: '++id, restaurantId, conceptId',
  restaurantPhotos: '++id, restaurantId, photoData',
  restaurantLocations: '++id, restaurantId, latitude, longitude'
}
```

---

## 2. dataStore.js (Modern - Entity-Curation Model)

**Purpose:** New data layer implementing Entity-Curation architecture.

**Key Features:**
- Generic entity management (restaurants, users, admins, system objects)
- Curation-based reviews and recommendations
- Offline-first with optimistic locking (ETags)
- Flexible querying and real-time updates
- Better aligned with V3 API architecture

**Status:** ✅ ACTIVE - Preferred for new code

**Used by:** New modules, multi-curator features

**Advantages over dataStorage:**
- More flexible entity types
- Better separation of data and metadata
- Cleaner sync architecture
- Supports multiple curators natively

---

## 3. dataStorageWrapper.js (Compatibility Layer)

**Purpose:** Bridge between legacy code and new DataStore.

**How it works:**
- Provides `window.dataStorage` interface
- Redirects calls to `window.dataStore` methods
- Translates old method signatures to new ones

**Example:**
```javascript
// Legacy code calls:
await window.dataStorage.getRestaurants();

// Wrapper translates to:
await window.dataStore.getEntities({ type: 'restaurant' });
```

**Status:** ✅ TEMPORARY - Required during migration

**Purpose:** Allows gradual migration without breaking existing UI.

---

## Migration Strategy

### Current State (Jan 2026)
- **dataStorage.js:** Still active, handles most storage operations
- **dataStore.js:** Partially implemented, used by newer features
- **dataStorageWrapper.js:** Active, bridges old UI to new store

### Migration Path
1. ✅ Phase 1: Implement dataStore with entity-curation model
2. ✅ Phase 2: Add compatibility wrapper (dataStorageWrapper)
3. ⏳ Phase 3: Migrate UI modules one by one to use dataStore directly
4. ⏳ Phase 4: Remove dataStorage.js when all modules migrated
5. ⏳ Phase 5: Remove dataStorageWrapper.js when no longer needed

### How to Choose

**Use dataStore for:**
- New features
- Multi-curator support
- Entity-based operations
- Clean architecture

**Keep using dataStorage for:**
- Recording workflow (until migrated)
- Concept extraction (until migrated)
- Legacy UI components (until updated)

---

## Technical Details

### dataStorage.js Methods (Legacy)
```javascript
// CRUD
getRestaurants(), saveRestaurant(data), updateRestaurant(id, data)
getConcepts(), saveConcept(data), getConcept(id)

// Relationships
linkConceptToRestaurant(restaurantId, conceptId)
getRestaurantConcepts(restaurantId)

// Photos & Locations
saveRestaurantPhoto(restaurantId, photoData)
saveRestaurantLocation(restaurantId, latitude, longitude, address)

// Sync
syncWithServer(), getLocalCurator()
```

### dataStore.js Methods (Modern)
```javascript
// Generic Entity Operations
getEntities(options), getEntity(id), createEntity(data)
updateEntity(id, updates), deleteEntity(id)

// Curation Operations  
getCurations(entityId), createCuration(data)

// Curator Management
getCurrentCurator(), switchCurator(curatorId)

// Settings & Sync
getSetting(key), setSetting(key, value)
syncAll(), getConflicts()
```

### dataStorageWrapper.js Methods (Compatibility)
```javascript
// Redirects old calls to new store
getRestaurants() → dataStore.getEntities({ type: 'restaurant' })
getCurrentCurator() → dataStore.getCurrentCurator()
getSetting() → dataStore.getSetting()
// ... etc
```

---

## File Headers

All three files have proper headers explaining:
- **Purpose:** What the file does
- **Responsibilities:** Main functionality
- **Dependencies:** Required modules

This follows the project's Clean Architecture standards.

---

## Next Steps

1. Continue migrating UI modules to use dataStore directly
2. Document which modules use which storage layer
3. Create migration guide for developers
4. Test thoroughly before removing dataStorage
5. Remove wrapper once migration complete

**Estimated migration completion:** Q2 2026

---

## Related Documentation

- [COLLECTOR_V3_ARCHITECTURE.md](COLLECTOR_V3_ARCHITECTURE.md) - Overall system architecture
- [API_V3_INTEGRATION_SPEC.md](API_V3_INTEGRATION_SPEC.md) - Server integration
- [MULTI_CURATOR_ARCHITECTURE.md](MULTI_CURATOR_ARCHITECTURE.md) - Multi-curator design
- [CODE_QUALITY_AUDIT_2026_01_31.md](CODE_QUALITY_AUDIT_2026_01_31.md) - Code quality issues

---

**Summary:**  
Three storage files with clear separation:  
✅ **dataStorage** = Legacy IndexedDB layer (being phased out)  
✅ **dataStore** = Modern entity-curation model (preferred)  
✅ **dataStorageWrapper** = Compatibility bridge (temporary)
