# Delete Sync Bug Fix - October 18, 2025

## Problem
Deleted restaurants were reappearing after syncing from the server.

## Root Cause
In `scripts/syncService.js`, the `importRestaurants()` function was not checking for the `deletedLocally` flag before updating existing restaurants during sync.

### Specific Issues:

1. **Line ~128-136**: When finding an existing restaurant by `serverId`, the code only checked for `needsSync` or `source === 'local'`, but never checked if `deletedLocally === true`.

2. **Line ~183-187**: When matching restaurants by name, the code didn't check if the matching restaurant was deleted by the user before linking it with a server ID.

## The Fix

### Change 1: Added `deletedLocally` check for serverId matches (Line ~133)
```javascript
// If exists with serverId, check if it needs sync (has local changes)
if (existingRestaurant) {
    // CRITICAL: Skip if restaurant was deleted by user
    if (existingRestaurant.deletedLocally === true) {
        results.skipped++;
        console.log(`SyncService: Skipping ${remoteRestaurant.name} - restaurant was deleted by user`);
        continue;
    }
    
    // Check needsSync flag (or source='local' which means the same)
    if (existingRestaurant.needsSync || existingRestaurant.source === 'local') {
        // Has pending local changes - skip update to preserve local data
        results.skipped++;
        console.log(`SyncService: Skipping ${remoteRestaurant.name} - has pending local changes...`);
    } else {
        // Update from server
        // ...
    }
}
```

### Change 2: Added `deletedLocally` check for name matches (Line ~185)
```javascript
// Check for restaurants with same name (normalized)
const matchingRestaurants = existingByName.get(normalizedName);
if (matchingRestaurants && matchingRestaurants.length > 0) {
    // CRITICAL: Check if any matching restaurant was deleted by user
    const deletedMatch = matchingRestaurants.find(r => r.deletedLocally === true);
    if (deletedMatch) {
        results.skipped++;
        console.log(`SyncService: Skipping ${remoteRestaurant.name} - matching restaurant was deleted by user`);
        continue;
    }
    
    // Continue with normal matching logic...
}
```

## Expected Behavior After Fix

### When you delete a synced restaurant:
1. Restaurant is soft-deleted (`deletedLocally = true`)
2. Server delete is attempted
3. Restaurant disappears from UI

### When you sync from server:
1. Sync finds the deleted restaurant (by serverId or name)
2. Checks `deletedLocally === true`
3. **Skips the import** with console message: `"Skipping [name] - restaurant was deleted by user"`
4. Restaurant stays deleted (does NOT reappear)

## Testing

### Quick Test:
1. Delete a synced restaurant (one with a serverId)
2. Verify it disappears from the list
3. Click "Import from Remote" to sync
4. Check console for: `"Skipping [restaurant name] - restaurant was deleted by user"`
5. Verify restaurant does NOT reappear in the list

### Database Verification:
```javascript
// Check if restaurant is still marked as deleted
const deleted = await dataStorage.db.restaurants
    .filter(r => r.deletedLocally === true)
    .toArray();
console.table(deleted.map(r => ({
    id: r.id, 
    name: r.name, 
    serverId: r.serverId, 
    deletedAt: r.deletedAt
})));
```

## Files Modified
- `/Users/wagnermontes/Documents/GitHub/Concierge-Collector/scripts/syncService.js`
  - Line ~133: Added deletedLocally check after finding existing restaurant by serverId
  - Line ~185: Added deletedLocally check when matching restaurants by name

## Status
✅ **FIXED** - Deleted restaurants will no longer reappear after syncing from server
