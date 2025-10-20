# Migration Guide: Batch Endpoint to JSON Endpoint

**Purpose:** Step-by-step guide for migrating from `/api/restaurants/batch` to `/api/curation/json`  
**Date:** October 20, 2025  
**Estimated Time:** 2-4 hours  
**Difficulty:** Medium

---

## Why Migrate?

### Current State (Using `/api/restaurants/batch`)

✅ **Working:**
- Basic restaurant sync (name, description, concepts)
- Server ID mapping
- Curator tracking

❌ **Data Loss:**
- Location data (latitude, longitude, address)
- Photos
- Private and public notes
- Michelin metadata
- Google Places ratings

### Future State (Using `/api/curation/json`)

✅ **Benefits:**
- Complete data preservation
- Intelligent duplicate prevention (name + city + curator)
- Future-proof JSONB storage
- No schema changes needed for new fields
- Sophisticated city extraction

---

## Prerequisites

1. **Backup your data**
   ```javascript
   // Export all restaurants before migration
   const allRestaurants = await dataStorage.db.restaurants.toArray();
   const backup = JSON.stringify(allRestaurants, null, 2);
   console.log('Backup:', backup);
   // Copy this to a text file
   ```

2. **Verify current sync status**
   ```javascript
   const pendingSync = await dataStorage.db.restaurants
       .where('needsSync').equals(true)
       .toArray();
   console.log(`${pendingSync.length} restaurants pending sync`);
   ```

3. **Test environment ready**
   - Browser console accessible
   - Network tab for monitoring requests
   - Fresh browser session (clear cache if needed)

---

## Phase 1: Assessment (15 minutes)

### Step 1: Check Data Availability

Run this in browser console:

```javascript
// Assessment script
async function assessDataForMigration() {
    const restaurants = await dataStorage.db.restaurants.toArray();
    
    const stats = {
        total: restaurants.length,
        withLocation: 0,
        withPhotos: 0,
        withNotes: 0,
        withMichelin: 0,
        withGooglePlaces: 0,
        withoutCity: 0
    };
    
    for (const r of restaurants) {
        // Check location
        const locations = await dataStorage.db.restaurantLocations
            .where('restaurantId').equals(r.id).toArray();
        if (locations.length > 0) stats.withLocation++;
        
        // Check photos
        const photos = await dataStorage.db.restaurantPhotos
            .where('restaurantId').equals(r.id).toArray();
        if (photos.length > 0) stats.withPhotos++;
        
        // Check notes
        if (r.notes) stats.withNotes++;
        
        // Check Michelin
        if (r.michelinData) stats.withMichelin++;
        
        // Check Google Places
        if (r.googlePlacesData) stats.withGooglePlaces++;
        
        // Check city extraction
        const validation = window.restaurantValidator.validateForUpload(r);
        if (!validation.city) stats.withoutCity++;
    }
    
    console.log('Migration Assessment:', stats);
    console.log('\nRecommendation:', 
        stats.withLocation + stats.withPhotos + stats.withNotes + stats.withMichelin + stats.withGooglePlaces > 0
            ? '✅ MIGRATE NOW - You have data that will be lost with /batch'
            : '⚠️ Migration optional - Consider for future-proofing'
    );
    
    if (stats.withoutCity > 0) {
        console.warn(`⚠️ ${stats.withoutCity} restaurants without city data - may cause duplicate issues`);
    }
    
    return stats;
}

// Run assessment
assessDataForMigration();
```

### Step 2: Document Your Results

Based on assessment results, determine urgency:

- **HIGH PRIORITY:** Any stats > 0 means you're losing data
- **MEDIUM PRIORITY:** No current data loss, but future-proofing needed
- **LOW PRIORITY:** Only basic data, no plans for enhanced features

---

## Phase 2: Testing (30 minutes)

### Step 1: Enable JSON Endpoint for Testing

**Option A: Temporary Override (Recommended for testing)**

```javascript
// In browser console - temporary change
window.AppConfig.api.backend.sync.useJsonEndpoint = true;
console.log('✅ JSON endpoint enabled for this session');
```

**Option B: Permanent Change**

Edit `scripts/config.js`:

```javascript
api: {
    backend: {
        sync: {
            useJsonEndpoint: true,  // Change from false to true
            validateBeforeUpload: true,
            preserveMetadata: true
        }
    }
}
```

### Step 2: Test with Sample Restaurant

```javascript
// Create a test restaurant with complete data
const testRestaurant = {
    id: Date.now(), // Unique ID
    name: `Migration Test ${Date.now()}`,
    description: "Testing JSON endpoint migration",
    transcription: "This is a migration test",
    timestamp: new Date().toISOString(),
    curatorId: 1,
    curatorName: "Test Curator",
    needsSync: true,
    concepts: [
        { category: "Cuisine", value: "Test" },
        { category: "Price Range", value: "$$" }
    ],
    location: {
        latitude: 41.9028,
        longitude: 12.4964,
        address: "Test Address, Rome, Italy"
    },
    notes: {
        private: "Migration test private note",
        public: "Migration test public note"
    },
    michelinData: {
        guide: { city: "Rome", country: "Italy" }
    }
};

// Test upload
const testResult = await window.apiService.uploadRestaurantJson(testRestaurant);
console.log('Test Result:', testResult);

// Verify success
if (testResult.success) {
    console.log('✅ Test successful - ready for migration');
} else {
    console.error('❌ Test failed - do not proceed', testResult.error);
}
```

### Step 3: Verify Console Output

Look for these log messages:

✅ `"ApiService: Uploading restaurant via JSON endpoint:"`  
✅ `"ApiService: POST .../api/curation/json"`  
✅ `"ApiService: ✅ /curation/json - Success"`  
❌ Should NOT see: `"Uploading via batch endpoint"`

### Step 4: Check Network Tab

1. Open DevTools → Network tab
2. Filter by "curation"
3. Click on the request
4. Verify:
   - ✅ URL ends with `/curation/json`
   - ✅ Request payload includes all metadata
   - ✅ Response status: 200 OK
   - ✅ Response data shows `processed: 1`

---

## Phase 3: Gradual Migration (1-2 hours)

### Step 1: Migrate Small Batch

```javascript
// Migrate first 10 restaurants
async function migrateSmallBatch() {
    const restaurants = await dataStorage.db.restaurants
        .where('needsSync').equals(true)
        .limit(10)
        .toArray();
    
    console.log(`Starting migration of ${restaurants.length} restaurants...`);
    
    const results = {
        success: 0,
        failed: 0,
        errors: []
    };
    
    for (const restaurant of restaurants) {
        try {
            console.log(`Syncing: ${restaurant.name}`);
            const syncResult = await window.conciergeSync.syncRestaurantById(restaurant.id, false);
            
            if (syncResult) {
                results.success++;
                console.log(`✅ ${restaurant.name}`);
            } else {
                results.failed++;
                console.log(`❌ ${restaurant.name} - sync returned false`);
            }
            
            // Wait 1 second between requests to avoid overwhelming server
            await new Promise(resolve => setTimeout(resolve, 1000));
            
        } catch (error) {
            results.failed++;
            results.errors.push({ name: restaurant.name, error: error.message });
            console.error(`❌ ${restaurant.name}:`, error);
        }
    }
    
    console.log('\nMigration Results:', results);
    return results;
}

// Run small batch migration
migrateSmallBatch();
```

### Step 2: Monitor Results

After running small batch:

1. **Check console for errors**
   - Any red error messages?
   - All restaurants show ✅?

2. **Verify database updates**
   ```javascript
   const synced = await dataStorage.db.restaurants
       .where('needsSync').equals(false)
       .and(r => r.source === 'remote')
       .count();
   console.log(`${synced} restaurants now synced`);
   ```

3. **Check for duplicates**
   ```javascript
   const allNames = await dataStorage.db.restaurants.toArray();
   const names = allNames.map(r => r.name);
   const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
   if (duplicates.length > 0) {
       console.warn('⚠️ Duplicates found:', duplicates);
   } else {
       console.log('✅ No duplicates');
   }
   ```

### Step 3: Fix Any Issues

Common issues and solutions:

**Issue: City extraction failed**
```javascript
// Add Michelin or Google Places data, or improve location.address
await dataStorage.db.restaurants.update(restaurantId, {
    location: {
        address: "Complete Address, City Name, Country"
    }
});
```

**Issue: Sync failed with network error**
```javascript
// Retry individual restaurant
await window.conciergeSync.syncRestaurantById(restaurantId, false);
```

---

## Phase 4: Full Migration (30-60 minutes)

### Step 1: Migrate All Remaining Restaurants

```javascript
// Full migration script
async function migrateAllRestaurants() {
    const pending = await dataStorage.db.restaurants
        .where('needsSync').equals(true)
        .toArray();
    
    console.log(`🚀 Starting full migration of ${pending.length} restaurants...`);
    
    const results = {
        total: pending.length,
        success: 0,
        failed: 0,
        skipped: 0,
        errors: []
    };
    
    // Process in batches of 10 to avoid overwhelming server
    const batchSize = 10;
    for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        console.log(`\nProcessing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(pending.length/batchSize)}`);
        
        for (const restaurant of batch) {
            try {
                // Validate before upload
                const validation = window.restaurantValidator.validateForUpload(restaurant);
                if (!validation.valid) {
                    console.warn(`⚠️ ${restaurant.name}: ${validation.issues.join(', ')}`);
                }
                
                const syncResult = await window.conciergeSync.syncRestaurantById(restaurant.id, true);
                
                if (syncResult) {
                    results.success++;
                } else {
                    results.skipped++;
                }
                
            } catch (error) {
                results.failed++;
                results.errors.push({
                    id: restaurant.id,
                    name: restaurant.name,
                    error: error.message
                });
                console.error(`❌ ${restaurant.name}:`, error.message);
            }
        }
        
        // Wait between batches
        if (i + batchSize < pending.length) {
            console.log('Waiting 5 seconds before next batch...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    console.log('\n=== MIGRATION COMPLETE ===');
    console.log(results);
    
    if (results.errors.length > 0) {
        console.log('\n❌ Failed Restaurants:');
        console.table(results.errors);
    }
    
    return results;
}

// Run full migration
const migrationResults = await migrateAllRestaurants();
```

### Step 2: Verify Migration Success

```javascript
// Verification script
async function verifyMigration() {
    const all = await dataStorage.db.restaurants.toArray();
    const stats = {
        total: all.length,
        synced: all.filter(r => !r.needsSync && r.source === 'remote').length,
        pending: all.filter(r => r.needsSync).length,
        local: all.filter(r => r.source === 'local').length
    };
    
    console.log('Migration Verification:', stats);
    
    const successRate = (stats.synced / stats.total * 100).toFixed(1);
    console.log(`Success Rate: ${successRate}%`);
    
    if (stats.pending === 0) {
        console.log('✅ ALL RESTAURANTS MIGRATED');
    } else {
        console.warn(`⚠️ ${stats.pending} restaurants still pending sync`);
    }
    
    return stats;
}

verifyMigration();
```

---

## Phase 5: Permanent Configuration (5 minutes)

### Step 1: Make JSON Endpoint Default

Edit `scripts/config.js`:

```javascript
api: {
    backend: {
        sync: {
            useJsonEndpoint: true,        // ✅ Permanently enabled
            validateBeforeUpload: true,
            preserveMetadata: true
        }
    }
}
```

### Step 2: Clear Browser Cache

1. Open DevTools → Application → Clear storage
2. Reload the page
3. Verify configuration loaded correctly:

```javascript
console.log('JSON endpoint enabled:', 
    window.AppConfig.api.backend.sync.useJsonEndpoint
);
// Should output: true
```

---

## Rollback Procedure

If you need to rollback to batch endpoint:

### Immediate Rollback (Console)

```javascript
// Disable JSON endpoint immediately
window.AppConfig.api.backend.sync.useJsonEndpoint = false;
console.log('✅ Rolled back to batch endpoint for this session');
```

### Permanent Rollback (Config File)

Edit `scripts/config.js`:

```javascript
api: {
    backend: {
        sync: {
            useJsonEndpoint: false,  // Back to batch endpoint
            validateBeforeUpload: true,
            preserveMetadata: true
        }
    }
}
```

**Note:** Restaurants already synced via JSON endpoint will remain on server. They won't be duplicated when re-synced via batch endpoint (server handles this).

---

## Post-Migration Checklist

After successful migration:

- [ ] All restaurants synced (verified via console)
- [ ] No duplicate restaurants created
- [ ] Location data preserved for restaurants that have it
- [ ] Photos preserved (if any)
- [ ] Notes preserved (if any)
- [ ] Michelin data preserved (if any)
- [ ] Google Places data preserved (if any)
- [ ] Config permanently updated to use JSON endpoint
- [ ] Documentation updated with migration date
- [ ] Team notified of successful migration

---

## Troubleshooting

### Problem: High failure rate (>10%)

**Solution:**
1. Check network connectivity
2. Verify server is responding (`GET /api/health`)
3. Check for validation errors in console
4. Retry failed restaurants individually

### Problem: Duplicates created on server

**Solution:**
1. City extraction may have failed - check validation logs
2. Manually add city data to restaurants:
   ```javascript
   await dataStorage.db.restaurants.update(id, {
       michelinData: { guide: { city: "CityName", country: "Country" } }
   });
   ```
3. Re-sync after adding city data

### Problem: "restaurantValidator is not defined"

**Solution:**
Reload page to ensure all scripts are loaded, or manually load:
```javascript
// Fallback if validator not loaded
await import('./scripts/utils/restaurantValidator.js');
```

---

## Support

If you encounter issues during migration:

1. **Check console errors** - Most issues have helpful error messages
2. **Review Network tab** - Verify requests are reaching server
3. **Test individual restaurant** - Isolate problematic data
4. **Refer to testing guide** - `docs/API/API_TESTING_GUIDE.md`

---

**Document Version:** 1.0  
**Status:** Ready for Production  
**Last Updated:** October 20, 2025
