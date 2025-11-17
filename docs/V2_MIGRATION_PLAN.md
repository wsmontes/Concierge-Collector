# V2 Migration Implementation Plan

**Date:** October 20, 2025  
**Status:** In Progress

## Understanding V2 Architecture

### V2 Data Structure (Server & Client)
```json
{
  "Name": "Restaurant Name",
  "Type": "restaurant",
  "Cuisine": ["Italian", "Pizza"],
  "Price Range": "$$",
  "Location": {
    "Address": "123 Main St",
    "City": "Madrid",
    "Country": "Spain",
    "Coordinates": {"lat": 40.42, "lng": -3.69}
  },
  "metadata": [
    {
      "type": "collector",
      "source": "local",
      "data": {
        "name": "Restaurant Name",
        "description": "Description",
        "transcription": "Audio transcription"
      }
    }
  ]
}
```

### IndexedDB Schema (V2)
```javascript
restaurants: '++id, Name, Type, *Cuisine, curatorId'
```

**Key Points:**
- Store V2 JSON directly (capitalized fields)
- NO junction tables (restaurantConcepts, restaurantLocations, restaurantPhotos)
- Cuisine is a multi-entry index for querying
- curatorId added for UI filtering (not part of server V2, client-side only)

## What Works ✅

1. **Server Sync (Import from Server)** - `syncManager.importRestaurants()`
   - Fetches V2 JSON from `/api/v2/restaurants`
   - Stores directly in IndexedDB with curatorId assignment

2. **Display Functions** - Fixed in recent changes
   - `processRestaurants()` - Maps V2 fields to UI
   - `getRestaurantDetails()` - Returns V2 data
   - `getRestaurantsByCurator()` - Filters V2 data

## What Needs Fixing ❌

### 1. Local Restaurant Creation
**Method:** `saveRestaurantWithTransaction()` / `saveRestaurant()`

**Current Problem:** Tries to use junction tables (restaurantConcepts, restaurantLocations, restaurantPhotos)

**V2 Solution:**
```javascript
async saveRestaurant(name, curatorId, cuisine, location, description, transcription) {
  const restaurant = {
    Name: name,
    Type: 'restaurant',
    Cuisine: cuisine || [],  // Array of strings
    Location: location || null,  // {Address, City, Country, Coordinates}
    metadata: [
      {
        type: 'collector',
        source: 'local',
        data: {
          name: name,
          description: description || '',
          transcription: transcription || ''
        }
      }
    ],
    curatorId: curatorId,  // Client-side only
    timestamp: new Date()
  };
  
  return await this.db.restaurants.add(restaurant);
}
```

### 2. Local Restaurant Update
**Method:** `updateRestaurant()`

**Current Problem:** Tries to update junction tables

**V2 Solution:**
```javascript
async updateRestaurant(id, name, curatorId, cuisine, location, description, transcription) {
  const updates = {
    Name: name,
    Type: 'restaurant',
    Cuisine: cuisine || [],
    Location: location || null,
    metadata: [
      {
        type: 'collector',
        source: 'local',
        data: {
          name: name,
          description: description || '',
          transcription: transcription || ''
        }
      }
    ],
    curatorId: curatorId,
    timestamp: new Date()
  };
  
  return await this.db.restaurants.update(id, updates);
}
```

### 3. File Import (V2 JSON)
**Method:** `importDataV2()`

**Current Problem:** Tries to import into junction tables

**V2 Solution:**
```javascript
async importDataV2(restaurantsArray) {
  for (const restaurant of restaurantsArray) {
    // V2 JSON already has correct structure
    // Just add curatorId for client-side filtering
    const restaurantWithCurator = {
      ...restaurant,
      curatorId: 1  // Default curator or from metadata
    };
    
    await this.db.restaurants.add(restaurantWithCurator);
  }
}
```

### 4. File Export (V2 JSON)
**Method:** `transformToV2Format()` / `exportDataV2()`

**Current Status:** Simplified but may not include full metadata

**V2 Solution:**
```javascript
async transformToV2Format(restaurant) {
  // Restaurant is already in V2 format in IndexedDB
  // Just remove client-side fields
  const {id, curatorId, timestamp, ...v2Data} = restaurant;
  return v2Data;
}
```

## Implementation Steps

### Phase 1: Fix Core Save/Update ✅ (Current)
1. ✅ Fix `processRestaurants()` - no junction tables
2. ✅ Fix `getRestaurantDetails()` - no junction tables  
3. ✅ Fix `getRestaurantsByCurator()` - no junction tables
4. ⏳ Rewrite `saveRestaurant()` - V2 structure
5. ⏳ Rewrite `updateRestaurant()` - V2 structure

### Phase 2: Fix Import/Export
1. ⏳ Rewrite `importDataV2()` - direct V2 storage
2. ⏳ Fix `transformToV2Format()` - proper metadata
3. ⏳ Test file import/export roundtrip

### Phase 3: Fix Sync
1. ⏳ Update `syncAllPending()` to send V2 format
2. ⏳ Handle same curator edit (PUT to server)
3. ⏳ Handle different curator edit (POST new to server)

## Testing Checklist

- [ ] Create new restaurant locally
- [ ] Edit local restaurant
- [ ] Import V2 JSON file
- [ ] Export restaurants to V2 JSON
- [ ] Sync local restaurant to server
- [ ] Sync server restaurant to local
- [ ] Edit synced restaurant (same curator)
- [ ] Edit synced restaurant (different curator)
- [ ] View restaurant details
- [ ] Filter by curator
- [ ] Search by cuisine

