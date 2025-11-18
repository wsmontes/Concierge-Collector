# API Format Discovery and Fix

**Date:** October 20, 2025  
**Issue:** 400 BAD REQUEST - "Expected array of entities"  
**Status:** ✅ **FIXED**

---

## Problem

```
POST /api/import/concierge-v2 - 400 BAD REQUEST
Error: Expected array of entities
```

### Root Cause

We were sending the **wrong format** to `/api/import/concierge-v2`. The endpoint expects **V2 format** (metadata array structure), not entity format.

---

## API Format Discovery

### Method: Direct API Testing

```bash
# Test 1: Object with entities array
curl -X POST /api/import/concierge-v2 \
  -d '{"entities": [], "curators": []}'
# Result: ❌ "Expected array of entities"

# Test 2: Direct array with entity format
curl -X POST /api/import/concierge-v2 \
  -d '[{"entity_type": "restaurant", "entity_data": {}}]'
# Result: ❌ "Entity name not found in collector metadata"

# Test 3: V2 format (metadata array)
curl -X POST /api/import/concierge-v2 \
  -d '[{"metadata": [{"type": "collector", "data": {"name": "Test"}}]}]'
# Result: ✅ SUCCESS!
```

---

## API Endpoints Format Summary

### 1. POST `/api/entities` - Entity Format ✅

**Expects:**
```json
{
  "entity_type": "restaurant",
  "name": "Restaurant Name",
  "entity_data": {
    "description": "...",
    "concepts": [{"category": "Cuisine", "value": "Italian"}],
    ...
  }
}
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "entity_id": 123,
    "entity": { ... }
  }
}
```

### 2. POST `/api/import/concierge-v2` - V2 Format ✅

**Expects:** Array of V2 format objects
```json
[
  {
    "metadata": [
      {
        "type": "restaurant",
        "id": 123,
        "serverId": 456
      },
      {
        "type": "collector",
        "source": "local",
        "data": {
          "name": "Restaurant Name",
          "description": "...",
          "location": {...},
          "photos": [...]
        }
      }
    ],
    "Cuisine": ["Italian", "Pizza"],
    "Price Range": ["$$"]
  }
]
```

**Response:**
```json
{
  "status": "success",
  "data": {
    "imported": [
      {"entity_id": 1, "entity_type": "restaurant", "name": "..."}
    ],
    "errors": [],
    "summary": {
      "total_processed": 1,
      "successful": 1,
      "failed": 0
    }
  }
}
```

### 3. GET `/api/entities?entity_type=restaurant` - Wrapped Response

**Response:**
```json
{
  "status": "success",
  "data": {
    "data": [
      { "id": 1, "name": "...", "entity_data": {...} }
    ]
  },
  "timestamp": "..."
}
```

**Note:** Response has nested `data.data` structure!

---

## Changes Made

### 1. ✅ Fixed `batchUploadRestaurants()` - Use V2 Format

**Before:**
```javascript
// Sending entity format
const entities = restaurants.map(r => ({
    entity_type: 'restaurant',
    name: r.name,
    entity_data: { ... }
}));
return this.post('/import/concierge-v2', entities);
```

**After:**
```javascript
// Send V2 format directly if already in V2
if (isV2Format) {
    return this.post('/import/concierge-v2', restaurants);
}

// Transform flat to V2 format
const v2Restaurants = restaurants.map(restaurant => ({
    metadata: [
        {
            type: 'collector',
            source: 'local',
            data: {
                name: restaurant.name,
                description: restaurant.description,
                location: restaurant.location,
                // ... conditional fields
            }
        }
    ],
    // Concepts as root-level categories
    "Cuisine": ["Italian"],
    "Price Range": ["$$"]
}));
return this.post('/import/concierge-v2', v2Restaurants);
```

### 2. ✅ Fixed Response Unwrapping in `syncManager.js`

**Added:**
```javascript
// Handle nested data.data structure
if (restaurants.data && typeof restaurants.data === 'object') {
    restaurants = restaurants.data;
}

// Then handle entities array
if (restaurants.entities && Array.isArray(restaurants.entities)) {
    restaurants = restaurants.entities;
}

// Or direct data array
if (restaurants.data && Array.isArray(restaurants.data)) {
    restaurants = restaurants.data;
}
```

---

## Format Transformation Flow

### Flat → V2 Format

```
Flat Restaurant:
{
  name: "Restaurant",
  description: "...",
  concepts: [
    {category: "Cuisine", value: "Italian"},
    {category: "Price Range", value: "$$"}
  ]
}

↓ Transform ↓

V2 Format:
{
  metadata: [
    {
      type: "collector",
      data: {
        name: "Restaurant",
        description: "..."
      }
    }
  ],
  "Cuisine": ["Italian"],
  "Price Range": ["$$"]
}
```

### V2 → No Transform Needed

If already in V2 format (has `metadata` array), send directly to `/api/import/concierge-v2`.

---

## Testing Results

### ✅ Import Endpoint Test

```bash
curl -X POST https://wsmontes.pythonanywhere.com/api/import/concierge-v2 \
  -H "Content-Type: application/json" \
  -d '[{
    "metadata": [{
      "type": "collector",
      "data": {"name": "API Test Restaurant"}
    }],
    "Cuisine": ["Test"]
  }]'
```

**Result:**
```json
{
  "status": "success",
  "message": "Import completed: 1 entities imported, 0 errors",
  "data": {
    "imported": [{"entity_id": 1, "name": "API Test Restaurant"}],
    "summary": {"successful": 1, "failed": 0}
  }
}
```

---

## Key Learnings

### 1. **Different Endpoints, Different Formats**

- `POST /api/entities` → Entity format
- `POST /api/import/concierge-v2` → V2 format (array)
- They are NOT interchangeable!

### 2. **Response Structure is Nested**

```json
{
  "data": {
    "data": [ ... ]  // ← Double nesting!
  }
}
```

Always unwrap: `response.data.data` or `response.data.entities`

### 3. **V2 Format Key Features**

- ✅ `metadata` array with typed objects
- ✅ Concepts as root-level category keys
- ✅ Conditional field inclusion (only if has data)
- ✅ Used for bulk import/export

### 4. **Entity Format Key Features**

- ✅ `entity_type` field at root
- ✅ All data in `entity_data` object
- ✅ Concepts as array in `entity_data.concepts`
- ✅ Used for individual CRUD operations

---

## Files Modified

1. ✅ `scripts/apiService.js`
   - Fixed `batchUploadRestaurants()` to send V2 format
   - Added flat → V2 transformation
   - Kept `createRestaurant()` using entity format

2. ✅ `scripts/syncManager.js`
   - Added response unwrapping for nested `data.data`
   - Added support for `entities` array wrapper
   - Better format detection and logging

---

## Next Steps

- [x] **Test bulk upload** with real data
- [x] **Verify response unwrapping** works correctly
- [x] **Test with V2 export** data
- [ ] Update documentation with correct formats
- [ ] Add format validation before sending

---

## Success Criteria

✅ **Fix is successful when:**
- No more 400 BAD REQUEST errors
- Bulk upload completes successfully
- V2 format data imports correctly
- Response data unwraps properly
- Restaurant count shows correctly

---

**Status:** ✅ **COMPLETE**

The API format mismatch is fixed. Backend now receives correct V2 format for imports.
