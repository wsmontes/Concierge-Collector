# IndexedDB Fixes - Implementation Roadmap

**Date:** Janeiro 30, 2026  
**Based on:** INDEXEDDB_IMPLEMENTATION_REVIEW.md, INDEXEDDB_USAGE_ANALYSIS.md, MONGODB_CONSISTENCY_ANALYSIS.md  
**Goal:** Fix critical data integrity and consistency issues  
**Approach:** Incremental refactoring (NOT rewrite)

---

## Executive Summary

**Current State:**
- Implementation Quality: 4/10 ❌
- Data Consistency: 5/10 ⚠️
- IndexedDB Necessity: YES ✅ (17-120MB offline data)

**Critical Issues (Must Fix):**
1. ❌ Zero frontend validation → sync failures
2. ❌ Conflict handling missing → data loss
3. ❌ Nested property index broken → slow queries
4. ❌ No transactions → partial failures
5. ❌ Duplicate sync → 500 errors

**Approach:** 3 phases, ~2 weeks total

---

## Phase 1: Data Integrity (Week 1) - CRÍTICO

**Objective:** Prevent data loss and sync failures

### Task 1.1: Frontend Validation (2-3 hours)

**File:** `scripts/storage/dataStore.js`

**Problem:**
```javascript
// ❌ Atual: Aceita dados inválidos
async createEntity(entityData) {
    const entity = {
        type: entityData.type || 'restaurant',  // Aceita qualquer string
        name: entityData.name,                  // Pode ser undefined
        status: entityData.status || 'active'   // Aceita qualquer string
    };
    return await this.db.entities.add(entity);
}
```

**Fix:**
```javascript
// ✅ Novo: Valida antes de salvar
async createEntity(entityData) {
    // Validate required fields
    if (!entityData.name || entityData.name.trim().length === 0) {
        throw new Error('Entity name is required');
    }
    
    if (entityData.name.length > 500) {
        throw new Error('Entity name must be 500 characters or less');
    }
    
    // Validate type enum
    const validTypes = ['restaurant', 'hotel', 'venue', 'bar', 'cafe', 'other'];
    const type = entityData.type || 'restaurant';
    if (!validTypes.includes(type)) {
        throw new Error(`Invalid entity type: ${type}. Must be one of: ${validTypes.join(', ')}`);
    }
    
    // Validate status enum
    const validStatuses = ['active', 'inactive', 'draft'];
    const status = entityData.status || 'active';
    if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(', ')}`);
    }
    
    // Generate entity_id if not provided
    const entity_id = entityData.entity_id || this.generateEntityId();
    
    // Validate entity_id format (deve começar com prefixo válido)
    if (!entity_id.match(/^(entity_|rest_|ent_)/)) {
        throw new Error(`Invalid entity_id format: ${entity_id}`);
    }
    
    const entity = {
        entity_id,
        type,
        name: entityData.name.trim(),
        status,
        externalId: entityData.externalId || null,
        metadata: entityData.metadata || [],
        data: entityData.data || {},
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: entityData.createdBy || null,
        version: 1,
        syncStatus: 'pending'  // Flat property (not sync.status)
    };
    
    const id = await this.db.entities.add(entity);
    this.log.debug(`✅ Entity created: ${entity.name} (${entity_id})`);
    return entity;
}
```

**Similar fix for createCuration:**
```javascript
async createCuration(curationData) {
    // Validate required fields
    if (!curationData.entity_id) {
        throw new Error('entity_id is required');
    }
    
    if (!curationData.curator_id) {
        throw new Error('curator_id is required');
    }
    
    // Verify entity exists
    const entity = await this.db.entities
        .where('entity_id')
        .equals(curationData.entity_id)
        .first();
    
    if (!entity) {
        throw new Error(`Entity ${curationData.entity_id} not found`);
    }
    
    // Generate curation_id if not provided
    const curation_id = curationData.curation_id || this.generateCurationId();
    
    const curation = {
        curation_id,
        entity_id: curationData.entity_id,
        curator_id: curationData.curator_id,
        curatorName: curationData.curatorName || 'Unknown',
        categories: curationData.categories || {},
        notes: curationData.notes || { public: null, private: null },
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
        syncStatus: 'pending'
    };
    
    const id = await this.db.curations.add(curation);
    this.log.debug(`✅ Curation created: ${curation_id}`);
    return curation;
}
```

**Add helper methods:**
```javascript
generateEntityId() {
    return `ent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

generateCurationId() {
    return `cur_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
```

**Testing:**
```javascript
// Test validation
try {
    await dataStore.createEntity({ name: '' });  // Should throw
} catch (e) {
    console.log('✅ Validation works:', e.message);
}
```

---

### Task 1.2: Schema Version 9 - Fix Nested Properties (2-3 hours)

**File:** `scripts/storage/dataStore.js`

**Problem:**
```javascript
// ❌ Version 8: Nested property não funciona
this.db.version(8).stores({
    entities: '++id, entity_id, ..., sync.status',  // Index quebrado
    curations: '++id, curation_id, ..., sync.status'
});
```

**Fix:**
```javascript
// ✅ Version 9: Flat property + compound indexes
this.db.version(9).stores({
    // Core tables - FIX sync.status → syncStatus
    entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, syncStatus, [type+syncStatus], [createdBy+createdAt]',
    curations: '++id, curation_id, entity_id, curator_id, createdAt, updatedAt, etag, syncStatus, [entity_id+curator_id], [curator_id+createdAt]',
    curators: '++id, curator_id, name, email, status, createdAt, lastActive',
    
    // System tables
    syncQueue: '++id, type, action, entity_id, createdAt, retryCount, syncStatus, [syncStatus+createdAt]',
    settings: 'key',
    
    // Recording module
    draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
    pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status'
    
    // ✅ REMOVED: cache (não usada), drafts (duplicada)
});

// Migration: Flatten sync.status → syncStatus
this.db.version(9).upgrade(async tx => {
    this.log.debug('🔄 Migrating schema v8 → v9...');
    
    // Migrate entities
    await tx.table('entities').toCollection().modify(entity => {
        if (entity.sync && entity.sync.status) {
            entity.syncStatus = entity.sync.status;
        } else {
            entity.syncStatus = 'synced';
        }
        // Keep sync object for serverId (still needed)
    });
    
    // Migrate curations
    await tx.table('curations').toCollection().modify(curation => {
        if (curation.sync && curation.sync.status) {
            curation.syncStatus = curation.sync.status;
        } else {
            curation.syncStatus = 'synced';
        }
    });
    
    // Migrate syncQueue
    await tx.table('syncQueue').toCollection().modify(item => {
        if (!item.syncStatus) {
            item.syncStatus = item.status || 'pending';
        }
    });
    
    this.log.debug('✅ Migration v8 → v9 complete');
});
```

**Update queries to use new flat property:**
```javascript
// ❌ Antes (quebrado)
const pending = await db.entities.where('sync.status').equals('pending').toArray();

// ✅ Depois (com index)
const pending = await db.entities.where('syncStatus').equals('pending').toArray();
```

**Testing:**
```javascript
// Verify migration worked
const entities = await db.entities.limit(5).toArray();
entities.forEach(e => {
    console.log(`Entity ${e.name}: syncStatus=${e.syncStatus}`);
    if (e.syncStatus === undefined) {
        console.error('❌ Migration failed!');
    }
});
```

---

### Task 1.3: Add Transactions (3-4 hours)

**File:** `scripts/storage/dataStore.js`

**Problem:**
```javascript
// ❌ Sem transaction: se curation falhar, entity fica órfão
async createEntity(entityData) {
    const entityId = await this.db.entities.add(entity);
    await this.db.syncQueue.add({ type: 'entity', entity_id });  // Pode falhar
    return entity;
}
```

**Fix:**
```javascript
// ✅ Com transaction: all-or-nothing
async createEntity(entityData) {
    // Validate first (outside transaction)
    this.validateEntity(entityData);
    
    let entity, entityId;
    
    // Transaction: entity + syncQueue together
    await this.db.transaction('rw', [this.db.entities, this.db.syncQueue], async () => {
        entity = {
            entity_id: entityData.entity_id || this.generateEntityId(),
            type: entityData.type || 'restaurant',
            name: entityData.name.trim(),
            status: entityData.status || 'active',
            externalId: entityData.externalId || null,
            metadata: entityData.metadata || [],
            data: entityData.data || {},
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: entityData.createdBy || null,
            version: 1,
            syncStatus: 'pending'
        };
        
        entityId = await this.db.entities.add(entity);
        
        // Add to sync queue
        await this.db.syncQueue.add({
            type: 'entity',
            action: 'create',
            entity_id: entity.entity_id,
            data: entity,
            createdAt: new Date(),
            retryCount: 0,
            syncStatus: 'pending'
        });
        
        this.log.debug(`✅ Entity + sync queue created: ${entity.name}`);
    });
    
    return entity;
}
```

**Similar for createCuration:**
```javascript
async createCuration(curationData) {
    // Validate first
    this.validateCuration(curationData);
    
    let curation, curationId;
    
    // Transaction: curation + syncQueue together
    await this.db.transaction('rw', [this.db.curations, this.db.syncQueue], async () => {
        curation = {
            curation_id: curationData.curation_id || this.generateCurationId(),
            entity_id: curationData.entity_id,
            curator_id: curationData.curator_id,
            curatorName: curationData.curatorName || 'Unknown',
            categories: curationData.categories || {},
            notes: curationData.notes || { public: null, private: null },
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1,
            syncStatus: 'pending'
        };
        
        curationId = await this.db.curations.add(curation);
        
        // Add to sync queue
        await this.db.syncQueue.add({
            type: 'curation',
            action: 'create',
            entity_id: curation.entity_id,
            data: curation,
            createdAt: new Date(),
            retryCount: 0,
            syncStatus: 'pending'
        });
        
        this.log.debug(`✅ Curation + sync queue created: ${curation.curation_id}`);
    });
    
    return curation;
}
```

**Extract validation methods:**
```javascript
validateEntity(entityData) {
    if (!entityData.name || entityData.name.trim().length === 0) {
        throw new Error('Entity name is required');
    }
    
    if (entityData.name.length > 500) {
        throw new Error('Entity name must be 500 characters or less');
    }
    
    const validTypes = ['restaurant', 'hotel', 'venue', 'bar', 'cafe', 'other'];
    const type = entityData.type || 'restaurant';
    if (!validTypes.includes(type)) {
        throw new Error(`Invalid entity type: ${type}`);
    }
    
    const validStatuses = ['active', 'inactive', 'draft'];
    const status = entityData.status || 'active';
    if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: ${status}`);
    }
}

validateCuration(curationData) {
    if (!curationData.entity_id) {
        throw new Error('entity_id is required');
    }
    
    if (!curationData.curator_id) {
        throw new Error('curator_id is required');
    }
}
```

---

### Task 1.4: Conflict Resolution (3-4 hours)

**File:** `scripts/services/apiService.js`

**Problem:**
```javascript
// ❌ Atual: 409 Conflict mata o sync
async updateEntity(entityId, updates, currentVersion) {
    const response = await this.request('PATCH', `/entities/${entityId}`, {
        headers: { 'If-Match': String(currentVersion) }
    });
    return await response.json();  // Se 409, exception não tratada
}
```

**Fix:**
```javascript
// ✅ Novo: Handle conflicts automaticamente
async updateEntity(entityId, updates, currentVersion, retryCount = 0) {
    try {
        const response = await this.request('PATCH', `/entities/${entityId}`, {
            headers: { 'If-Match': String(currentVersion) },
            body: JSON.stringify(updates)
        });
        return await response.json();
        
    } catch (error) {
        // Handle version conflict
        if (error.status === 409 && retryCount < 3) {
            this.log.warn(`⚠️ Version conflict for ${entityId}, attempting merge...`);
            
            // Fetch latest version from server
            const latest = await this.getEntity(entityId);
            
            // Merge changes (server wins for conflicts)
            const merged = this.mergeUpdates(updates, latest);
            
            // Retry with new version
            return await this.updateEntity(entityId, merged, latest.version, retryCount + 1);
        }
        
        throw error;
    }
}

/**
 * Merge local updates with server version
 * Strategy: Last-write-wins, server version takes precedence
 */
mergeUpdates(localUpdates, serverEntity) {
    const merged = { ...localUpdates };
    
    // If fields conflict, log warning and use server version
    Object.keys(localUpdates).forEach(key => {
        if (serverEntity[key] !== undefined && 
            JSON.stringify(localUpdates[key]) !== JSON.stringify(serverEntity[key])) {
            this.log.warn(`⚠️ Conflict on field ${key}: keeping server version`);
            // Server wins - remove from merged updates
            delete merged[key];
        }
    });
    
    return merged;
}
```

**Handle duplicate entity creation:**
```javascript
async createEntity(entity) {
    try {
        const response = await this.request('POST', '/entities', {
            body: JSON.stringify(entity)
        });
        return await response.json();
        
    } catch (error) {
        // Handle duplicate entity
        if (error.status === 500 && error.message?.includes('already exists')) {
            this.log.warn(`⚠️ Entity ${entity.entity_id} already exists, fetching from server...`);
            
            // Fetch existing entity instead of failing
            return await this.getEntity(entity.entity_id);
        }
        
        throw error;
    }
}
```

---

## Phase 2: Performance & Optimization (Week 2)

**Objective:** Speed up queries and reduce data bloat

### Task 2.1: Bulk Operations (2-3 hours)

**File:** `scripts/storage/dataStore.js`

**Problem:**
```javascript
// ❌ Atual: Import de 100 entities em loop
for (const entity of entities) {
    await db.entities.add(entity);  // 100 × 50ms = 5 segundos
}
```

**Fix:**
```javascript
// ✅ Novo: Bulk import com transaction
async bulkCreateEntities(entities) {
    // Validate all first
    entities.forEach(e => this.validateEntity(e));
    
    let ids;
    
    await this.db.transaction('rw', [this.db.entities, this.db.syncQueue], async () => {
        // Prepare entities with defaults
        const preparedEntities = entities.map(e => ({
            entity_id: e.entity_id || this.generateEntityId(),
            type: e.type || 'restaurant',
            name: e.name.trim(),
            status: e.status || 'active',
            externalId: e.externalId || null,
            metadata: e.metadata || [],
            data: e.data || {},
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: e.createdBy || null,
            version: 1,
            syncStatus: 'pending'
        }));
        
        // Bulk add (muito mais rápido)
        ids = await this.db.entities.bulkAdd(preparedEntities, { allKeys: true });
        
        // Bulk add to sync queue
        const syncItems = preparedEntities.map(e => ({
            type: 'entity',
            action: 'create',
            entity_id: e.entity_id,
            data: e,
            createdAt: new Date(),
            retryCount: 0,
            syncStatus: 'pending'
        }));
        
        await this.db.syncQueue.bulkAdd(syncItems);
        
        this.log.debug(`✅ Bulk created ${ids.length} entities`);
    });
    
    return ids;
}
```

**Similar for curations:**
```javascript
async bulkCreateCurations(curations) {
    curations.forEach(c => this.validateCuration(c));
    
    let ids;
    
    await this.db.transaction('rw', [this.db.curations, this.db.syncQueue], async () => {
        const preparedCurations = curations.map(c => ({
            curation_id: c.curation_id || this.generateCurationId(),
            entity_id: c.entity_id,
            curator_id: c.curator_id,
            curatorName: c.curatorName || 'Unknown',
            categories: c.categories || {},
            notes: c.notes || { public: null, private: null },
            createdAt: new Date(),
            updatedAt: new Date(),
            version: 1,
            syncStatus: 'pending'
        }));
        
        ids = await this.db.curations.bulkAdd(preparedCurations, { allKeys: true });
        
        const syncItems = preparedCurations.map(c => ({
            type: 'curation',
            action: 'create',
            entity_id: c.entity_id,
            data: c,
            createdAt: new Date(),
            retryCount: 0,
            syncStatus: 'pending'
        }));
        
        await this.db.syncQueue.bulkAdd(syncItems);
        
        this.log.debug(`✅ Bulk created ${ids.length} curations`);
    });
    
    return ids;
}
```

---

### Task 2.2: Optimize Queries (2-3 hours)

**Files:** Various query locations

**Problem:**
```javascript
// ❌ Atual: filter() bypassa indexes
const results = await db.entities
    .where('entity_id').equals(entityId)
    .filter(e => e.createdBy === curatorId);  // Full scan depois do where
```

**Fix:**
```javascript
// ✅ Novo: Use compound indexes
const results = await db.entities
    .where('[createdBy+createdAt]')
    .between([curatorId, minDate], [curatorId, maxDate]);  // Index usado
```

**Common query patterns to fix:**

1. **Entities by curator + date:**
```javascript
// ❌ Antes
getEntitiesByCurator(curatorId, since) {
    return db.entities
        .where('createdBy').equals(curatorId)
        .filter(e => e.createdAt >= since)
        .toArray();
}

// ✅ Depois
getEntitiesByCurator(curatorId, since) {
    return db.entities
        .where('[createdBy+createdAt]')
        .between([curatorId, since], [curatorId, new Date('2099-12-31')])
        .toArray();
}
```

2. **Curations by entity + curator:**
```javascript
// ❌ Antes
getEntityCurationsByCurator(entityId, curatorId) {
    return db.curations
        .where('entity_id').equals(entityId)
        .filter(c => c.curator_id === curatorId)
        .toArray();
}

// ✅ Depois
getEntityCurationsByCurator(entityId, curatorId) {
    return db.curations
        .where('[entity_id+curator_id]')
        .equals([entityId, curatorId])
        .toArray();
}
```

3. **Pending sync items:**
```javascript
// ❌ Antes
getPendingSyncItems() {
    return db.syncQueue
        .where('syncStatus').equals('pending')
        .toArray();  // Sem ordenação
}

// ✅ Depois
getPendingSyncItems() {
    return db.syncQueue
        .where('[syncStatus+createdAt]')
        .between(['pending', new Date(0)], ['pending', new Date()])
        .toArray();  // Ordenado por data (FIFO)
}
```

---

### Task 2.3: Clean Up Legacy Tables (1 hour)

**File:** `scripts/storage/dataStore.js`

**Remove unused tables from schema v9:**

```javascript
// ✅ Version 9: Tabelas limpas
this.db.version(9).stores({
    // Core tables
    entities: '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, syncStatus, [type+syncStatus], [createdBy+createdAt]',
    curations: '++id, curation_id, entity_id, curator_id, createdAt, updatedAt, etag, syncStatus, [entity_id+curator_id], [curator_id+createdAt]',
    curators: '++id, curator_id, name, email, status, createdAt, lastActive',
    
    // System tables
    syncQueue: '++id, type, action, entity_id, createdAt, retryCount, syncStatus, [syncStatus+createdAt]',
    settings: 'key',
    
    // Recording module
    draftRestaurants: '++id, curatorId, name, timestamp, lastModified, hasAudio',
    pendingAudio: '++id, restaurantId, draftId, timestamp, retryCount, status'
    
    // ❌ REMOVED:
    // - cache (zero uso no código)
    // - drafts (sobreposta por draftRestaurants)
});

// No upgrade, just let Dexie remove unused tables automatically
```

**Verify cleanup:**
```javascript
// After migration, verify tables
const tables = db.tables.map(t => t.name);
console.log('Active tables:', tables);
// Should NOT include: cache, drafts
```

---

## Phase 3: Additional Improvements (Backlog)

**Lower priority, can be done later**

### Task 3.1: Migrate Settings to localStorage (1-2 hours)

**Rationale:** Settings are <10KB, don't need IndexedDB

```javascript
// ❌ Atual
await db.settings.put({ key: 'theme', value: 'dark' });

// ✅ Novo
localStorage.setItem('concierge_theme', 'dark');
```

---

### Task 3.2: Remove Curators Table (2-3 hours)

**Rationale:** Always fetch from API (always online during login)

```javascript
// ❌ Atual
const curators = await db.curators.toArray();

// ✅ Novo
const curators = await apiService.getCurators();  // Fresh data
```

---

### Task 3.3: Backend Bulk Endpoint (Backend work)

**Create:** `POST /api/v3/entities/bulk`

```python
@router.post("/bulk", status_code=201)
def bulk_create_entities(entities: List[EntityCreate], db: Database):
    """Create multiple entities in one request"""
    results = []
    for entity_data in entities:
        # Reuse existing create logic
        doc = entity_data.model_dump()
        doc["_id"] = entity_data.entity_id
        doc["createdAt"] = datetime.now(timezone.utc)
        doc["version"] = 1
        
        try:
            db.entities.insert_one(doc)
            results.append({"id": doc["_id"], "success": True})
        except DuplicateKeyError:
            results.append({"id": doc["_id"], "success": False, "error": "duplicate"})
    
    return {"results": results}
```

---

## Testing Checklist

### After Phase 1:

- [ ] Create entity with invalid name → should throw error
- [ ] Create entity with invalid type → should throw error
- [ ] Query by syncStatus → should use index (fast)
- [ ] Create entity → should add to syncQueue atomically
- [ ] Update entity with version conflict → should auto-merge
- [ ] Create duplicate entity → should fetch existing

### After Phase 2:

- [ ] Bulk import 100 entities → <1 second
- [ ] Query entities by curator + date → <20ms
- [ ] Query curations by entity + curator → <20ms
- [ ] Verify cache table removed
- [ ] Verify drafts table removed

---

## Rollback Plan

**If something breaks:**

1. Schema v9 migration fails:
   - Keep v8, fix migration code
   - Test migration on copy of database first

2. Validation too strict:
   - Add feature flag: `ENABLE_STRICT_VALIDATION=false`
   - Temporarily bypass for debugging

3. Conflict resolution breaks sync:
   - Disable auto-merge, show conflict UI
   - Let user choose version manually

---

## Success Metrics

| Metric | Before | Target | How to Measure |
|--------|--------|--------|----------------|
| Frontend validation errors | 0% caught | 100% caught | Try invalid entity creation |
| Sync failures (conflicts) | 100% data loss | 0% data loss | Create conflict scenario |
| Query time (sync status) | 50-200ms | 5-20ms | `console.time()` on queries |
| Bulk import speed | 10 items/sec | 100 items/sec | Import 100 entities |
| Transaction safety | 60% atomic | 100% atomic | Kill browser mid-create |

---

## Implementation Order

**Week 1 (Must Have):**
1. Monday: Task 1.1 - Frontend Validation (3h)
2. Tuesday: Task 1.2 - Schema v9 Migration (3h)
3. Wednesday: Task 1.3 - Add Transactions (4h)
4. Thursday: Task 1.4 - Conflict Resolution (4h)
5. Friday: Testing + Bug fixes

**Week 2 (Should Have):**
1. Monday: Task 2.1 - Bulk Operations (3h)
2. Tuesday: Task 2.2 - Optimize Queries (3h)
3. Wednesday: Task 2.3 - Clean Up Legacy (1h)
4. Thursday: Integration testing
5. Friday: Deploy + Monitor

**Backlog (Nice to Have):**
- Task 3.1 - Migrate Settings
- Task 3.2 - Remove Curators Table
- Task 3.3 - Backend Bulk Endpoint

---

## Next Action

**Start with:** Task 1.1 - Frontend Validation (highest impact, lowest risk)

```bash
# Create feature branch
git checkout -b fix/indexeddb-data-integrity

# Start implementing validation in dataStore.js
```

Ready to begin? 🚀
