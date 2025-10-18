# Sync Status Update Fix

**Date:** 2025-10-18  
**Commit:** 3a6e15c  
**Status:** ✅ Fixed

## Problem

After successfully exporting restaurants to server via `/api/restaurants/batch`, the sync status update was failing with:

```
Error: Missing required parameter: serverId
```

This prevented restaurants from being marked as `'remote'` after successful sync.

## Root Cause

The `exportRestaurants()` method was correctly receiving server responses with restaurant IDs, but when passing results to `syncUnsyncedRestaurants()`, there was no way to match server responses back to local restaurant IDs.

**Original flow:**
1. `exportRestaurants()` sends restaurant → server returns `{id: serverId, ...}`
2. Result stored without `localId` reference
3. `syncUnsyncedRestaurants()` tries to match by array index (unreliable if some exports fail)
4. Mismatch causes `serverId` to be `undefined`

## Solution

**Modified `exportRestaurants()`** (syncService.js ~line 705):
```javascript
// Include localId in result so we can match it later
results.restaurants.push({
    ...serverRestaurant,
    localId: restaurant.localId  // Add localId to match with local database
});
```

**Modified `syncUnsyncedRestaurants()`** (syncService.js ~line 818):
```javascript
// Each restaurant in result includes localId and server id
for (const serverRestaurant of result.restaurants) {
    if (!serverRestaurant || !serverRestaurant.id) {
        console.warn('SyncService: Server restaurant missing id, skipping');
        continue;
    }
    
    if (!serverRestaurant.localId) {
        console.warn('SyncService: Server restaurant missing localId, skipping');
        continue;
    }
    
    const localId = serverRestaurant.localId;
    const serverId = serverRestaurant.id;
    
    console.log(`SyncService: Updating restaurant ${localId} with serverId ${serverId}`);
    
    try {
        await dataStorage.updateRestaurantSyncStatus(localId, serverId);
        syncedCount++;
    } catch (updateError) {
        console.error(`SyncService: Error updating sync status for restaurant ${localId}:`, updateError);
    }
}
```

## Key Changes

1. ✅ **Preserve localId mapping**: `exportRestaurants()` now includes `localId` in results
2. ✅ **Direct matching**: No longer relies on array index matching
3. ✅ **Better validation**: Checks for both `id` and `localId` before updating
4. ✅ **Error handling**: Individual restaurant failures don't break entire sync
5. ✅ **Logging**: Clear console logs show which restaurant is being updated

## Expected Behavior After Fix

1. User clicks **Sync** button
2. All 11 restaurants POST to `/api/restaurants/batch` ✅ (was working)
3. Server responds with restaurant IDs ✅ (was working)
4. `dataStorage.updateRestaurantSyncStatus()` called with valid `localId` and `serverId` ✅ (NOW FIXED)
5. Restaurants marked as `source='remote'`, `needsSync=false` ✅ (NOW FIXED)
6. Console shows: `"SyncService: Successfully synced 11 restaurants"` ✅ (NOW FIXED)
7. UI updates to show "Remote" badge instead of "Local" ✅ (NOW FIXED)

## Testing

**Before Fix:**
```
✅ POST /api/restaurants/batch (all 11 restaurants)
✅ Server returns 200 OK with IDs
❌ Error: Missing required parameter: serverId
❌ Restaurants stay marked as 'local'
```

**After Fix (Expected):**
```
✅ POST /api/restaurants/batch (all 11 restaurants)
✅ Server returns 200 OK with IDs
✅ SyncService: Updating restaurant 1 with serverId 0
✅ SyncService: Updating restaurant 2 with serverId 1
... (repeat for all 11)
✅ SyncService: Successfully synced 11 restaurants
✅ Restaurants marked as 'remote'
```

## Related Files

- `scripts/syncService.js` - Main sync logic (modified)
- `scripts/dataStorage.js` - `updateRestaurantSyncStatus()` method (unchanged)
- `scripts/backgroundSync.js` - Uses same batch endpoint pattern (already working)

## Related Issues

- **Previous fix (67174a5)**: Changed from `/api/restaurants` to `/api/restaurants/batch`
- **This fix (3a6e15c)**: Fixed sync status update to use correct restaurant IDs

## Next Steps

1. **User refresh browser** - Load updated code
2. **Click Sync button** - Test full sync flow
3. **Verify console logs** - Should show "Successfully synced 11 restaurants"
4. **Check restaurant badges** - Should change from "Local" to "Remote"
5. **Verify database** - Open DevTools → Application → IndexedDB → restaurants → check `source` field

## Success Criteria

- ✅ No errors in console during sync
- ✅ All 11 restaurants sync successfully
- ✅ Console shows: `"SyncService: Successfully synced 11 restaurants"`
- ✅ Restaurant source changed from `'local'` to `'remote'`
- ✅ Restaurant `needsSync` set to `false`
- ✅ UI badges show "Remote" instead of "Local"
