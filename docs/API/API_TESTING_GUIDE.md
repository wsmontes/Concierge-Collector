/**
 * API JSON Endpoint Testing Guide
 * 
 * Purpose: Guide for testing the new /api/curation/json endpoint implementation
 * Date: October 20, 2025
 * 
 * This document provides step-by-step testing procedures for the new JSON endpoint
 * implementation in Concierge Collector.
 */

# API JSON Endpoint Testing Guide

## Prerequisites

1. **Enable JSON Endpoint in Configuration**
   - Open `scripts/config.js`
   - Find `api.backend.sync.useJsonEndpoint`
   - Set to `true` to enable the new endpoint

```javascript
api: {
    backend: {
        sync: {
            useJsonEndpoint: true,  // Enable JSON endpoint
            validateBeforeUpload: true,
            preserveMetadata: true
        }
    }
}
```

2. **Verify Scripts are Loaded**
   - Check `index.html` includes:
     - `scripts/apiService.js`
     - `scripts/utils/restaurantValidator.js`
     - `scripts/syncManager.js`

## Test 1: Basic Upload Test

### Objective
Verify that restaurant data is successfully uploaded via the JSON endpoint.

### Steps

1. **Open browser console**
2. **Create a test restaurant**
3. **Upload the restaurant**
4. **Verify console logs**

### Console Commands

```javascript
// Test 1: Basic Upload
const testRestaurant = {
    id: 99999,
    name: "Test Restaurant JSON",
    description: "Testing JSON endpoint",
    transcription: "This is a test transcription",
    timestamp: new Date().toISOString(),
    curatorId: 1,
    curatorName: "Test Curator",
    needsSync: true,
    concepts: [
        { category: "Cuisine", value: "Italian" },
        { category: "Price Range", value: "$$" }
    ],
    location: {
        latitude: 41.9028,
        longitude: 12.4964,
        address: "Via Roma 1, Rome, Italy"
    },
    notes: {
        private: "Private note test",
        public: "Public note test"
    }
};

// Upload via JSON endpoint
const response = await window.apiService.uploadRestaurantJson(testRestaurant);
console.log('Upload Response:', response);

// Expected result: { success: true, data: { status: "success", processed: 1 } }
```

### Expected Console Output

```
ApiService: Uploading restaurant via JSON endpoint: {...}
ApiService: POST https://wsmontes.pythonanywhere.com/api/curation/json [...]
ApiService: ✅ /curation/json - Success {...}
Upload Response: { success: true, data: { status: "success", processed: 1, message: "..." } }
```

### Verification

✅ `response.success === true`  
✅ `response.data.status === "success"`  
✅ `response.data.processed === 1`  
✅ No errors in console

---

## Test 2: City Extraction Validation

### Objective
Verify that city extraction works from multiple sources.

### Test Cases

```javascript
// Test Case 1: Michelin data (highest priority)
const test1 = {
    id: 99991,
    name: "Restaurant with Michelin",
    curatorId: 1,
    curatorName: "Test",
    michelinData: {
        guide: {
            city: "Modena",
            country: "Italy"
        }
    }
};

const validation1 = window.restaurantValidator.validateForUpload(test1);
console.log('Test 1 - Michelin City:', validation1.city);
// Expected: "Modena"

// Test Case 2: Google Places (fallback)
const test2 = {
    id: 99992,
    name: "Restaurant with Google Places",
    curatorId: 1,
    curatorName: "Test",
    googlePlacesData: {
        location: {
            vicinity: "Piazza Navona, Rome"
        }
    }
};

const validation2 = window.restaurantValidator.validateForUpload(test2);
console.log('Test 2 - Google Places City:', validation2.city);
// Expected: "Piazza Navona" or "Rome" (depending on parsing)

// Test Case 3: Address parsing (last resort)
const test3 = {
    id: 99993,
    name: "Restaurant with Address",
    curatorId: 1,
    curatorName: "Test",
    location: {
        address: "Via Stella 22, Modena, Italy"
    }
};

const validation3 = window.restaurantValidator.validateForUpload(test3);
console.log('Test 3 - Address City:', validation3.city);
// Expected: "Modena"
```

### Verification

✅ Test 1 returns "Modena"  
✅ Test 2 returns a city name  
✅ Test 3 returns "Modena"  
✅ All validations have `valid: true`

---

## Test 3: Duplicate Prevention Test

### Objective
Verify that composite key (name + city + curator) prevents duplicates correctly.

### Steps

1. **Upload same restaurant twice with same curator**
   - Should UPDATE, not create duplicate

2. **Upload same restaurant with different curator**
   - Should CREATE new entry

3. **Upload same restaurant in different city**
   - Should CREATE new entry

### Console Commands

```javascript
// Test 3A: Same restaurant, same curator = UPDATE
const restaurant1 = {
    id: 99994,
    name: "Duplicate Test Restaurant",
    curatorId: 1,
    curatorName: "Curator A",
    michelinData: {
        guide: { city: "Rome", country: "Italy" }
    },
    concepts: [{ category: "Cuisine", value: "Italian" }]
};

// Upload first time
const upload1 = await window.apiService.uploadRestaurantJson(restaurant1);
console.log('First upload:', upload1);

// Upload second time (should update)
const upload2 = await window.apiService.uploadRestaurantJson(restaurant1);
console.log('Second upload (should update):', upload2);

// Test 3B: Same restaurant, different curator = NEW ENTRY
const restaurant2 = {
    ...restaurant1,
    id: 99995,
    curatorId: 2,
    curatorName: "Curator B"
};

const upload3 = await window.apiService.uploadRestaurantJson(restaurant2);
console.log('Different curator (should create new):', upload3);

// Test 3C: Same restaurant, different city = NEW ENTRY
const restaurant3 = {
    ...restaurant1,
    id: 99996,
    michelinData: {
        guide: { city: "Milan", country: "Italy" }
    }
};

const upload4 = await window.apiService.uploadRestaurantJson(restaurant3);
console.log('Different city (should create new):', upload4);
```

### Verification

✅ All uploads successful  
✅ No duplicate errors in console  
✅ Server correctly identifies update vs create scenarios

---

## Test 4: Metadata Preservation Test

### Objective
Verify that ALL metadata is preserved (location, photos, notes, Michelin, Google Places).

### Console Commands

```javascript
// Test 4: Complete metadata
const completeRestaurant = {
    id: 99997,
    name: "Complete Metadata Restaurant",
    description: "Full data test",
    transcription: "Audio transcription test",
    timestamp: new Date().toISOString(),
    curatorId: 1,
    curatorName: "Test Curator",
    concepts: [
        { category: "Cuisine", value: "French" },
        { category: "Price Range", value: "$$$$" },
        { category: "Atmosphere", value: "Fine Dining" }
    ],
    location: {
        latitude: 48.8566,
        longitude: 2.3522,
        address: "Champs-Élysées, Paris, France"
    },
    notes: {
        private: "Reservation required",
        public: "Highly recommended"
    },
    photos: [
        {
            url: "https://example.com/photo1.jpg",
            caption: "Main dining room",
            uploadedAt: new Date().toISOString()
        }
    ],
    michelinData: {
        michelinId: "test-123",
        distinction: {
            stars: 3,
            type: "Stars"
        },
        guide: {
            city: "Paris",
            country: "France",
            year: 2025
        }
    },
    googlePlacesData: {
        placeId: "ChIJtest123",
        rating: 4.8,
        totalRatings: 1250,
        location: {
            vicinity: "Champs-Élysées, Paris"
        }
    }
};

const uploadComplete = await window.apiService.uploadRestaurantJson(completeRestaurant);
console.log('Complete metadata upload:', uploadComplete);
```

### Verification

✅ Upload successful  
✅ No data truncation warnings  
✅ All metadata included in request payload (check Network tab)  
✅ Response confirms successful processing

---

## Test 5: Sync Manager Integration Test

### Objective
Verify that syncManager correctly uses the JSON endpoint when configured.

### Steps

1. **Create a restaurant via UI**
2. **Trigger sync**
3. **Verify correct endpoint is used**

### Console Commands

```javascript
// Test 5: Sync Manager Integration

// Create a test restaurant in database
const testId = await dataStorage.saveRestaurant(
    "Sync Test Restaurant",
    1, // curatorId
    [{ category: "Cuisine", value: "Japanese" }],
    { latitude: 35.6762, longitude: 139.6503, address: "Tokyo, Japan" },
    [],
    "Test transcription",
    "Test description",
    "local",
    null
);

console.log('Created test restaurant ID:', testId);

// Trigger sync
const syncResult = await window.conciergeSync.syncRestaurantById(testId, false);
console.log('Sync result:', syncResult);

// Check logs for endpoint used
// Should see: "📤 Uploading via JSON endpoint: ..." if useJsonEndpoint = true
// Should see: "📤 Uploading via batch endpoint: ..." if useJsonEndpoint = false
```

### Verification

✅ Sync completes successfully  
✅ Correct endpoint used based on config  
✅ Restaurant marked as synced in database  
✅ `needsSync` flag set to `false`

---

## Test 6: Validation Warning Test

### Objective
Verify that validation warnings are logged for incomplete data.

### Console Commands

```javascript
// Test 6: Validation Warnings
const incompleteRestaurant = {
    id: 99998,
    name: "Incomplete Restaurant",
    curatorId: 1,
    curatorName: "Test",
    // Missing: description, location, city data
    concepts: []
};

const validation = window.restaurantValidator.validateForUpload(incompleteRestaurant);
console.log('Validation result:', validation);
console.log('Issues:', validation.issues);

// Should show warnings like:
// - "Unable to determine city - may cause duplicate issues"
// - "Warning: No location data - consider adding GPS coordinates"
// - "Warning: No description or transcription provided"
```

### Verification

✅ Validation returns warnings (not errors)  
✅ `validation.valid === true` (warnings don't block upload)  
✅ All expected warnings present  
✅ City is `null` or `"Unknown"`

---

## Test 7: Backward Compatibility Test

### Objective
Verify that switching back to /batch endpoint still works.

### Steps

1. **Disable JSON endpoint in config**
2. **Trigger sync**
3. **Verify batch endpoint is used**

### Console Commands

```javascript
// Test 7: Switch to batch endpoint
// Temporarily override config
const originalSetting = window.AppConfig.api.backend.sync.useJsonEndpoint;
window.AppConfig.api.backend.sync.useJsonEndpoint = false;

// Create and sync a restaurant
const testId2 = await dataStorage.saveRestaurant(
    "Batch Test Restaurant",
    1,
    [{ category: "Cuisine", value: "Mexican" }],
    { latitude: 19.4326, longitude: -99.1332, address: "Mexico City, Mexico" },
    [],
    "Batch test",
    "Testing batch endpoint",
    "local",
    null
);

const syncResult2 = await window.conciergeSync.syncRestaurantById(testId2, false);
console.log('Batch sync result:', syncResult2);

// Restore original setting
window.AppConfig.api.backend.sync.useJsonEndpoint = originalSetting;
```

### Verification

✅ Sync uses batch endpoint  
✅ Console shows: "📤 Uploading via batch endpoint..."  
✅ Server ID returned and saved  
✅ Restaurant marked as synced

---

## Test 8: Error Handling Test

### Objective
Verify graceful error handling for invalid data or server errors.

### Console Commands

```javascript
// Test 8A: Missing required field
const invalidRestaurant = {
    id: 99999,
    name: "", // Empty name
    curatorId: 1
};

try {
    const result = await window.apiService.uploadRestaurantJson(invalidRestaurant);
    console.log('Invalid upload result:', result);
} catch (error) {
    console.log('Expected error:', error);
}

// Test 8B: Network timeout simulation
// (Can't easily simulate, but check logs during actual sync failures)
```

### Verification

✅ Errors are caught and logged  
✅ User-friendly error messages  
✅ No uncaught exceptions  
✅ Sync queue cleaned up properly

---

## Production Migration Checklist

Before enabling JSON endpoint in production:

- [ ] Run all 8 tests successfully
- [ ] Verify city extraction works for your dataset
- [ ] Backup local database
- [ ] Test with a small batch first (5-10 restaurants)
- [ ] Monitor console for errors during sync
- [ ] Verify data preservation on server (if GET endpoint available)
- [ ] Confirm duplicate prevention works as expected
- [ ] Test rollback to batch endpoint if needed

## Configuration Changes

### To Enable JSON Endpoint

Edit `scripts/config.js`:

```javascript
api: {
    backend: {
        sync: {
            useJsonEndpoint: true,        // Enable JSON endpoint
            validateBeforeUpload: true,   // Enable validation
            preserveMetadata: true        // Ensure metadata included
        }
    }
}
```

### To Disable (Rollback)

```javascript
api: {
    backend: {
        sync: {
            useJsonEndpoint: false,       // Use batch endpoint
            validateBeforeUpload: true,
            preserveMetadata: true
        }
    }
}
```

---

## Troubleshooting

### Issue: "restaurantValidator is not defined"

**Solution:** Verify `scripts/utils/restaurantValidator.js` is loaded in `index.html`

### Issue: "City extraction returns null"

**Solution:** 
- Check if restaurant has Michelin data, Google Places data, or location.address
- Add at least one of these data sources
- City extraction requires addressable location data

### Issue: "Upload successful but no data on server"

**Solution:**
- Check Network tab for actual request/response
- Verify server endpoint is `/curation/json` not `/restaurants/batch`
- Confirm server processed the request (status 200)

### Issue: "Duplicate restaurants created"

**Solution:**
- Verify city extraction is working correctly
- Check that same curator ID is being used
- Ensure restaurant name is exactly the same

---

**Document Version:** 1.0  
**Status:** Ready for Testing  
**Last Updated:** October 20, 2025
