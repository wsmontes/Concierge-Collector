# Duplicate Restaurants Issue - Root Cause and Fix

**Date:** October 17, 2025  
**Issue:** Database accumulating duplicate restaurants on every sync operation

## Root Cause Analysis

### The Problem
The application was creating duplicate restaurant entries every time a sync operation was performed. Over 7 sync operations created 610 total restaurants when there should only be ~90 unique ones.

### Technical Root Cause

**Function Signature Mismatch:**

1. **syncService.js** (line 199-208) was calling `dataStorage.saveRestaurant()` with **9 parameters**:
   ```javascript
   await dataStorage.saveRestaurant(
       remoteRestaurant.name,        // 1. name
       curatorId,                     // 2. curatorId
       concepts,                      // 3. concepts
       location,                      // 4. location
       [],                            // 5. photos
       remoteRestaurant.transcription || '',  // 6. transcription
       remoteRestaurant.description || '',    // 7. description
       'remote',                      // 8. source ← IGNORED!
       remoteRestaurant.id            // 9. serverId ← IGNORED!
   );
   ```

2. **dataStorage.js** (line 1026) only accepted **7 parameters**:
   ```javascript
   async saveRestaurant(name, curatorId, concepts, location, photos, transcription, description)
   // Parameters 8 and 9 were being silently ignored!
   ```

### Why This Caused Duplicates

**The Deduplication Logic Depends on serverId:**

```javascript
// syncService.js - Deduplication check
const existingByServerId = new Map();

// Get all restaurants with serverId set
const existingServerRestaurants = await dataStorage.db.restaurants
    .where('serverId')
    .above(0)
    .toArray();
```

**The Chain of Failure:**

1. ✅ Sync fetches 88 restaurants from server
2. ✅ Checks for existing restaurants by `serverId`
3. ❌ **NO restaurants found** (because `serverId` was never saved!)
4. ✅ Calls `saveRestaurant()` with `serverId` parameter
5. ❌ **`serverId` parameter is ignored** (function signature mismatch)
6. ✅ Restaurant saved WITHOUT `serverId` and WITHOUT `source`
7. 🔄 Next sync: Repeat from step 1

**Result:** Every sync creates complete duplicates because the system can't identify previously imported restaurants.

## The Fix

### Changes Made to dataStorage.js

**1. Updated `saveRestaurant()` function signature (line 1026):**
```javascript
// BEFORE:
async saveRestaurant(name, curatorId, concepts, location, photos, transcription, description)

// AFTER:
async saveRestaurant(name, curatorId, concepts, location, photos, transcription, description, source = 'local', serverId = null)
```

**2. Updated `saveRestaurantWithTransaction()` function signature (line 1065):**
```javascript
// BEFORE:
async saveRestaurantWithTransaction(name, curatorId, conceptsOrIds, location, photos, transcription, description)

// AFTER:
async saveRestaurantWithTransaction(name, curatorId, conceptsOrIds, location, photos, transcription, description, source = 'local', serverId = null)
```

**3. Updated restaurant object creation to include source and serverId (line 1076):**
```javascript
// BEFORE:
const restaurantId = await this.db.restaurants.put({
    name,
    curatorId,
    timestamp: new Date(),
    transcription: transcription || null,
    description: description || null
});

// AFTER:
const restaurantId = await this.db.restaurants.put({
    name,
    curatorId,
    timestamp: new Date(),
    transcription: transcription || null,
    description: description || null,
    source: source,          // ← NOW SAVED!
    serverId: serverId       // ← NOW SAVED!
});
```

**4. Added logging to track source and serverId:**
```javascript
console.log(`Source: ${source}, Server ID: ${serverId}`);
console.log(`Restaurant saved with ID: ${restaurantId}, source: ${source}, serverId: ${serverId}`);
```

### Backward Compatibility

The fix maintains backward compatibility by using **default parameter values**:
- `source = 'local'` - Local restaurants (created in the app) will be marked as 'local'
- `serverId = null` - Local restaurants won't have a server ID

**Existing code that calls `saveRestaurant()` with 7 parameters will continue to work:**

```javascript
// From conceptModule.js - Still works!
await dataStorage.saveRestaurant(
    name,
    curatorId,
    concepts,
    location,
    photos,
    transcription,
    description
);
// Will use defaults: source='local', serverId=null
```

## Expected Behavior After Fix

### First Sync After Fix
- ✅ Fetches 88 restaurants from server
- ✅ Checks for existing restaurants by `serverId`
- ❌ Finds none (old restaurants don't have `serverId`)
- ✅ Creates 88 new restaurants WITH `serverId` and `source='remote'`
- ⚠️ Database will temporarily have: 610 (old) + 88 (new) = 698 restaurants

### Second Sync After Fix
- ✅ Fetches 88 restaurants from server
- ✅ Checks for existing restaurants by `serverId`
- ✅ **Finds all 88 restaurants** (from previous sync)
- ✅ Updates existing restaurants instead of creating duplicates
- ✅ **No new duplicates created!**

### Database Cleanup Required

After the fix, you'll need to clean up the 610 duplicate restaurants from previous syncs:

```javascript
// In browser console:
// Delete all restaurants without serverId (old duplicates)
await dataStorage.db.restaurants.where('serverId').equals(null).delete();

// Or delete all and re-sync:
await dataStorage.db.restaurants.clear();
// Then click "Sync with Server"
```

## Verification

### Console Logs to Watch For

**Before Fix:**
```
Saving restaurant: Ritz with curator ID: 2
Concepts count: 14, Has location: false, Photos count: 0
Restaurant saved with ID: 612
```

**After Fix:**
```
Saving restaurant: Ritz with curator ID: 2
Concepts count: 14, Has location: false, Photos count: 0
Source: remote, Server ID: 1                           ← NEW!
Restaurant saved with ID: 698, source: remote, serverId: 1  ← NEW!
```

### Database Inspection

**Check if serverId is being saved:**
```javascript
// In browser console:
const restaurants = await dataStorage.db.restaurants.toArray();
const withServerId = restaurants.filter(r => r.serverId !== null && r.serverId !== undefined);
console.log(`Restaurants with serverId: ${withServerId.length}/${restaurants.length}`);
console.log('Sample:', withServerId.slice(0, 3));
```

**Expected after first sync with fix:**
```
Restaurants with serverId: 88/698
Sample: [
  { id: 611, name: "Teste", serverId: 0, source: "remote", ... },
  { id: 612, name: "Ritz", serverId: 1, source: "remote", ... },
  { id: 613, name: "Ristorante Trattoria Evvai", serverId: 2, source: "remote", ... }
]
```

## Impact Analysis

### Files Modified
1. `/scripts/dataStorage.js` - Function signatures and restaurant saving logic

### Files NOT Modified (No Changes Needed)
1. `/scripts/syncService.js` - Already passing correct parameters
2. `/scripts/modules/conceptModule.js` - Using 7-parameter call (backward compatible)
3. `/scripts/modules/placesModule.js` - Using 7-parameter call (backward compatible)

### Database Schema
No schema changes required. The `serverId` and `source` fields were already defined in the schema:
```javascript
restaurants: '++id, name, curatorId, timestamp, transcription, description, origin, source, serverId'
```

The issue was that the code wasn't actually **saving** these fields even though they were defined in the schema.

## Lessons Learned

1. **Function signatures must match between caller and callee** - JavaScript silently ignores extra parameters
2. **Database schema definitions don't enforce data** - Having a field in the schema doesn't mean it's being populated
3. **Deduplication logic requires complete data** - Missing `serverId` made the entire deduplication system ineffective
4. **Always log critical tracking fields** - Added logging for `source` and `serverId` to detect issues early
5. **Parameter mismatches are silent errors** - Consider using TypeScript or JSDoc to catch these at development time

## Future Recommendations

1. **Add JSDoc type annotations** to function signatures
2. **Add validation** to ensure critical fields like `serverId` are saved correctly
3. **Add database integrity checks** on startup to detect missing critical fields
4. **Consider TypeScript** to catch parameter mismatches at compile time
5. **Add unit tests** for sync operations to prevent regression
