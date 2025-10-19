# Complete Fix: Deleted Restaurants Coming Back After Sync

**Date:** October 18, 2025  
**Issue:** ANY deleted restaurant (local or synced) was reappearing after sync  
**Root Cause:** Query methods were not filtering out soft-deleted restaurants  

---

## The Problem

When a user deleted a restaurant, it was marked as `deletedLocally=true` but:
1. ✅ Import logic would skip re-importing it (previously fixed)
2. ❌ **Query methods still returned deleted restaurants**
3. ❌ **UI showed deleted restaurants again after sync**

The issue was that restaurants were being soft-deleted (flagged), but the query methods didn't filter them out.

---

## The Complete Solution

### Fix #1: Filter deleted restaurants in `getRestaurants()`
**File:** `scripts/dataStorage.js` (lines ~803-812)

```javascript
} else {
    // No curator filtering
    console.log(`Getting all restaurants (no curator filter)`);
    let allRestaurants = await this.db.restaurants.toArray();
    
    // Filter out soft-deleted restaurants unless explicitly requested
    if (!includeDeleted) {
        allRestaurants = allRestaurants.filter(r => !r.deletedLocally);
        console.log(`Filtered out soft-deleted restaurants. Remaining: ${allRestaurants.length}`);
    }
    
    return await this.processRestaurants(allRestaurants, deduplicate);
}
```

**What it does:** When getting all restaurants (no curator filter), now filters out soft-deleted ones.

---

### Fix #2: Filter deleted restaurants in `getUnsyncedRestaurants()`
**File:** `scripts/dataStorage.js` (lines ~1371-1377)

```javascript
async getUnsyncedRestaurants() {
    try {
        // Filter out soft-deleted restaurants - they should NOT be synced
        const unsyncedRestaurants = await this.db.restaurants
            .where('source')
            .equals('local')
            .and(r => !r.deletedLocally)  // ← NEW: Exclude deleted
            .toArray();
            
        console.log(`Found ${unsyncedRestaurants.length} unsynced restaurants (source='local' and not deleted)`);
```

**What it does:** Prevents deleted restaurants from being included in sync operations.

---

### Fix #3: Filter deleted restaurants in `getRestaurantsByCurator()`
**File:** `scripts/dataStorage.js` (lines ~1734-1742)

```javascript
async getRestaurantsByCurator(curatorId) {
    // Filter out soft-deleted restaurants
    const restaurants = await this.db.restaurants
        .where('curatorId')
        .equals(curatorId)
        .and(r => !r.deletedLocally)  // ← NEW: Exclude deleted
        .toArray();
    
    // Enhance restaurants with concepts and location data
```

**What it does:** When getting restaurants by curator, excludes soft-deleted ones.

---

## Testing

### Quick Test
1. **Refresh the app** (Cmd+R or F5)
2. Delete a restaurant (any restaurant)
3. Sync from server (Import from Remote button)
4. **Verify:** Restaurant stays deleted
5. **Check console:** Should see "Filtered out soft-deleted restaurants"

### Detailed Verification
Open browser console and run:
```javascript
// Check for deleted restaurants in database
const allRestaurants = await window.DataStorage.db.restaurants.toArray();
const deletedRestaurants = allRestaurants.filter(r => r.deletedLocally);
console.log('Deleted restaurants in DB:', deletedRestaurants.length, deletedRestaurants);

// Check what getRestaurants() returns
const visibleRestaurants = await window.DataStorage.getRestaurants();
console.log('Visible restaurants:', visibleRestaurants.length);

// Verify none are deleted
const visibleDeleted = visibleRestaurants.filter(r => r.deletedLocally);
console.log('Visible restaurants that are deleted:', visibleDeleted.length); // Should be 0
```

Expected results:
- Database may contain deleted restaurants (soft delete)
- `getRestaurants()` should return 0 deleted restaurants
- UI should not show deleted restaurants

---

## What Changed

### Before
- Restaurants marked as `deletedLocally=true` were still returned by query methods
- UI displayed deleted restaurants after sync
- Import wouldn't restore them, but they were never hidden

### After
- All query methods filter out `deletedLocally=true` restaurants
- UI never shows deleted restaurants
- Sync operations exclude deleted restaurants
- User's delete action is permanent in the UI

---

## Technical Details

### Soft Delete Pattern
- Restaurants are marked `deletedLocally=true` instead of being removed from database
- This preserves data integrity and sync history
- Query methods must explicitly filter them out

### Filter Locations
1. `getRestaurants()` - Main query method (used by UI)
2. `getUnsyncedRestaurants()` - Sync operations
3. `getRestaurantsByCurator()` - Curator-specific queries

All three now exclude `deletedLocally=true` restaurants.

### Console Logging
New log messages help verify the fix:
- "Filtered out soft-deleted restaurants. Remaining: X"
- "Found X unsynced restaurants (source='local' and not deleted)"

---

## Edge Cases Handled

✅ Deleted local restaurants (never synced)  
✅ Deleted synced restaurants (have serverId)  
✅ Re-importing after delete  
✅ Syncing after delete  
✅ Getting restaurants by curator  
✅ Getting all restaurants  

---

## Files Modified

1. `scripts/dataStorage.js` - Three query methods updated
2. `_docs/DELETE_RESTAURANTS_COMPLETE_FIX.md` - This documentation

---

## Summary

**Problem:** Deleted restaurants were coming back after sync  
**Root Cause:** Query methods didn't filter `deletedLocally=true`  
**Solution:** Added `.and(r => !r.deletedLocally)` to all query methods  
**Result:** Deleted restaurants stay deleted forever  
