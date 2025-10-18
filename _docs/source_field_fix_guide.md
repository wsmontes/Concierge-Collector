# Source Field Undefined Fix - Quick Reference

## Problem

Restaurants appearing with `source: undefined` in console logs instead of `'local'` or `'remote'`.

## Root Cause

1. **Console.log bug** in `updateRestaurant()` function referenced non-existent `source` variable
2. **Legacy data** - Restaurants created before source field was properly tracked
3. **Server errors** - 500 errors preventing proper sync, causing restaurants to be saved incompletely

## Solution Applied (Commit: 79d90a7)

### 1. Created Migration Script: `fixSourceField.js`

**Purpose**: Automatically repair all restaurants with missing/undefined source field

**How it works**:
- Scans all restaurants in database
- Identifies restaurants where `source` is undefined or missing
- Sets correct source based on sync status:
  - Has `serverId`? → `source = 'remote'` (came from server)
  - No `serverId`? → `source = 'local'` (local-only)

**How to run**:

```javascript
// Open browser console and run:
await fixSourceField()
```

**Expected output**:
```
=== Starting Source Field Fix ===
Total restaurants: 92
Restaurants needing fix: 2
✓ Fixed restaurant 93 (A. Wong): source='local'
✓ Fixed restaurant 94 (The Dysart Petersham): source='local'

=== Fix Complete ===
Fixed: 2
Errors: 0
Total: 2
✅ All restaurants now have valid source field
```

### 2. Fixed Console.log Bug in `dataStorage.js`

**Line 1594 - BEFORE**:
```javascript
console.log(`Restaurant updated successfully. ID: ${restaurantId}, Source: ${source}`);
//                                                                          ^^^^^^^ undefined!
```

**Line 1594 - AFTER**:
```javascript
console.log(`Restaurant updated successfully. ID: ${restaurantId}, Source: 'local' (needs sync)`);
//                                                                          ^^^^^^^^^ explicit value
```

This was a cosmetic bug (didn't affect database) but could confuse debugging.

### 3. Improved Server Error Handling in `syncService.js`

**Lines 25-48 - ADDED**:
```javascript
if (!response.ok) {
    // Get error text if available
    let errorDetails = response.statusText;
    try {
        const errorText = await response.text();
        if (errorText) {
            errorDetails += ` - ${errorText}`;
        }
    } catch (e) {
        // Ignore if we can't read error text
    }
    
    // Log detailed error
    console.error(`SyncService: Server error ${response.status}: ${errorDetails}`);
    
    // Show user-friendly error
    const userMessage = response.status >= 500 
        ? 'Server is currently unavailable. Please try again later.'
        : `Failed to import: ${response.statusText}`;
    
    throw new Error(userMessage);
}
```

**Benefits**:
- User sees friendly message instead of technical error
- Console still gets detailed error info for debugging
- Distinguishes between client errors (4xx) and server errors (5xx)

## Verification

### Check Current State

```javascript
// Get all restaurants and check source field
const restaurants = await dataStorage.db.restaurants.toArray();
const withoutSource = restaurants.filter(r => !r.source || r.source === undefined);
console.log(`Restaurants without source: ${withoutSource.length}`);
```

### Expected Result (after fix)

```javascript
Restaurants without source: 0
```

### Check Individual Restaurant

```javascript
// Get a specific restaurant
const restaurant = await dataStorage.db.restaurants.get(93);
console.log('Source:', restaurant.source);  // Should be 'local' or 'remote', NOT undefined
console.log('ServerId:', restaurant.serverId); // Should match source type
```

## When to Run the Fix

**Run the migration script if you see**:
- `source: undefined` in console logs
- Restaurants showing without sync status
- After importing old data files
- After server errors interrupted import

**Don't need to run if**:
- All console logs show `source: 'local'` or `source: 'remote'`
- Fresh database with no legacy data
- Fresh import from working server

## Prevention

**Going forward, this issue is prevented by**:

1. ✅ All `saveRestaurant()` calls use default parameter `source = 'local'`
2. ✅ Import explicitly passes `source = 'remote'`
3. ✅ Update explicitly sets `source = 'local'` (needs sync)
4. ✅ Better server error handling prevents incomplete imports
5. ✅ Migration script available to fix legacy data

## Related Documentation

- `_docs/sync_implementation_status.md` - Complete sync implementation details
- `_docs/fixes_quick_reference.md` - All fixes and workarounds
- `COLLECTOR_SYNC_INTEGRATION_GUIDE.md` - Server API integration guide

## Testing the Fix

1. **Before running fix**:
   ```javascript
   const broken = await dataStorage.db.restaurants
       .filter(r => !r.source || r.source === undefined)
       .toArray();
   console.log('Broken restaurants:', broken.length);
   ```

2. **Run the fix**:
   ```javascript
   const result = await fixSourceField();
   console.log('Result:', result);
   ```

3. **Verify fix applied**:
   ```javascript
   const stillBroken = await dataStorage.db.restaurants
       .filter(r => !r.source || r.source === undefined)
       .toArray();
   console.log('Still broken:', stillBroken.length); // Should be 0
   ```

4. **Check specific restaurants**:
   ```javascript
   const fixed = await dataStorage.db.restaurants.toArray();
   fixed.forEach(r => {
       console.log(`${r.name}: source='${r.source}', serverId=${r.serverId}`);
   });
   ```

## Troubleshooting

### Fix script reports errors

```javascript
// Check error details
const result = await fixSourceField();
if (!result.success) {
    console.error('Fix failed:', result);
}
```

### Some restaurants still broken

```javascript
// Find restaurants that couldn't be fixed
const stillBroken = await dataStorage.db.restaurants
    .filter(r => !r.source || r.source === undefined)
    .toArray();

// Manual fix
for (const restaurant of stillBroken) {
    const correctSource = restaurant.serverId ? 'remote' : 'local';
    await dataStorage.db.restaurants.update(restaurant.id, {
        source: correctSource
    });
    console.log(`Manually fixed: ${restaurant.name} → source='${correctSource}'`);
}
```

### Need to verify sync status after fix

```javascript
// Check all restaurants have correct source based on serverId
const allRestaurants = await dataStorage.db.restaurants.toArray();
const mismatched = allRestaurants.filter(r => {
    // Remote should have serverId, local should not (usually)
    if (r.source === 'remote' && !r.serverId) return true;
    // Any without source
    if (!r.source || r.source === undefined) return true;
    return false;
});

console.log('Mismatched restaurants:', mismatched);
```

## Summary

- ✅ Migration script created and ready to use
- ✅ Console.log bug fixed
- ✅ Server error handling improved
- ✅ Prevention measures in place
- ✅ Script added to index.html and ready to use

**Next steps for user**:
1. Refresh the page to load new fixSourceField script
2. Open browser console
3. Run: `await fixSourceField()`
4. Verify all restaurants now have valid source field
5. Wait for server to recover from 500 errors
6. Re-import restaurants from server
