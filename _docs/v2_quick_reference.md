# V2 Format Quick Reference

## Export Format

```json
[
  {
    "metadata": [
      {
        "type": "restaurant",           // OPTIONAL - only if synced/modified/deleted
        "id": 123,
        "serverId": 456,                // OPTIONAL - only if synced
        "created": {
          "timestamp": "ISO-8601",
          "curator": {
            "id": 5,
            "name": "John Smith"
          }
        },
        "modified": {                   // OPTIONAL - only if modified
          "timestamp": "ISO-8601"
        },
        "sync": {                       // OPTIONAL - only if relevant
          "status": "synced",
          "lastSyncedAt": "ISO-8601",
          "deletedLocally": false
        }
      },
      {
        "type": "collector",            // REQUIRED - always present
        "source": "local",
        "data": {
          "name": "Restaurant Name",    // REQUIRED
          "description": "...",         // OPTIONAL
          "transcription": "...",       // OPTIONAL
          "location": {                 // OPTIONAL - only if coordinates exist
            "latitude": 40.7589,
            "longitude": -73.9851,
            "address": "..."            // OPTIONAL
          },
          "photos": [...]               // OPTIONAL - only if photos exist
        }
      }
      // Michelin/Google metadata OPTIONAL - only if imported
    ],
    "Cuisine": [...],                   // OPTIONAL - curator categories
    "Menu": [...],
    "Price Range": [...],
    "Mood": [...],
    "Setting": [...],
    "Crowd": [...],
    "Suitable For": [...],
    "Food Style": [...],
    "Drinks": [...],
    "Special Features": [...]
  }
]
```

## The 10 Categories

All at root level, all optional:

1. **Cuisine** - Type of food/cooking style
2. **Menu** - Specific dishes or ingredients  
3. **Price Range** - Affordable, Mid-range, Expensive
4. **Mood** - Atmosphere feeling
5. **Setting** - Physical environment
6. **Crowd** - Type of clientele
7. **Suitable For** - Occasions
8. **Food Style** - Service/preparation style
9. **Drinks** - Beverage offerings
10. **Special Features** - Unique services

## Conditional Inclusion Rules

### Restaurant Metadata
Include ONLY if:
- `serverId` exists (synced to server) OR
- `deletedLocally` is true OR
- `modifiedAt` differs from `timestamp`

### Collector Data Fields
- `name` - ALWAYS required
- `description` - Only if not empty
- `transcription` - Only if not empty
- `location` - Only if latitude/longitude exist
- `photos` - Only if photos exist

### Categories
- Only include categories that have values
- Each category is an array of strings

## Export Function

```javascript
// In dataStorage.js
async exportDataV2() {
  const restaurants = await this.db.restaurants.toArray();
  
  const exportRestaurants = await Promise.all(
    restaurants.map(async restaurant => {
      const metadata = [];
      
      // Conditionally add restaurant metadata
      if (hasServerId || isDeleted || wasModified) {
        metadata.push({...restaurantMeta});
      }
      
      // Always add collector data
      metadata.push({...collectorData});
      
      // Build categories
      const categorizedConcepts = {...};
      
      return {
        metadata,
        ...categorizedConcepts
      };
    })
  );
  
  return exportRestaurants; // Direct array, no wrapper
}
```

## Import Function

```javascript
// In dataStorage.js
async importDataV2(restaurantsArray) {
  await this.db.transaction('rw', [...tables], async () => {
    for (const restaurantData of restaurantsArray) {
      const { metadata, ...categories } = restaurantData;
      
      // Extract metadata
      const restaurantMeta = metadata.find(m => m.type === 'restaurant');
      const collectorMeta = metadata.find(m => m.type === 'collector');
      
      // Get or create curator
      let curatorId = ...;
      
      // Create or update restaurant
      let restaurantId = ...;
      
      // Handle location, photos, concepts
      ...
    }
  });
}
```

## Format Detection

```javascript
// In exportImportModule.js
detectImportFormat(data) {
  // V2: Array with metadata arrays
  if (Array.isArray(data) && data[0]?.metadata) {
    return 'v2';
  }
  
  // Concierge V1: Array/Object with concept categories
  if (hasConciergeProps) {
    return 'concierge';
  }
  
  // Standard: Object with curators/concepts/restaurants
  if (data.curators && data.concepts) {
    return 'standard';
  }
}
```

## Usage

### Export
```javascript
const exportData = await dataStorage.exportDataV2();
// Returns: Array of restaurant objects
// Save as: concierge-v2-2025-10-17.json
```

### Import
```javascript
const jsonData = JSON.parse(fileContents);
await dataStorage.importDataV2(jsonData);
// Auto-detects format
// Creates/updates restaurants
```

## Key Differences from V1

| Feature | V1 | V2 |
|---------|----|----|
| Root structure | `{restaurants: [...]}` | `[...]` |
| Metadata location | Mixed with data | Separate array |
| Categories | Flat properties | Root-level arrays |
| Curator data | Mixed with system data | `metadata[].data` |
| Source tracking | None | Per-source metadata |
| Conditional fields | All included | Only if exist |
| File size | Larger | Smaller |

## Examples

### Minimal Restaurant
```json
[{
  "metadata": [{
    "type": "collector",
    "source": "local",
    "data": {"name": "Pizza Place"}
  }],
  "Cuisine": ["Pizza"]
}]
```

### Full Restaurant
```json
[{
  "metadata": [
    {
      "type": "restaurant",
      "id": 42,
      "serverId": 789,
      "created": {...},
      "sync": {...}
    },
    {
      "type": "collector",
      "source": "local",
      "data": {
        "name": "Fancy Restaurant",
        "description": "...",
        "location": {...},
        "photos": [...]
      }
    },
    {
      "type": "michelin",
      "data": {...}
    }
  ],
  "Cuisine": ["Italian"],
  "Menu": ["Pasta"],
  "Price Range": ["Expensive"],
  ...all 10 categories...
}]
```

## Schema Validation

Use `concierge_export_schema_v2.json` for validation:

```javascript
const Ajv = require('ajv');
const ajv = new Ajv();
const schema = require('./concierge_export_schema_v2.json');
const validate = ajv.compile(schema);

const valid = validate(data);
if (!valid) {
  console.log(validate.errors);
}
```

## Best Practices

1. ✅ Always validate against schema before import
2. ✅ Use transactions for imports (atomicity)
3. ✅ Log all operations for debugging
4. ✅ Handle duplicates gracefully (deduplicate)
5. ✅ Preserve timestamps from source data
6. ✅ Only include fields with actual data
7. ✅ Never break backward compatibility
8. ✅ Test with minimal and maximal data sets
