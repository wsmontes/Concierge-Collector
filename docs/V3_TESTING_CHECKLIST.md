# V3 API Testing Checklist

**Date**: November 18, 2025  
**Purpose**: End-to-end testing of V3 API integration with frontend  
**Backend**: http://localhost:8000/api/v3  
**Frontend**: http://localhost:5500  
**Database**: MongoDB with 919 entities (Michelin import)

---

## Pre-Test Status

✅ **API Server Running**: PID 96790, health check passing  
✅ **Frontend Running**: Live Server on port 5500  
✅ **Database Connected**: MongoDB with 919 entities  
✅ **API Key Configured**: `7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc`  
✅ **Code Complete**: All V3 modules implemented  
✅ **Backend CRUD Tested**: All operations verified via curl

---

## Test Suite

### 1. API Connectivity & Authentication ✅ COMPLETE

**Status**: Backend verified, 919 entities loaded

**Backend Tests** (via curl):
- ✅ `/api/v3/info` - Returns API metadata
- ✅ `/api/v3/health` - Database connected
- ✅ `/api/v3/entities?limit=5` - List entities (no auth required)

**Frontend Tests**:
1. Open browser to http://localhost:5500
2. Open DevTools Console (Cmd+Option+J / Ctrl+Shift+J)
3. Verify API key modal appears if no key stored
4. Enter API key and click Save
5. Verify key stored in localStorage: `localStorage.getItem('concierge-api-key')`
6. Check console for: `✅ ApiService instance created`

**Expected Console Output**:
```javascript
🚀 Initializing V3 API Service...
✅ Found V3 API key
✅ API connection verified
✅ V3 API Service initialized
```

---

### 2. Entity CRUD Operations ✅ BACKEND COMPLETE → 🔄 FRONTEND IN PROGRESS

**Backend Test Results** (via curl):
- ✅ **CREATE**: Successfully created entity with version=1
- ✅ **READ**: Retrieved entity by ID
- ✅ **UPDATE**: Version incremented from 1 to 2
- ✅ **CONFLICT**: Correctly returned 409 with old version
- ✅ **DELETE**: Returned 204, entity removed
- ✅ **VERIFY DELETE**: Returned 404 for deleted entity

**API Key for Testing**: `7AxYmOWqcVoSUylQQ3do5_nHAf9Fxh4i7-EhD-2wxoc`

#### 2.1 Read Entities (GET) - Frontend Test

**Test**: List existing entities
1. In DevTools Console, run:
   ```javascript
   const entities = await ApiService.listEntities({ limit: 5 });
   console.log('Entities:', entities);
   ```
2. Verify response contains `items`, `total`, `limit`, `offset`
3. Check each entity has: `entity_id`, `type`, `name`, `version`, `_id`

**Expected Response**:
```javascript
{
  items: [
    {
      _id: "691cbbf34f9e2794c9fa459d",
      entity_id: "rest_lasarte_barcelona",
      type: "restaurant",
      name: "Lasarte",
      version: 1,
      status: "active",
      data: { ... },
      createdAt: "2025-11-18T18:33:23.188000",
      updatedAt: "2025-11-18T18:33:23.188000"
    },
    // ... more entities
  ],
  total: 919,
  limit: 5,
  offset: 0
}
```

#### 2.2 Create Entity (POST) - NEEDS API KEY

**Test**: Create a new entity
1. In DevTools Console, run:
   ```javascript
   const newEntity = await ApiService.createEntity({
     entity_id: "rest_test_" + Date.now(),
     type: "restaurant",
     name: "Test Restaurant",
     status: "active",
     data: {
       location: {
         city: "Barcelona",
         address: "Test Street 123"
       }
     }
   });
   console.log('Created:', newEntity);
   ```
2. Verify response includes `_id`, `entity_id`, `version: 1`
3. Verify `createdBy` matches your API key user

**Expected Response**:
```javascript
{
  _id: "...",
  entity_id: "rest_test_1731894000000",
  type: "restaurant",
  name: "Test Restaurant",
  status: "active",
  version: 1,
  createdAt: "2025-11-18T...",
  createdBy: "api_key_user_id",
  data: { ... }
}
```

#### 2.3 Update Entity (PATCH) - OPTIMISTIC LOCKING

**Test**: Update existing entity with If-Match header
1. Get an entity first:
   ```javascript
   const entity = await ApiService.getEntity(newEntity._id);
   console.log('Current version:', entity.version);
   ```
2. Update it:
   ```javascript
   const updated = await ApiService.updateEntity(entity._id, {
     name: "Updated Test Restaurant"
   }, entity.version);
   console.log('Updated version:', updated.version);
   ```
3. Verify `version` incremented: `updated.version === entity.version + 1`

**Test Conflict Detection**:
4. Try to update with old version (should fail with 409):
   ```javascript
   try {
     await ApiService.updateEntity(entity._id, {
       name: "Should Fail"
     }, 1);  // Old version
   } catch (error) {
     console.log('Expected 409 conflict:', error);
   }
   ```

**Expected Responses**:
```javascript
// Successful update
{ ..., version: 2, updatedAt: "...", updatedBy: "..." }

// Version conflict
Error: HTTP 409: Version conflict - data was modified by another user
```

#### 2.4 Delete Entity (DELETE)

**Test**: Delete an entity
1. Delete test entity:
   ```javascript
   await ApiService.deleteEntity(newEntity._id);
   console.log('Entity deleted');
   ```
2. Verify deletion:
   ```javascript
   try {
     await ApiService.getEntity(newEntity._id);
   } catch (error) {
     console.log('Expected 404:', error);
   }
   ```

**Expected**: 404 Not Found error

---

### 3. Curation CRUD Operations 📋 NOT STARTED

#### 3.1 Create Curation

**Test**: Add curation to existing entity
1. Select an entity from the list
2. Create curation:
   ```javascript
   const curation = await ApiService.createCuration({
     entity_id: "rest_lasarte_barcelona",
     curator_name: "Test Curator",
     curation_type: "recommendation",
     status: "active",
     data: {
       rating: 5,
       notes: "Excellent cuisine",
       visited_date: "2025-11-18"
     }
   });
   console.log('Curation created:', curation);
   ```

**Expected**: Curation with `_id`, `version: 1`, linked to entity

#### 3.2 List Curations for Entity

**Test**: Get all curations for specific entity
```javascript
const curations = await ApiService.getEntityCurations("rest_lasarte_barcelona");
console.log('Curations:', curations);
```

#### 3.3 Update & Delete Curation

Similar to entity tests with optimistic locking via `version` field.

---

### 4. Sync Conflict Resolution 🔄 NOT STARTED

**Prerequisites**:
- Two browser windows/tabs open
- Same entity opened in both
- Different API keys (or test with manual MongoDB updates)

**Test Scenario**:
1. Window A: Load entity (version 1)
2. Window B: Load same entity (version 1)
3. Window B: Update entity → version 2
4. Window A: Try to update → 409 Conflict
5. Verify conflict detection UI shows:
   - "Sync conflict detected"
   - Server version vs local version
   - Resolution options: Server Wins / Client Wins / Merge

**UI Test**:
1. Check for conflict badge on entity card
2. Click "Resolve Conflict" button
3. Verify modal shows differences
4. Test each resolution method

---

### 5. Offline Sync Queue ⏸️ NOT STARTED

**Test Scenario**: Offline → Online transition

**Steps**:
1. **Go Offline**:
   ```javascript
   // Stop API server
   // In terminal: kill 96790
   ```
2. **Create/Update Entities** (will queue):
   ```javascript
   const offline = await ApiService.createEntity({
     entity_id: "rest_offline_test",
     name: "Offline Test"
   });
   // Should queue in IndexedDB with sync.status = 'pending'
   ```
3. **Check Sync Status UI**:
   - Verify "Offline" indicator
   - Verify "1 pending sync" count
4. **Go Online**:
   ```bash
   # Restart API server
   cd concierge-api-v3
   uvicorn main:app --reload --port 8000
   ```
5. **Verify Auto-Sync**:
   - Watch console for: `🔄 Processing sync queue`
   - Check sync status UI updates to "Online"
   - Verify entity synced to MongoDB:
     ```javascript
     const synced = await ApiService.getEntity(offline._id);
     console.log('Synced:', synced);
     ```

---

### 6. Google Places Integration (Optional) 🌍 NOT STARTED

**Prerequisites**: Enable Places API in Google Cloud Console

**Current Status**: 
- Places API (New) disabled in project 606656808180
- 502 error when testing `/api/v3/places/nearby`

**Setup Steps**:
1. Visit: https://console.developers.google.com/apis/api/places.googleapis.com/overview?project=606656808180
2. Click "Enable API"
3. Wait 2-5 minutes for propagation
4. Test API endpoint:
   ```bash
   curl 'http://localhost:8000/api/v3/places/nearby?latitude=41.3879&longitude=2.1699&radius=5000&type=restaurant&max_results=5'
   ```

**Frontend Test**:
1. Open app → "Quick Import Nearby" section
2. Click "Get My Location" (allow browser location access)
3. Adjust radius slider
4. Click "Search Nearby Places"
5. Verify places appear in staging area
6. Select places and import as entities
7. Verify entities created with:
   - Proper schema (V3 format)
   - `version: 1`
   - `externalId` with Google Place ID
   - Location data from Places API

---

## Success Criteria

### Minimum Viable (Phase 5 Complete)
- ✅ API connectivity verified
- ✅ API key authentication working
- ⬜ Entity CRUD operations working
- ⬜ Optimistic locking (version field) working
- ⬜ Conflict detection showing in UI
- ⬜ Offline sync queue functional

### Full Feature Complete
- ⬜ Curation CRUD operations working
- ⬜ Conflict resolution UI tested
- ⬜ Background sync tested
- ⬜ Places API integration working (optional)
- ⬜ Performance metrics validated

---

## Quick Test Commands

### Backend Health Checks
```bash
# API info
curl -s http://localhost:8000/api/v3/info | jq

# Health check
curl -s http://localhost:8000/api/v3/health | jq

# List entities
curl -s 'http://localhost:8000/api/v3/entities?limit=5' | jq

# Get specific entity
curl -s http://localhost:8000/api/v3/entities/691cbbf34f9e2794c9fa459d | jq
```

### Frontend Quick Tests
```javascript
// Check ApiService loaded
console.log('ApiService:', ApiService);

// Check API key
console.log('API Key:', localStorage.getItem('concierge-api-key'));

// Test connection
await ApiService.getInfo();

// List entities
const entities = await ApiService.listEntities({ limit: 5 });
console.log(entities);

// Check sync status
const status = await SyncManager.getSyncStatus();
console.log('Sync Status:', status);
```

---

## Known Issues

### 1. Google Places API Disabled
- **Status**: Not blocking V3 migration
- **Error**: 502 from `/api/v3/places/nearby`
- **Solution**: Enable API in Google Cloud Console (see section 6)

### 2. URL Construction Fixed ✅
- **Issue**: 404 on `/api/v3entities?limit=50` (missing slash)
- **Fix**: Modified `request()` method to split endpoint from query string
- **Status**: Fixed in apiService.js lines 104-131

---

## Next Steps

1. **Complete Entity CRUD Tests** (in progress)
2. Test curation operations
3. Test conflict resolution UI
4. Test offline sync queue
5. (Optional) Enable Places API and test integration
6. Document results in PROJECT_STATUS.md
7. Mark Phase 5 as complete ✅

---

## Notes

- All tests should be run with DevTools Console open
- Check Network tab for API requests
- Verify localStorage for API key and sync queue
- Check IndexedDB (Application tab) for entity storage
- Monitor console for error messages

---

**Last Updated**: November 18, 2025  
**Tester**: [Your Name]  
**Status**: Entity CRUD testing in progress
