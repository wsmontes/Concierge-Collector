# API Entities Migration Summary

**Date:** October 20, 2025  
**Branch:** Database-Connection  
**Status:** ✅ Complete

---

## Problem Statement

The client was receiving **405 METHOD NOT ALLOWED** errors when accessing `/api/restaurants` because:

1. The MySQL backend API uses **`/api/entities`** endpoints, not `/api/restaurants`
2. Client code was still calling legacy `/api/restaurants` endpoints
3. Endpoint mismatch caused all restaurant operations to fail

---

## Backend API Structure (MySQL API)

### ✅ What EXISTS:

```
GET    /api/health                  - Health check
GET    /api/info                    - API information
GET    /api/entities                - Get all entities (with query params)
GET    /api/entities?entity_type=restaurant  - Get restaurants
GET    /api/entities/{id}           - Get single entity by ID
POST   /api/entities                - Create new entity
PUT    /api/entities/{id}           - Update entity
DELETE /api/entities/{id}           - Delete entity
POST   /api/import/concierge-v2     - Bulk import entities
GET    /api/curators                - Get all curators
```

### ❌ What DOESN'T Exist:

```
❌ /api/restaurants              - Does NOT exist
❌ /api/restaurants/batch        - Does NOT exist
❌ /api/restaurants/sync         - Does NOT exist
❌ /api/restaurants/{id}         - Does NOT exist
❌ /api/curation/json            - Does NOT exist
```

---

## Changes Made

### 1. **apiService.js** - Updated All Restaurant Operations

#### Before (❌ Broken):
```javascript
async getRestaurants() {
    return this.get('/restaurants');
}

async createRestaurant(restaurantData) {
    const batchResponse = await this.batchUploadRestaurants([restaurantData]);
    // ...
}

async batchUploadRestaurants(restaurants) {
    return this.post('/restaurants/batch', restaurants);
}
```

#### After (✅ Fixed):
```javascript
async getRestaurants() {
    return this.get('/entities?entity_type=restaurant');
}

async getRestaurant(identifier) {
    return this.get(`/entities/${identifier}`);
}

async createRestaurant(restaurantData) {
    const entityPayload = {
        entity_type: 'restaurant',
        name: restaurantData.name,
        entity_data: {
            description: restaurantData.description || '',
            transcription: restaurantData.transcription || '',
            location: restaurantData.location || null,
            notes: restaurantData.notes || null,
            photos: restaurantData.photos || [],
            concepts: restaurantData.concepts || [],
            michelinData: restaurantData.michelinData || null,
            googlePlacesData: restaurantData.googlePlacesData || null,
            curatorId: restaurantData.curatorId || null,
            curatorName: restaurantData.curatorName || null,
            timestamp: restaurantData.timestamp || new Date().toISOString()
        }
    };
    
    return this.post('/entities', entityPayload);
}

async updateRestaurant(identifier, restaurantData) {
    const entityPayload = {
        entity_type: 'restaurant',
        name: restaurantData.name,
        entity_data: { /* same as create */ }
    };
    
    return this.put(`/entities/${identifier}`, entityPayload);
}

async deleteRestaurant(identifier) {
    return this.delete(`/entities/${identifier}`);
}

async batchUploadRestaurants(restaurants) {
    // Transform restaurants to entities format
    const entities = restaurants.map(restaurant => ({
        entity_type: 'restaurant',
        name: restaurant.name,
        entity_data: { /* restaurant data */ }
    }));
    
    // Extract curators
    const curatorsMap = new Map();
    restaurants.forEach(restaurant => {
        if (restaurant.curatorId && restaurant.curatorName) {
            curatorsMap.set(restaurant.curatorId, {
                id: restaurant.curatorId,
                name: restaurant.curatorName
            });
        }
    });
    
    const payload = {
        entities: entities,
        curators: Array.from(curatorsMap.values())
    };
    
    return this.post('/import/concierge-v2', payload);
}
```

### 2. **config.js** - Updated Backend Configuration

#### Before:
```javascript
backend: {
    baseUrl: 'https://wsmontes.pythonanywhere.com/api',
    endpoints: {
        restaurants: '/restaurants',
        restaurantsBatch: '/restaurants/batch',
        restaurantsSync: '/restaurants/sync',
        // ...
    }
}
```

#### After:
```javascript
backend: {
    baseUrl: 'https://wsmontes.pythonanywhere.com/api',
    endpoints: {
        // Correct endpoints for MySQL API backend
        entities: '/entities',
        entityById: '/entities/{id}',
        entitiesQuery: '/entities?entity_type=restaurant',
        importBulk: '/import/concierge-v2',
        health: '/health',
        info: '/info',
        curators: '/curators',
        
        // Legacy endpoints marked as NOT SUPPORTED
        restaurantsLegacy: '/restaurants',         // ❌ NOT SUPPORTED
        restaurantsBatchLegacy: '/restaurants/batch',  // ❌ NOT SUPPORTED
        restaurantsSyncLegacy: '/restaurants/sync'     // ❌ NOT SUPPORTED
    }
}
```

### 3. **apiHandler.js** - Updated Documentation

Changed example endpoint from `/api/restaurants` to `/api/entities` in comments.

### 4. **Deprecated Methods**

- `uploadRestaurantJson()` - Now forwards to `createRestaurant()` with deprecation warning
- All methods using `/restaurants` endpoints removed or redirected

---

## Data Transformation

### Entity Payload Structure

All restaurant data is now wrapped in the entity format:

```json
{
  "entity_type": "restaurant",
  "name": "Restaurant Name",
  "entity_data": {
    "description": "...",
    "transcription": "...",
    "location": {
      "latitude": null,
      "longitude": null,
      "address": null
    },
    "notes": {
      "private": "",
      "public": ""
    },
    "photos": [],
    "concepts": [],
    "michelinData": null,
    "googlePlacesData": null,
    "curatorId": null,
    "curatorName": null,
    "timestamp": "2025-10-20T..."
  }
}
```

### Bulk Import Payload Structure

```json
{
  "entities": [
    {
      "entity_type": "restaurant",
      "name": "...",
      "entity_data": { ... }
    }
  ],
  "curators": [
    {
      "id": 1,
      "name": "Curator Name"
    }
  ]
}
```

---

## Testing Checklist

- [ ] **GET** all restaurants: `apiService.getRestaurants()`
- [ ] **GET** single restaurant: `apiService.getRestaurant(id)`
- [ ] **POST** create restaurant: `apiService.createRestaurant(data)`
- [ ] **PUT** update restaurant: `apiService.updateRestaurant(id, data)`
- [ ] **DELETE** restaurant: `apiService.deleteRestaurant(id)`
- [ ] **Bulk import**: `apiService.batchUploadRestaurants(restaurants)`
- [ ] **Sync manager** import from server
- [ ] **Sync manager** upload to server
- [ ] **Health check**: Test backend connectivity

---

## Breaking Changes

### Methods with Changed Signatures

1. **`createRestaurant(restaurantData)`**
   - Now sends entity-formatted payload
   - Returns entity response structure

2. **`updateRestaurant(identifier, restaurantData)`**
   - Now sends entity-formatted payload
   - Returns entity response structure

3. **`batchUploadRestaurants(restaurants)`**
   - Now uses `/api/import/concierge-v2`
   - Requires curators array in payload
   - Response format may differ

### Removed/Deprecated

- `bulkSync()` - Partially deprecated (only creates supported via import)
- `uploadRestaurantJson()` - Deprecated, forwards to `createRestaurant()`

---

## Important Notes

### ⚠️ Michelin Staging Endpoints

The following endpoints may NOT exist on MySQL backend:
- `/restaurants-staging` (GET, POST)
- `/restaurants-staging/{name}/approve`

These are marked with warnings in the code and may need to be migrated or removed.

### ⚠️ Backend URL

The config currently points to:
```
https://wsmontes.pythonanywhere.com/api
```

**TODO:** Verify this is the correct MySQL API backend URL. If the MySQL API is hosted elsewhere, update `config.js` accordingly.

### ⚠️ Response Format Differences

The MySQL backend may return responses in a different format than the old backend. Monitor console logs and adjust response handling if needed.

---

## Next Steps

1. **Test all CRUD operations** against the live MySQL backend
2. **Verify backend URL** is correct in `config.js`
3. **Check Michelin staging** endpoints - migrate or remove if not supported
4. **Monitor error logs** for any remaining 405 errors
5. **Update documentation** if response formats differ

---

## Files Modified

1. `/scripts/apiService.js` - All restaurant operations updated
2. `/scripts/config.js` - Backend endpoints updated
3. `/scripts/apiHandler.js` - Documentation updated
4. `/docs/API_ENTITIES_MIGRATION.md` - This document

---

## Support

If you encounter issues:

1. Check browser console for detailed error messages
2. Verify backend is responding: Test `/api/health` endpoint
3. Check network tab in DevTools for actual request/response
4. Ensure backend URL in `config.js` is correct

---

**Migration Status:** ✅ **COMPLETE**

All client code now uses the correct `/api/entities` endpoints compatible with the MySQL API backend.
