# Fix: Synced Restaurants Reappearing After Delete (Scenario B)

**Date:** October 18, 2025  
**Issue:** Deleted synced restaurants keep coming back after sync/import  
**Root Cause:** Import logic was restoring soft-deleted restaurants

---

## The Problem

When you delete a synced restaurant:
1. System performs **soft delete** (sets `deletedLocally = true`)
2. Tries to delete from server (may fail if already gone)
3. Restaurant stays in local database but hidden

**But then:** When you sync/import from server:
- Import finds the same restaurant in server data
- Import logic **overwrites** `deletedLocally` back to `false`
- Restaurant reappears in your list!

### Example Flow (Before Fix)

```
1. User deletes "Toca do Lobo" (synced restaurant)
   → deletedLocally = true (hidden from UI)
   
2. Server DELETE fails (restaurant already deleted on server)
   → Restaurant marked as local, still soft-deleted
   
3. User syncs from server again
   → Server sends "Toca do Lobo" data
   → Import overwrites deletedLocally = false
   → Restaurant REAPPEARS!
```

---

## The Solution

### Fix #1: Respect Local Delete State During Import

**File:** `scripts/dataStorage.js` (lines ~2090-2095)

Added check to **skip import** of restaurants that user has deleted:

```javascript
// Check if restaurant already exists
const restaurantName = collectorMeta.data.name;

// CRITICAL FIX: Check if this restaurant was soft-deleted by user
// Do NOT re-import restaurants that user explicitly deleted
const existingRestaurant = await this.db.restaurants
    .where('name')
    .equals(restaurantName)
    .and(r => r.curatorId === curatorId)
    .first();

// Skip import if restaurant is soft-deleted locally (user deleted it)
if (existingRestaurant && existingRestaurant.deletedLocally === true) {
    console.log(`Skipping import of "${restaurantName}" - restaurant was deleted by user`);
    continue; // Skip this restaurant
}
```

**What it does:**
- Before importing a restaurant, checks if it already exists locally
- If exists AND `deletedLocally === true`, **skips the import completely**
- This prevents deleted restaurants from being restored

### Fix #2: Prevent Overwriting Delete Status

**File:** `scripts/dataStorage.js` (lines ~2118-2127)

Modified update logic to **preserve local delete state**:

```javascript
// CRITICAL FIX: Only update deletedLocally if restaurant is NOT already soft-deleted locally
// This prevents sync from restoring restaurants that user has deleted
if (restaurantMeta.sync.deletedLocally !== undefined && !existingRestaurant.deletedLocally) {
    updateData.deletedLocally = restaurantMeta.sync.deletedLocally;
}
if (restaurantMeta.sync.deletedAt && !existingRestaurant.deletedLocally) {
    updateData.deletedAt = new Date(restaurantMeta.sync.deletedAt);
}
```

**What it does:**
- Only updates `deletedLocally` from server if restaurant is **not already deleted locally**
- If user has deleted it locally (`deletedLocally = true`), server data cannot override it
- Double protection in case Fix #1 is bypassed somehow

---

## Testing the Fix

### Test Case 1: Delete Synced Restaurant

1. **Setup:**
   - Have a synced restaurant (e.g., "Toca do Lobo")
   - Restaurant has `serverId` and `source = 'remote'`

2. **Action:**
   - Delete the restaurant

3. **Expected Result:**
   - Restaurant disappears from list
   - Console shows: "Performing soft delete + server delete (synced restaurant)"
   - Database: `deletedLocally = true`

4. **Action:**
   - Sync from server again

5. **Expected Result:**
   - Console shows: `Skipping import of "Toca do Lobo" - restaurant was deleted by user`
   - Restaurant **does NOT reappear** in list
   - Database still has `deletedLocally = true`

### Test Case 2: Delete Local Restaurant

1. **Setup:**
   - Have a local-only restaurant (no `serverId`)

2. **Action:**
   - Delete the restaurant

3. **Expected Result:**
   - Restaurant disappears from list
   - Console shows: "Performing permanent delete (local-only restaurant)"
   - Restaurant **completely removed** from database

4. **Action:**
   - Sync from server

5. **Expected Result:**
   - Restaurant stays deleted (won't come back)

### Test Case 3: Server-Deleted Restaurant

1. **Setup:**
   - Restaurant exists on server
   - Restaurant synced locally

2. **Action:**
   - Delete restaurant from server (via Concierge app)
   - Sync from Collector

3. **Expected Result:**
   - Console shows: `Restaurant "X" (serverId: Y) not found on server - marking as local`
   - Restaurant becomes local (`serverId = null`, `source = 'local'`)
   - Restaurant **stays visible** in Collector (not deleted automatically)

4. **Action:**
   - Delete from Collector now

5. **Expected Result:**
   - Permanent delete (since it's now local)
   - Restaurant completely removed

---

## Edge Cases Handled

### Edge Case 1: Restaurant Deleted on Server AND Collector
- Server deletes restaurant
- Collector also deletes same restaurant (soft delete)
- Next sync tries to import
- **Fix:** Import skipped because `deletedLocally = true`

### Edge Case 2: Import Contains Deleted Restaurant
- User deletes restaurant A
- Server still has restaurant A
- Import includes restaurant A
- **Fix:** Import skipped with message in console

### Edge Case 3: Sync Inconsistency
- Restaurant has `serverId` but not on server
- System marks as local
- User deletes it (permanent delete)
- Next sync
- **Fix:** Restaurant stays deleted (not re-imported)

---

## Files Modified

### `scripts/dataStorage.js`

**Function:** `importConciergeFormat()`

**Lines modified:** 
- ~2090-2095: Added skip logic for deleted restaurants
- ~2118-2127: Modified update logic to preserve delete state

**Changes:**
1. Check for `deletedLocally === true` before importing
2. Skip import if restaurant was deleted by user
3. Only update `deletedLocally` from server if not already deleted locally

---

## Console Messages to Watch

### Successful Delete Prevention
```
Skipping import of "Restaurant Name" - restaurant was deleted by user
```
This means the fix is working - deleted restaurant won't be re-imported.

### Restaurant Marked as Local
```
Restaurant "Restaurant Name" (serverId: 123) not found on server - marking as local
```
This means restaurant was deleted from server, now local-only.

### Soft Delete
```
Performing soft delete + server delete (synced restaurant)
```
Normal behavior for deleting synced restaurant.

### Permanent Delete
```
Performing permanent delete (local-only restaurant)
```
Normal behavior for deleting local restaurant.

---

## Next Steps After Fix

1. **Reload the app** (hard refresh or Cmd+R)
2. **Test deleting a synced restaurant**
3. **Sync from server** (import remote data)
4. **Verify restaurant does NOT reappear**
5. **Check console** for "Skipping import" message

---

## Rollback Instructions

If this fix causes issues, revert these changes:

```javascript
// Remove this block (lines ~2090-2095):
if (existingRestaurant && existingRestaurant.deletedLocally === true) {
    console.log(`Skipping import of "${restaurantName}" - restaurant was deleted by user`);
    continue;
}

// Change this (lines ~2118-2127):
// FROM:
if (restaurantMeta.sync.deletedLocally !== undefined && !existingRestaurant.deletedLocally) {
    updateData.deletedLocally = restaurantMeta.sync.deletedLocally;
}

// TO:
if (restaurantMeta.sync.deletedLocally !== undefined) {
    updateData.deletedLocally = restaurantMeta.sync.deletedLocally;
}
```

---

## Additional Notes

### Why Soft Delete for Synced Restaurants?

Synced restaurants are soft-deleted (not permanently deleted) because:
1. They exist on the server
2. Permanent delete would cause them to re-appear on next sync
3. Soft delete keeps them in DB but hidden
4. Server DELETE call attempts to remove from server too

### Why This Fix is Safe

1. **No data loss:** Deleted restaurants stay in database (soft delete)
2. **Reversible:** Can add restore function if needed
3. **Sync-aware:** Won't interfere with normal sync operations
4. **Local priority:** User's local delete decision is respected

### Future Improvements

Consider adding:
1. **Restore deleted restaurants** - UI to view and restore soft-deleted items
2. **Sync delete to server** - When user deletes locally, propagate to server
3. **Delete conflict resolution** - Better handling when server and local disagree
4. **Permanent delete option** - Allow forcing permanent delete of synced restaurants

---

## Success Criteria

✅ Deleted synced restaurants do NOT reappear after sync  
✅ Local-only restaurants are permanently deleted  
✅ Console shows "Skipping import" for deleted restaurants  
✅ No data loss or corruption  
✅ Normal sync operations still work  

---

**Status:** ✅ FIXED  
**Tested:** Pending user verification  
**Version:** Database-Connection branch, October 18, 2025
