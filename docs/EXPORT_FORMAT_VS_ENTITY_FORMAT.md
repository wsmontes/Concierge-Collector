# Export Format vs MySQL Entity Format Comparison

**Date:** October 20, 2025  
**Purpose:** Verify that the V2 export format aligns with MySQL backend entity format

---

## Current V2 Export Format (dataStorage.js)

The `exportDataV2()` and `transformToV2Format()` functions create this structure:

```json
[
  {
    "metadata": [
      {
        "type": "restaurant",
        "id": 123,
        "serverId": 456,
        "created": {
          "timestamp": "2025-10-20T12:00:00.000Z",
          "curator": {
            "id": 1,
            "name": "Curator Name"
          }
        },
        "modified": {
          "timestamp": "2025-10-20T14:00:00.000Z"
        },
        "sync": {
          "status": "synced",
          "lastSyncedAt": "2025-10-20T13:00:00.000Z",
          "deletedLocally": false
        }
      },
      {
        "type": "collector",
        "source": "local",
        "data": {
          "name": "Restaurant Name",
          "description": "Description text",
          "transcription": "Audio transcription",
          "location": {
            "latitude": 40.7128,
            "longitude": -74.0060,
            "address": "123 Main St"
          },
          "photos": [
            {
              "id": 1,
              "photoData": "base64...",
              "timestamp": "2025-10-20T12:00:00.000Z"
            }
          ]
        }
      }
    ],
    "Cuisine": ["Italian", "Pizza"],
    "Price Range": ["$$"],
    "Mood": ["Casual"]
  }
]
```

---

## MySQL Backend Entity Format (Required by /api/entities)

The MySQL backend expects this structure for entities:

```json
{
  "entity_type": "restaurant",
  "name": "Restaurant Name",
  "entity_data": {
    "description": "Description text",
    "transcription": "Audio transcription",
    "location": {
      "latitude": 40.7128,
      "longitude": -74.0060,
      "address": "123 Main St"
    },
    "notes": {
      "private": "",
      "public": ""
    },
    "photos": [],
    "concepts": [
      {
        "category": "Cuisine",
        "value": "Italian"
      }
    ],
    "michelinData": null,
    "googlePlacesData": null,
    "curatorId": 1,
    "curatorName": "Curator Name",
    "timestamp": "2025-10-20T12:00:00.000Z"
  }
}
```

---

## ⚠️ FORMAT MISMATCH DETECTED

### **Problem:** The formats are **COMPLETELY DIFFERENT**

| Aspect | V2 Export Format | MySQL Entity Format | Match? |
|--------|-----------------|-------------------|--------|
| Structure | Metadata array with type-based objects | Flat entity_data object | ❌ NO |
| Concepts | Root-level categories: `{"Cuisine": ["Italian"]}` | Array in entity_data: `[{category, value}]` | ❌ NO |
| Photos | Array of objects with photoData | Array structure TBD | ⚠️ Unknown |
| Curator | Nested in metadata.created | Flat curatorId/curatorName | ❌ NO |
| Sync data | Separate metadata object | Not in entity_data | ❌ NO |
| Name | In collector.data.name | Root-level name field | ❌ NO |

---

## 🔧 Required Changes

### Option 1: Update apiService.js to Transform V2 → Entity Format

**Current code in `apiService.js`:**
```javascript
async createRestaurant(restaurantData) {
    const entityPayload = {
        entity_type: 'restaurant',
        name: restaurantData.name,
        entity_data: {
            description: restaurantData.description || '',
            transcription: restaurantData.transcription || '',
            location: restaurantData.location || null,
            // ... direct field mapping
        }
    };
    
    return this.post('/entities', entityPayload);
}
```

**This assumes** `restaurantData` has flat structure like:
```javascript
{
    name: "Restaurant",
    description: "...",
    concepts: [{category, value}],
    // ...
}
```

**But V2 export provides:**
```javascript
{
    metadata: [
        { type: "collector", data: { name: "Restaurant" } }
    ],
    "Cuisine": ["Italian"]
}
```

### Solution: Add Transformation Function

We need to add a function in `apiService.js` to transform V2 format → Entity format:

```javascript
/**
 * Transform V2 export format to MySQL entity format
 * @param {Object} v2Restaurant - Restaurant in V2 format (with metadata array)
 * @returns {Object} Restaurant in entity format
 */
transformV2ToEntityFormat(v2Restaurant) {
    const { metadata, ...categories } = v2Restaurant;
    
    // Extract data from metadata array
    const restaurantMeta = metadata.find(m => m.type === 'restaurant') || {};
    const collectorMeta = metadata.find(m => m.type === 'collector') || {};
    
    const collectorData = collectorMeta.data || {};
    const createdData = restaurantMeta.created || {};
    
    // Transform concepts from categorized format to array format
    const concepts = [];
    Object.entries(categories).forEach(([category, values]) => {
        if (Array.isArray(values)) {
            values.forEach(value => {
                concepts.push({ category, value });
            });
        }
    });
    
    // Transform photos to simpler format
    const photos = (collectorData.photos || []).map(photo => ({
        url: photo.photoData,
        caption: '',
        uploadedAt: photo.timestamp || new Date().toISOString()
    }));
    
    // Build entity format
    return {
        id: restaurantMeta.id,
        serverId: restaurantMeta.serverId,
        name: collectorData.name,
        description: collectorData.description || '',
        transcription: collectorData.transcription || '',
        location: collectorData.location || null,
        notes: { private: '', public: '' },
        photos: photos,
        concepts: concepts,
        michelinData: null,
        googlePlacesData: null,
        curatorId: createdData.curator?.id,
        curatorName: createdData.curator?.name,
        timestamp: createdData.timestamp || new Date().toISOString(),
        needsSync: false,
        lastSynced: restaurantMeta.sync?.lastSyncedAt || null,
        deletedLocally: restaurantMeta.sync?.deletedLocally || false
    };
}
```

Then update `batchUploadRestaurants` to use this transformation:

```javascript
async batchUploadRestaurants(restaurants) {
    // Check if restaurants are in V2 format (have metadata array)
    const isV2Format = restaurants.length > 0 && 
                       Array.isArray(restaurants[0].metadata);
    
    // Transform to entity format
    const transformedRestaurants = isV2Format
        ? restaurants.map(r => this.transformV2ToEntityFormat(r))
        : restaurants;
    
    // Now transform to entity payload for backend
    const entities = transformedRestaurants.map(restaurant => ({
        entity_type: 'restaurant',
        name: restaurant.name,
        entity_data: {
            description: restaurant.description || '',
            transcription: restaurant.transcription || '',
            location: restaurant.location || null,
            notes: restaurant.notes || { private: '', public: '' },
            photos: restaurant.photos || [],
            concepts: restaurant.concepts || [],
            michelinData: restaurant.michelinData || null,
            googlePlacesData: restaurant.googlePlacesData || null,
            curatorId: restaurant.curatorId || null,
            curatorName: restaurant.curatorName || null,
            timestamp: restaurant.timestamp || new Date().toISOString()
        }
    }));
    
    // Extract curators...
    // (rest of the function remains the same)
}
```

---

## Option 2: Update Export Format to Match Entity Format

**Easier but requires changing export logic everywhere**

Update `dataStorage.js` to export in entity format instead of V2 format:

```javascript
async exportForSync() {
    const restaurants = await this.db.restaurants.toArray();
    
    return Promise.all(restaurants.map(async restaurant => {
        const location = await this.db.restaurantLocations
            .where('restaurantId').equals(restaurant.id).first();
        
        const photos = await this.db.restaurantPhotos
            .where('restaurantId').equals(restaurant.id).toArray();
        
        const concepts = /* get concepts */;
        
        return {
            id: restaurant.id,
            serverId: restaurant.serverId,
            name: restaurant.name,
            description: restaurant.description,
            transcription: restaurant.transcription,
            location: location,
            notes: { private: '', public: '' },
            photos: photos.map(p => ({
                url: p.photoData,
                caption: '',
                uploadedAt: p.timestamp
            })),
            concepts: concepts.map(c => ({
                category: c.category,
                value: c.value
            })),
            curatorId: restaurant.curatorId,
            curatorName: /* lookup curator */,
            timestamp: restaurant.timestamp
        };
    }));
}
```

---

## ✅ Recommendation: Option 1

**Implement transformation in `apiService.js`** because:

1. V2 format is used for export/import between users
2. Entity format is only for backend API
3. Keeps export format unchanged (less breaking changes)
4. Centralized transformation in one place

---

## Action Items

- [ ] Add `transformV2ToEntityFormat()` method to `apiService.js`
- [ ] Update `batchUploadRestaurants()` to detect and transform V2 format
- [ ] Update `createRestaurant()` to handle both formats
- [ ] Test with actual V2 export data
- [ ] Update documentation with format examples

---

## Testing

Use `test_api_entities.html` to verify:

1. Export restaurants in V2 format
2. Import them back (should work locally)
3. Sync to server (should transform and upload correctly)
4. Verify data on server matches what was exported
