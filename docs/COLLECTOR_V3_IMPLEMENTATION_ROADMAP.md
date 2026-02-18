# Collector V3 - Implementation Roadmap

**Version:** 3.0.0  
**Start Date:** November 18, 2025  
**Estimated Duration:** 4-5 days  
**Status:** Ready to Start

---

## 📋 Overview

Complete implementation plan for migrating Concierge Collector frontend to work with FastAPI V3 backend. This roadmap breaks down the work into manageable phases with clear deliverables and dependencies.

---

## 🎯 Phases Summary

| Phase | Focus | Duration | Deliverables |
|-------|-------|----------|--------------|
| **Phase 0** | Archive & Cleanup | 2 hours | Old code archived, clean workspace |
| **Phase 1** | Core Configuration | 4-6 hours | config.js, apiService.js updated |
| **Phase 2** | Data Layer | 4-6 hours | dataStorage.js, schema migration |
| **Phase 3** | Sync Manager | 6-8 hours | syncManager.js V3 implementation |
| **Phase 4** | UI Updates | 6-8 hours | Modules adapted to V3 |
| **Phase 5** | Testing & Polish | 4-6 hours | E2E tests, bug fixes |

**Total Estimated Time:** 26-36 hours (3-5 working days)

---

## Phase 0: Archive & Cleanup (2 hours)

### Objective
Clean workspace by archiving obsolete code and documentation.

### Tasks

#### 1. Archive Old API Documentation
```bash
mkdir -p archive/old-api-docs
mv docs/API_INTEGRATION_COMPLETE.md archive/old-api-docs/
mv docs/API_DOCUMENTATION_INDEX.md archive/old-api-docs/
mv docs/API_RECOMMENDATIONS.md archive/old-api-docs/
```

#### 2. Archive Broken Sync Manager
```bash
mv scripts/syncManager_broken.js archive/old-code/
```

#### 3. Create Archive Index
Create `archive/INDEX.md` documenting what was archived and why.

#### 4. Update .gitignore
Ensure archive/ is tracked but temporary files aren't.

### Deliverables
- [ ] Old docs moved to archive/
- [ ] Broken code moved to archive/
- [ ] Archive index created
- [ ] Clean workspace

### Dependencies
None

---

## Phase 1: Core Configuration (4-6 hours)

### Objective
Update configuration and core API service to work with V3 backend.

### Tasks

#### 1.1 Update config.js (1 hour)

**Changes Required:**
```javascript
// BEFORE
backend: {
  baseUrl: 'http://localhost:8000',  // ❌ Missing /api/v3
  endpoints: {
    register: '/auth/register',      // ❌ Not used by V3
    login: '/auth/login',             // ❌ Not used by V3
    syncPull: '/sync/pull',           // ❌ Not implemented yet
    // ... old endpoints
  }
}

// AFTER
backend: {
  baseUrl: 'http://localhost:8000/api/v3',  // ✅ V3 prefix
  apiKey: localStorage.getItem('api_key_v3') || '',
  features: {
    optimisticLocking: true,     // ✅ Version field
    requiresAuth: true,          // ✅ X-API-Key
    authType: 'api-key'         // ✅ Not JWT
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
```

**Test:**
```javascript
// Verify config loads correctly
console.log(AppConfig.api.backend.baseUrl);
// Output: "http://localhost:8000/api/v3"
```

#### 1.2 Rewrite apiService.js (3-4 hours)

**Key Changes:**

1. **Remove JWT Authentication**
   - Delete `login()`, `register()`, `refreshToken()` methods
   - Remove JWT token storage/refresh logic

2. **Implement X-API-Key Authentication**
```javascript
getAuthHeaders() {
  const apiKey = localStorage.getItem('api_key_v3');
  if (!apiKey) {
    throw new Error('API key not configured');
  }
  return {
    'X-API-Key': apiKey
  };
}
```

3. **Implement Optimistic Locking**
```javascript
async updateEntity(entityId, updates, currentVersion) {
  const headers = {
    ...this.getAuthHeaders(),
    'If-Match': String(currentVersion),
    'Content-Type': 'application/json'
  };
  
  const response = await this.request('PATCH', 
    `/entities/${entityId}`, 
    { headers, body: JSON.stringify(updates) }
  );
  
  if (response.status === 409) {
    throw new Error('Version conflict - entity was modified');
  }
  
  return response.json();
}
```

4. **Update CRUD Methods**
```javascript
// Create/upsert entity
async createEntity(entity) { /* ... */ }

// Get entity
async getEntity(entityId) { /* ... */ }

// Update entity (with version)
async updateEntity(entityId, updates, version) { /* ... */ }

// Delete entity
async deleteEntity(entityId) { /* ... */ }

// List entities
async listEntities(filters = {}) { /* ... */ }

// Same for curations
async createCuration(curation) { /* ... */ }
async getCuration(curationId) { /* ... */ }
async updateCuration(curationId, updates, version) { /* ... */ }
async deleteCuration(curationId) { /* ... */ }
async listCurations(filters = {}) { /* ... */ }
async getEntityCurations(entityId) { /* ... */ }
```

5. **Add AI Service Methods**
```javascript
async transcribeAudio(audioBlob, language = 'pt') { /* ... */ }
async extractConcepts(text, entityType = 'restaurant') { /* ... */ }
async analyzeImage(imageBlob, prompt) { /* ... */ }
```

6. **Add Places Service Methods**
```javascript
async searchPlaces(query, location, radius) { /* ... */ }
async getPlaceDetails(placeId) { /* ... */ }
```

7. **Improve Error Handling**
```javascript
handleApiError(response, error) {
  if (response.status === 401) {
    return 'API key invalid or missing';
  } else if (response.status === 409) {
    return 'Version conflict - data was modified by another user';
  } else if (response.status === 428) {
    return 'Version information required for updates';
  }
  // ... handle all status codes
}
```

**Test:**
```javascript
// Test API service initialization
await ApiService.initialize();

// Test entity creation
const entity = await ApiService.createEntity({
  entity_id: 'test-123',
  type: 'restaurant',
  name: 'Test Restaurant'
});

// Test optimistic locking
await ApiService.updateEntity('test-123', { name: 'Updated' }, 1);
```

#### 1.3 Add API Key Management UI (1 hour)

Update `main.js` to prompt for API key if missing:

```javascript
window.checkAndPromptForApiKey = function() {
  const apiKey = localStorage.getItem('api_key_v3');
  
  if (!apiKey || apiKey.trim() === '') {
    showApiKeyPromptV3();
    return false;
  }
  return true;
};

function showApiKeyPromptV3() {
  // Show modal to input API key
  // Save to localStorage as 'api_key_v3'
  // Test API key by calling /info endpoint
}
```

### Deliverables
- [ ] config.js updated with V3 endpoints
- [ ] apiService.js rewritten for V3
- [ ] API key management implemented
- [ ] All core API methods tested
- [ ] Error handling comprehensive

### Dependencies
None

---

## Phase 2: Data Layer (4-6 hours)

### Objective
Update IndexedDB schema to match V3 entity/curation structure.

### Tasks

#### 2.1 Update dataStorage.js Schema (2-3 hours)

**Current Schema (V2):**
```javascript
const db = new Dexie('ConciergeCollector');
db.version(1).stores({
  entities: 'id, type, name, status',
  curations: 'id, entity_id, curator_id'
});
```

**New Schema (V3):**
```javascript
const db = new Dexie('ConciergeCollectorV3');
db.version(1).stores({
  entities: 'entity_id, type, name, status, externalId, version, [sync.status], updatedAt',
  curations: 'curation_id, entity_id, [curator.id], version, [sync.status], updatedAt',
  sync_metadata: 'id, lastPullAt, lastPushAt'
});
```

**Key Changes:**
- Primary key: `id` → `entity_id` / `curation_id`
- Add `version` field for optimistic locking
- Add `sync.status` compound index
- Add `updatedAt` for sync ordering

#### 2.2 Create Migration Script (1 hour)

```javascript
async function migrateV2toV3() {
  const oldDb = new Dexie('ConciergeCollector');
  const newDb = new Dexie('ConciergeCollectorV3');
  
  // Open old DB
  await oldDb.open();
  
  // Migrate entities
  const oldEntities = await oldDb.entities.toArray();
  for (const entity of oldEntities) {
    const v3Entity = V3DataTransformer.transformToV3Entity(entity);
    await newDb.entities.put(v3Entity);
  }
  
  // Migrate curations
  const oldCurations = await oldDb.curations.toArray();
  for (const curation of oldCurations) {
    const v3Curation = V3DataTransformer.transformToV3Curation(curation);
    await newDb.curations.put(v3Curation);
  }
  
  console.log('Migration complete!');
}
```

#### 2.3 Update DataStorage Methods (1-2 hours)

Update all CRUD methods to work with new schema:

```javascript
class DataStorage {
  async saveEntity(entity) {
    // Ensure version field exists
    if (!entity.version) {
      entity.version = 1;
    }
    
    // Add sync metadata
    if (!entity.sync) {
      entity.sync = {
        status: 'pending_push',
        lastSyncedAt: null
      };
    }
    
    await this.db.entities.put(entity);
  }
  
  async getEntity(entityId) {
    return await this.db.entities.get(entityId);
  }
  
  async updateEntity(entityId, updates) {
    const entity = await this.getEntity(entityId);
    if (!entity) {
      throw new Error(`Entity ${entityId} not found`);
    }
    
    // Increment version
    entity.version = (entity.version || 0) + 1;
    
    // Mark as pending push
    entity.sync.status = 'pending_push';
    
    // Apply updates
    Object.assign(entity, updates);
    entity.updatedAt = new Date().toISOString();
    
    await this.db.entities.put(entity);
    return entity;
  }
  
  // Similar for curations...
}
```

#### 2.4 Test Data Layer (30 min)

```javascript
// Test entity operations
const entity = {
  entity_id: 'test-123',
  type: 'restaurant',
  name: 'Test',
  version: 1
};

await dataStorage.saveEntity(entity);
const retrieved = await dataStorage.getEntity('test-123');
console.assert(retrieved.entity_id === 'test-123');

await dataStorage.updateEntity('test-123', { name: 'Updated' });
const updated = await dataStorage.getEntity('test-123');
console.assert(updated.version === 2);
```

### Deliverables
- [ ] IndexedDB schema updated to V3
- [ ] Migration script created and tested
- [ ] All CRUD methods updated
- [ ] Version field properly managed
- [ ] Sync metadata tracked
- [ ] Comprehensive tests passing

### Dependencies
Phase 1 (config.js, apiService.js)

---

## Phase 3: Sync Manager (6-8 hours)

### Objective
Implement bi-directional sync with conflict resolution.

### Tasks

#### 3.1 Create syncManagerV3.js (4-5 hours)

**Core Functionality:**

```javascript
class SyncManagerV3 {
  constructor() {
    this.apiService = ApiService;
    this.dataStorage = DataStorage;
    this.transformer = V3DataTransformer;
    this.issyncing = false;
  }
  
  /**
   * Full sync: pull then push
   */
  async fullSync() {
    if (this.isSyncing) {
      throw new Error('Sync already in progress');
    }
    
    try {
      this.isSyncing = true;
      
      // Pull changes from server
      await this.pullEntities();
      await this.pullCurations();
      
      // Push local changes
      await this.pushEntities();
      await this.pushCurations();
      
      // Update sync metadata
      await this.updateSyncMetadata();
      
    } finally {
      this.isSyncing = false;
    }
  }
  
  /**
   * Pull entities from server
   */
  async pullEntities() {
    // Get last sync timestamp
    const lastSync = await this.getLastPullTimestamp();
    
    // Fetch all entities (paginated)
    const entities = await this.apiService.listEntities({
      limit: 1000,
      offset: 0
    });
    
    for (const serverEntity of entities.items) {
      // Get local entity
      const localEntity = await this.dataStorage.getEntity(
        serverEntity.entity_id
      );
      
      if (!localEntity) {
        // New entity - save locally
        await this.dataStorage.saveEntity(serverEntity);
        
      } else if (serverEntity.version > localEntity.version) {
        // Server is newer - update local
        await this.dataStorage.saveEntity(serverEntity);
        
      } else if (serverEntity.version < localEntity.version) {
        // Local is newer - mark for push
        localEntity.sync.status = 'pending_push';
        await this.dataStorage.saveEntity(localEntity);
        
      } else if (serverEntity.updatedAt !== localEntity.updatedAt) {
        // Same version but different update time - CONFLICT
        localEntity.sync.status = 'conflict';
        await this.dataStorage.saveEntity(localEntity);
        await this.logConflict('entity', localEntity.entity_id);
      }
    }
  }
  
  /**
   * Push entities to server
   */
  async pushEntities() {
    // Find all entities pending push
    const pendingEntities = await this.dataStorage.db.entities
      .where('sync.status')
      .equals('pending_push')
      .toArray();
    
    for (const entity of pendingEntities) {
      try {
        // Check if entity exists on server
        let serverEntity = null;
        try {
          serverEntity = await this.apiService.getEntity(entity.entity_id);
        } catch (e) {
          // Entity doesn't exist on server
        }
        
        if (!serverEntity) {
          // Create new entity
          const created = await this.apiService.createEntity(entity);
          entity.version = created.version;
          entity.sync.status = 'synced';
          entity.sync.lastSyncedAt = new Date().toISOString();
          
        } else {
          // Update existing entity with version check
          const updated = await this.apiService.updateEntity(
            entity.entity_id,
            entity,
            entity.version
          );
          entity.version = updated.version;
          entity.sync.status = 'synced';
          entity.sync.lastSyncedAt = new Date().toISOString();
        }
        
        await this.dataStorage.saveEntity(entity);
        
      } catch (error) {
        if (error.message.includes('Version conflict')) {
          // Conflict detected
          entity.sync.status = 'conflict';
          await this.dataStorage.saveEntity(entity);
          await this.logConflict('entity', entity.entity_id);
        } else {
          throw error;
        }
      }
    }
  }
  
  /**
   * Pull curations (similar to entities)
   */
  async pullCurations() { /* ... */ }
  
  /**
   * Push curations (similar to entities)
   */
  async pushCurations() { /* ... */ }
  
  /**
   * Resolve conflict manually
   */
  async resolveConflict(type, id, resolution) {
    // resolution: 'use_local' | 'use_server' | 'merge'
    // Implementation depends on UI
  }
  
  /**
   * Get sync status
   */
  async getSyncStatus() {
    const pendingPush = await this.dataStorage.db.entities
      .where('sync.status')
      .equals('pending_push')
      .count();
      
    const conflicts = await this.dataStorage.db.entities
      .where('sync.status')
      .equals('conflict')
      .count();
      
    return {
      pendingPush,
      conflicts,
      lastSync: await this.getLastSyncTimestamp()
    };
  }
}
```

#### 3.2 Implement Conflict Resolution UI (1-2 hours)

Create modal to show conflicts and let user choose resolution.

#### 3.3 Test Sync Manager (1 hour)

```javascript
// Test sync scenarios
// 1. Create entity locally → push → verify on server
// 2. Create entity on server → pull → verify locally
// 3. Update both → detect conflict → resolve
```

### Deliverables
- [ ] syncManagerV3.js implemented
- [ ] Pull operations working
- [ ] Push operations working
- [ ] Conflict detection working
- [ ] Conflict resolution UI
- [ ] Comprehensive tests

### Dependencies
Phase 1 (apiService), Phase 2 (dataStorage)

---

## Phase 4: UI Updates (6-8 hours)

### Objective
Update UI modules to work with V3 data structure.

### Tasks

#### 4.1 Update Entity Forms (2-3 hours)

- Update entity creation form to match V3 schema
- Add fields for metadata, data object
- Handle version display

#### 4.2 Update Curation Forms (2-3 hours)

- Update curation creation form
- Ensure entity_id reference works
- Add concepts UI

#### 4.3 Update List Views (1-2 hours)

- Display version numbers
- Show sync status indicators
- Add conflict badges

#### 4.4 Test UI Flow (1 hour)

- Create entity end-to-end
- Create curation end-to-end
- Edit with version conflict
- Sync and verify

### Deliverables
- [ ] Entity forms updated
- [ ] Curation forms updated
- [ ] List views updated
- [ ] Version conflicts handled in UI
- [ ] End-to-end workflows tested

### Dependencies
Phase 1, 2, 3 (all previous phases)

---

## Phase 5: Testing & Polish (4-6 hours)

### Objective
Comprehensive testing and bug fixes.

### Tasks

#### 5.1 End-to-End Testing (2-3 hours)

Test complete workflows:
- [ ] Create entity → sync → verify on server
- [ ] Create curation → sync → verify on server
- [ ] Edit entity locally and on server → conflict → resolve
- [ ] Offline mode → create entities → sync when online
- [ ] Google Places integration → create entity
- [ ] AI transcription → create curation

#### 5.2 Error Handling (1 hour)

- [ ] Network errors handled gracefully
- [ ] API key invalid → show prompt
- [ ] Version conflicts → clear UI
- [ ] Validation errors → helpful messages

#### 5.3 Performance Testing (1 hour)

- [ ] Large entity lists load quickly
- [ ] Sync doesn't block UI
- [ ] IndexedDB queries optimized

#### 5.4 Documentation Update (1 hour)

- [ ] Update README.md
- [ ] Update PROJECT_STATUS.md
- [ ] Create migration guide

### Deliverables
- [ ] All workflows tested
- [ ] Bugs fixed
- [ ] Performance acceptable
- [ ] Documentation updated
- [ ] Ready for production use

### Dependencies
All previous phases

---

## 🎯 Success Criteria

- ✅ All CRUD operations work with API V3
- ✅ Optimistic locking prevents data loss
- ✅ Sync works bi-directionally
- ✅ Conflicts detected and resolvable
- ✅ No obsolete code in codebase
- ✅ ModuleWrapper pattern followed
- ✅ Clean separation of concerns
- ✅ Comprehensive error handling
- ✅ UI responsive and intuitive
- ✅ Performance meets expectations

---

## 📅 Estimated Timeline

### Fast Track (3 days)
- Day 1: Phases 0-2 (Archive, Config, Data Layer)
- Day 2: Phase 3 (Sync Manager)
- Day 3: Phases 4-5 (UI, Testing)

### Standard Track (4 days)
- Day 1: Phases 0-1 (Archive, Config, API Service)
- Day 2: Phase 2 (Data Layer)
- Day 3: Phase 3 (Sync Manager)
- Day 4: Phases 4-5 (UI, Testing)

### Careful Track (5 days)
- Day 1: Phase 0-1 (Archive, Config, API Service)
- Day 2: Phase 2 (Data Layer + Testing)
- Day 3: Phase 3 (Sync Manager + Testing)
- Day 4: Phase 4 (UI Updates)
- Day 5: Phase 5 (Comprehensive Testing)

**Recommended:** Standard Track (4 days)

---

## 🔗 Related Documentation

- [Collector V3 Architecture](./COLLECTOR_V3_ARCHITECTURE.md)
- [API V3 Integration Spec (Histórico)](./archive/api-planning/API_V3_INTEGRATION_SPEC.md)
- [API V3 README](../concierge-api-v3/README.md)
- [Project Status](../PROJECT_STATUS.md)

---

## 📝 Notes

### Testing Strategy

- Unit test each module in isolation
- Integration test API + Storage + Sync
- End-to-end test complete user flows
- Performance test with large datasets

### Rollback Plan

If migration fails:
1. Keep archive/ with old code
2. Can revert to old database name
3. API V3 doesn't affect old data

### Risk Mitigation

- **Data Loss:** Always backup before migration
- **API Changes:** Lock to specific FastAPI/Pydantic versions
- **Conflicts:** Implement clear resolution UI
- **Performance:** Index frequently queried fields

---

**Ready to begin implementation!**
