# Local vs Server Data Conflict Analysis

**Date:** October 19, 2025  
**Issue:** Data inconsistencies between local IndexedDB and server  
**Priority:** 🔴 Critical

---

## Problem Summary

The system is experiencing conflicts between local data and server data due to how the `source` field is managed during sync operations. The `source` field serves dual purposes which creates confusion:

1. **State indicator** - Whether restaurant needs sync ('local' = unsynced, 'remote' = synced)
2. **Origin indicator** - Where restaurant was created (local vs imported from server)

---

## Root Causes Identified

### 1. Semantic Overloading of `source` Field

**Current Implementation:**
```javascript
source: 'local'   // Could mean: created locally OR needs sync
source: 'remote'  // Could mean: came from server OR already synced
```

**Problem:** The same field indicates both origin AND sync status.

**Evidence:**
```javascript
// In dataStorage.js line 1559
source: 'local',     // ALWAYS 'local' after edit (not synced)
needsSync: true,     // Mark as needing sync

// In syncManager.js line 404  
if (!restaurant || restaurant.source === 'remote') {
    // Skips syncing if source='remote' even if data changed
}
```

---

### 2. Source Field Changes During Lifecycle

**Lifecycle of a restaurant:**

```
CREATE (Local)
├─ source: 'local'
├─ needsSync: true
├─ serverId: null
└─ State: "Created locally, not synced"

↓ SYNC TO SERVER

POST-SYNC
├─ source: 'remote'     ← Changed!
├─ needsSync: false
├─ serverId: 123
└─ State: "Synced with server"

↓ USER EDITS

POST-EDIT
├─ source: 'local'      ← Changed back!
├─ needsSync: true
├─ serverId: 123        ← Preserved
└─ State: "Modified locally, needs re-sync"

↓ SYNC AGAIN

POST-RE-SYNC
├─ source: 'remote'     ← Changed again!
├─ needsSync: false
├─ serverId: 123
└─ State: "Re-synced with server"
```

**Problem:** Source flips between 'local' and 'remote' repeatedly, making it unreliable for identifying data origin.

---

### 3. Import Logic Conflicts

**During import from server:**

```javascript
// syncManager.js line 188
if (existingRestaurant.needsSync || existingRestaurant.source === 'local') {
    results.skipped++;
    this.log.debug('Skipping - has local changes');
    continue;
}
```

**Scenario:**
1. User creates restaurant locally (`source: 'local'`)
2. User syncs to server (`source: 'remote', serverId: 123`)
3. User edits restaurant (`source: 'local', serverId: 123`)
4. User imports from server
5. **System skips update** because `source === 'local'`
6. Server changes never applied!

**Result:** Local edits prevent server updates, even if server has newer data.

---

### 4. Bulk Sync Issues

**New bulk sync implementation:**

```javascript
// syncManager.js line 618
if (restaurant.source === 'remote' && restaurant.serverId) {
    results.skipped++;
    continue;  // Skips restaurant that's already synced
}
```

**Problem:** If a restaurant has `source: 'remote'` but was edited locally, bulk sync won't detect it needs updating.

**Missing:** Check for `needsSync` flag in addition to source.

---

## Current State Analysis

### How Source is Used

#### ✅ Correct Usage:
```javascript
// dataStorage.js line 1034 - Determines sync status when saving
const needsSync = !serverId;
const lastSynced = serverId ? new Date() : null;
```

#### ⚠️ Problematic Usage:
```javascript
// syncManager.js line 404 - Skips sync based on source alone
if (!restaurant || restaurant.source === 'remote') {
    this.syncQueue.delete(restaurantId);
    return false;
}
```

Should be:
```javascript
if (!restaurant || (restaurant.source === 'remote' && !restaurant.needsSync)) {
    // Only skip if BOTH remote AND not needing sync
}
```

---

### Redundancy: `source` vs `needsSync`

The system has TWO overlapping indicators:

| Field | Purpose | Problem |
|-------|---------|---------|
| `source` | Origin + Sync state | Dual purpose causes confusion |
| `needsSync` | Sync state only | More explicit, but underused |
| `serverId` | Server identity | Reliable indicator of sync history |

**Recommendation:** Use `needsSync` + `serverId` combination, make `source` origin-only.

---

## Specific Conflict Scenarios

### Scenario 1: Edit After Sync
**Steps:**
1. Create restaurant locally
2. Sync to server → `source: 'remote', serverId: 123, needsSync: false`
3. Edit restaurant → `source: 'local', serverId: 123, needsSync: true`
4. Import from server → **Skipped** because `source === 'local'`

**Expected:** Should check `needsSync` and `serverId` to determine if server update needed.

---

### Scenario 2: Concurrent Edits
**Steps:**
1. User A creates restaurant, syncs → Server ID 123
2. User B imports, gets same restaurant → Local ID 456, Server ID 123
3. User A edits on device 1 → `source: 'local'`
4. User B edits on device 2 → `source: 'local'`
5. Both try to sync → **Conflict!** No conflict resolution

**Expected:** Detect conflicts using timestamps or version numbers.

---

### Scenario 3: Bulk Sync Skips
**Steps:**
1. Import 50 restaurants from server → All have `source: 'remote'`
2. Edit 10 of them → Now have `source: 'local', needsSync: true`
3. Run bulk sync → **All 10 skipped** because bulk sync checks source

**Expected:** Bulk sync should check `needsSync` flag.

---

### Scenario 4: Delete and Re-import
**Steps:**
1. Import restaurant from server → `serverId: 123, source: 'remote'`
2. User deletes locally → `deletedLocally: true, serverId: 123`
3. Import runs again → **Skipped** by line 257 (deletedByServerId check)
4. Restaurant never comes back even if user wants it

**Expected:** This is actually correct! But might confuse users who deleted by mistake.

---

## Data Integrity Checks

### Current State Distribution

Run this in browser console to diagnose:

```javascript
// Check distribution of source values
const restaurants = await dataStorage.db.restaurants.toArray();

const stats = {
    total: restaurants.length,
    local: restaurants.filter(r => r.source === 'local').length,
    remote: restaurants.filter(r => r.source === 'remote').length,
    needsSync: restaurants.filter(r => r.needsSync).length,
    hasServerId: restaurants.filter(r => r.serverId).length,
    
    // Problematic states
    remoteButNeedsSync: restaurants.filter(r => 
        r.source === 'remote' && r.needsSync
    ).length,
    localWithServerId: restaurants.filter(r => 
        r.source === 'local' && r.serverId
    ).length,
    noServerIdNotLocal: restaurants.filter(r => 
        !r.serverId && r.source !== 'local'
    ).length
};

console.table(stats);
```

---

### Inconsistent States

**State 1: Remote but needs sync** 🔴
```javascript
{
    source: 'remote',
    needsSync: true,
    serverId: 123
}
```
**Problem:** Contradictory - if it's remote and synced, why needsSync?

---

**State 2: Local with server ID** ✅ (Actually OK)
```javascript
{
    source: 'local',
    needsSync: true,
    serverId: 123
}
```
**Explanation:** Was synced, then edited. This is correct but confusing naming.

---

**State 3: No server ID but not local** 🔴
```javascript
{
    source: 'remote',
    needsSync: false,
    serverId: null
}
```
**Problem:** Claims to be synced but has no server ID!

---

## Proposed Solutions

### Option 1: Rename `source` to `origin` (Recommended)

**Changes:**
```javascript
// Current
source: 'local' | 'remote'

// Proposed
origin: 'local' | 'remote'  // Never changes after creation
syncStatus: 'synced' | 'pending' | 'modified' | 'failed'
```

**Benefits:**
- Clear separation of origin vs sync state
- More explicit sync status
- Easier to understand code

**Migration:**
```javascript
// Database upgrade
this.db.version(11).stores({
    restaurants: '++id, name, origin, syncStatus, ...'
}).upgrade(tx => {
    return tx.restaurants.toCollection().modify(restaurant => {
        restaurant.origin = restaurant.serverId ? 'remote' : 'local';
        restaurant.syncStatus = restaurant.needsSync ? 'pending' : 'synced';
        delete restaurant.source;  // Remove old field
    });
});
```

---

### Option 2: Use `needsSync` + `serverId` Only (Quick Fix)

**Changes:**
```javascript
// Stop using 'source' for sync decisions
// Use combination of needsSync + serverId instead

// Old code
if (restaurant.source === 'remote') {
    // Skip sync
}

// New code
if (!restaurant.needsSync && restaurant.serverId) {
    // Skip sync
}
```

**Benefits:**
- No database migration needed
- Quick to implement
- Backward compatible

**Implementation:**
1. Update sync logic to check `needsSync` instead of `source`
2. Keep `source` for display/filtering only
3. Always trust `needsSync` + `serverId` combination

---

### Option 3: Add Version Numbers (Advanced)

**Changes:**
```javascript
{
    name: "Restaurant",
    version: 5,              // Increments with each edit
    lastModified: timestamp,
    serverId: 123,
    serverVersion: 3         // Version on server
}
```

**Benefits:**
- Detect conflicts automatically
- Know which version is newer
- Support collaborative editing

**Complexity:** High - requires server changes

---

## Immediate Fixes Needed

### Fix 1: Update Bulk Sync Logic

**File:** `syncManager.js` line 618

**Current:**
```javascript
if (restaurant.source === 'remote' && restaurant.serverId) {
    results.skipped++;
    continue;
}
```

**Fixed:**
```javascript
// Skip only if already synced AND not modified
if (restaurant.serverId && !restaurant.needsSync) {
    results.skipped++;
    continue;
}
```

---

### Fix 2: Update Individual Sync Logic

**File:** `syncManager.js` line 404

**Current:**
```javascript
if (!restaurant || restaurant.source === 'remote') {
    this.syncQueue.delete(restaurantId);
    return false;
}
```

**Fixed:**
```javascript
// Skip only if doesn't need sync
if (!restaurant || (!restaurant.needsSync && restaurant.serverId)) {
    this.syncQueue.delete(restaurantId);
    return false;
}
```

---

### Fix 3: Update Import Logic

**File:** `syncManager.js` line 188

**Current:**
```javascript
if (existingRestaurant.needsSync || existingRestaurant.source === 'local') {
    results.skipped++;
    continue;
}
```

**Fixed:**
```javascript
// Only skip if has local changes that haven't been synced yet
if (existingRestaurant.needsSync) {
    results.skipped++;
    this.log.debug(`Skipping - has pending local changes`);
    continue;
}
```

---

### Fix 4: Improve Sync Status Update

**File:** `syncManager.js` line 508

**Current:**
```javascript
await dataStorage.db.restaurants.update(restaurantId, {
    source: 'remote',
    needsSync: false,
    lastSynced: new Date()
});
```

**Better:**
```javascript
await dataStorage.db.restaurants.update(restaurantId, {
    source: 'remote',
    needsSync: false,
    lastSynced: new Date(),
    serverId: serverId,  // Always update serverId on successful sync
    lastError: null      // Clear any previous errors
});
```

---

## Testing Checklist

### Sync State Tests
- [ ] Create local restaurant → Check `source: 'local', needsSync: true`
- [ ] Sync to server → Check `source: 'remote', needsSync: false, serverId: X`
- [ ] Edit synced restaurant → Check `source: 'local', needsSync: true, serverId: X`
- [ ] Re-sync edited restaurant → Check `source: 'remote', needsSync: false, serverId: X`
- [ ] Import from server → Should not overwrite local changes

### Conflict Resolution Tests
- [ ] Edit locally while server has changes → Detect conflict
- [ ] Sync local changes → Should succeed
- [ ] Import server changes → Should update only if no local changes
- [ ] Delete locally then import → Should stay deleted

### Bulk Sync Tests
- [ ] Bulk sync mixed (local + remote) → Only sync local or needsSync
- [ ] Bulk sync all remote → Should skip all
- [ ] Bulk sync with edits → Should sync edited ones

---

## Monitoring Queries

### Find Inconsistent States

```javascript
// Find restaurants that claim to be synced but have no server ID
const inconsistent1 = await dataStorage.db.restaurants
    .filter(r => r.source === 'remote' && !r.serverId)
    .toArray();

console.log('Remote without server ID:', inconsistent1.length);

// Find restaurants marked needsSync but claim to be synced
const inconsistent2 = await dataStorage.db.restaurants
    .filter(r => r.source === 'remote' && r.needsSync)
    .toArray();

console.log('Remote but needs sync:', inconsistent2.length);

// Find restaurants with server ID but no sync timestamp
const inconsistent3 = await dataStorage.db.restaurants
    .filter(r => r.serverId && !r.lastSynced)
    .toArray();

console.log('Has server ID but no lastSynced:', inconsistent3.length);
```

---

### Count Sync States

```javascript
const syncStates = {
    'Never synced (new)': await dataStorage.db.restaurants
        .filter(r => !r.serverId && r.source === 'local')
        .count(),
    
    'Synced and clean': await dataStorage.db.restaurants
        .filter(r => r.serverId && !r.needsSync)
        .count(),
    
    'Synced but modified': await dataStorage.db.restaurants
        .filter(r => r.serverId && r.needsSync)
        .count(),
    
    'Deleted locally': await dataStorage.db.restaurants
        .filter(r => r.deletedLocally)
        .count()
};

console.table(syncStates);
```

---

## Action Items

### Immediate (Next Deploy)
1. ✅ Implement Fix 1: Bulk sync check `needsSync` instead of `source`
2. ✅ Implement Fix 2: Individual sync check `needsSync`
3. ✅ Implement Fix 3: Import skip only if `needsSync`
4. ✅ Add data integrity check on app startup
5. ✅ Log sync state transitions for debugging

### Short Term (Next Sprint)
1. ⬜ Add conflict detection
2. ⬜ Add conflict resolution UI
3. ⬜ Implement version numbers
4. ⬜ Add sync history/log

### Long Term (Future)
1. ⬜ Rename `source` to `origin` + add `syncStatus`
2. ⬜ Add collaborative editing support
3. ⬜ Implement automatic conflict resolution
4. ⬜ Add sync analytics dashboard

---

## Summary

**Core Issue:** The `source` field is overloaded with dual meanings (origin + sync state), causing sync logic to make incorrect decisions.

**Immediate Fix:** Use `needsSync` + `serverId` combination instead of relying on `source` alone.

**Long-term Fix:** Separate origin (`origin`) from sync state (`syncStatus`) with proper field names.

**Impact:** High - affects all sync operations and can cause data loss if local changes are not synced.

**Priority:** Critical - implement immediate fixes before next production deployment.

---

**Report Created:** October 19, 2025  
**Status:** Ready for Implementation  
**Estimated Fix Time:** 2-4 hours
