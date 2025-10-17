# Metadata Object Format Proposal V2 - Source-Specific Nested Structure

## Overview
This document proposes a metadata structure where:
1. **Curator categories remain as root keys** (Cuisine, Menu, etc.)
2. **Everything else goes under metadata array**
3. **Source-specific data is nested** (Michelin, Google Places, Collector internal)
4. **Restaurant metadata is the first item** in the metadata array
5. **Only include objects with actual data** - No mandatory objects, no empty placeholders

## Core Principle: Conditional Inclusion

**Critical Rule:** Only include metadata objects and fields that have actual data.

Examples:
- ✅ Restaurant never imported from Michelin → **No Michelin object in metadata**
- ✅ No photos uploaded → **Omit photos array**
- ✅ No transcription recorded → **Omit transcription field**
- ✅ No description written → **Omit description field**
- ✅ Location not set → **Omit location object**

**Result:** Clean, minimal JSON with only meaningful data

---

## Current System Analysis

### Curator Categories (Root Level)
Based on `initial_concepts.json`, the system has these curator categories:
- **Cuisine** (Italian, French, Japanese, etc.)
- **Menu** (Pasta, Pizza, Sushi, etc.)
- **Ambiance** (Casual, Fine Dining, etc.)
- **Price** (Expensive, Moderate, Budget)
- **Features** (Outdoor Seating, Reservations Required, etc.)
- **Special Features** (Wine Pairing, Chef's Table, etc.)

### Data Sources
1. **Collector Internal** - Local data entry by curators
2. **Michelin** - Imported from Michelin staging API
3. **Google Places** - Imported from Google Places API
4. **Server Sync** - Data synchronized from remote server

---

## Proposed Export Format

### Example 1: Minimal Restaurant (Just Curator Data)

**Scenario:** Restaurant added by curator with name and cuisine only. No photos, no location, no imports.

```json
{
  "metadata": [
    {
      "type": "collector",
      "source": "local",
      "data": {
        "name": "Restaurant Name"
      }
    }
  ],
  "Cuisine": ["Italian"]
}
```

**Note:** No restaurant metadata needed (default values), no photos, no location, no other sources.

---

### Example 2: Restaurant with Photos and Location

**Scenario:** Curator added photos and location, plus description and transcription.

```json
{
  "metadata": [
    {
      "type": "collector",
      "source": "local",
      "data": {
        "name": "Restaurant Name",
        "description": "Curator's written description...",
        "transcription": "Audio transcription...",
        "location": {
          "latitude": 40.758896,
          "longitude": -73.985130,
          "address": "123 Main St, New York, NY 10001"
        },
        "photos": [
          {
            "id": 1,
            "photoData": "data:image/jpeg;base64,...",
            "timestamp": "2025-10-17T10:35:00.000Z"
          }
        ]
      }
    }
  ],
  "Cuisine": ["Italian"],
  "Menu": ["Pasta", "Pizza"],
  "Ambiance": ["Casual"]
}
```

---

### Example 3: Synced Restaurant with Server ID

**Scenario:** Restaurant synced to server, has serverId.

```json
{
  "metadata": [
    {
      "type": "restaurant",
      "id": 123,
      "serverId": 456,
      "created": {
        "timestamp": "2025-10-15T10:30:00.000Z",
        "curator": {
          "id": 5,
          "name": "John Smith"
        }
      },
      "sync": {
        "status": "synced",
        "lastSyncedAt": "2025-10-17T15:00:00.000Z"
      }
    },
    {
      "type": "collector",
      "source": "local",
      "data": {
        "name": "Restaurant Name",
        "description": "Great place!"
      }
    }
  ],
  "Cuisine": ["Italian"]
}
```

**Note:** Restaurant metadata included because serverId exists and sync information is relevant.

---

### Example 4: Complete Restaurant with All Sources

**Scenario:** Restaurant has everything - curator data, Michelin import, Google Places import.

```json
{
  "metadata": [
    {
      "type": "restaurant",
      "id": 123,
      "serverId": 456,
      "created": {
        "timestamp": "2025-10-15T10:30:00.000Z",
        "curator": {
          "id": 5,
          "name": "John Smith"
        }
      },
      "modified": {
        "timestamp": "2025-10-17T14:45:00.000Z"
      },
      "sync": {
        "status": "synced",
        "lastSyncedAt": "2025-10-17T15:00:00.000Z"
      }
    },
    {
      "type": "collector",
      "source": "local",
      "data": {
        "name": "Osteria Francescana",
        "description": "Incredible three-star experience...",
        "transcription": "Audio transcription...",
        "location": {
          "latitude": 44.6467,
          "longitude": 10.9252,
          "address": "Via Stella, 22, 41121 Modena MO, Italy"
        },
        "photos": [
          {
            "id": 1,
            "photoData": "data:image/jpeg;base64,...",
            "timestamp": "2025-10-15T13:30:00.000Z"
          }
        ]
      }
    },
    {
      "type": "michelin",
      "source": "michelin-api",
      "importedAt": "2025-10-16T09:00:00.000Z",
      "data": {
        "michelinId": "osteria-francescana-modena",
        "rating": {
          "stars": 3,
          "distinction": "Three MICHELIN Stars",
          "year": 2025
        },
        "guide": {
          "country": "Italy",
          "region": "Emilia-Romagna",
          "city": "Modena"
        },
        "awards": [
          "Three MICHELIN Stars 2025",
          "Best Restaurant in the World 2016"
        ],
        "pricing": {
          "range": "€€€€",
          "averagePrice": 270
        },
        "michelinDescription": "Massimo Bottura's famous restaurant...",
        "websiteUrl": "https://www.osteriafrancescana.it"
      }
    },
    {
      "type": "google-places",
      "source": "google-places-api",
      "importedAt": "2025-10-17T08:30:00.000Z",
      "data": {
        "placeId": "ChIJpQKS3vC1f0cRDTy8wF0NxdI",
        "rating": {
          "average": 4.6,
          "totalRatings": 2847,
          "priceLevel": 4
        },
        "businessStatus": "OPERATIONAL",
        "contact": {
          "phoneNumber": "+39 059 210118",
          "website": "https://www.osteriafrancescana.it"
        },
        "hours": {
          "weekdayText": [
            "Monday: Closed",
            "Tuesday: Closed",
            "Wednesday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
            "Thursday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
            "Friday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
            "Saturday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
            "Sunday: Closed"
          ]
        }
      }
    }
  ],
  "Cuisine": ["Italian", "Contemporary"],
  "Menu": ["Pasta", "Tortellini", "Tasting Menu"],
  "Ambiance": ["Fine Dining", "Elegant"],
  "Price": ["Very Expensive"],
  "Features": ["Reservations Required", "Extensive Wine List"],
  "Special Features": ["Chef's Table", "Wine Pairing", "Three Michelin Stars"]
}
```

---

## Metadata Array Structure Breakdown

### Decision Tree: What to Include?

```
For each restaurant:
├─ metadata array (always present, but may have only 1 item)
│  │
│  ├─ Restaurant metadata object? 
│  │  → Include ONLY IF: serverId exists OR deletedLocally=true OR modified timestamp differs from created
│  │  → Skip IF: purely local, never synced, never modified
│  │
│  ├─ Collector data object? (usually always present)
│  │  ├─ name (required - always present)
│  │  ├─ description? → Include only if not empty
│  │  ├─ transcription? → Include only if not empty
│  │  ├─ location? → Include only if latitude/longitude exist
│  │  └─ photos? → Include only if array has items
│  │
│  ├─ Michelin object?
│  │  → Include ONLY IF: Restaurant was imported from Michelin
│  │
│  └─ Google Places object?
│     → Include ONLY IF: Restaurant was imported from Google Places
│
└─ Curator categories (at root)
   ├─ Cuisine? → Include only if array has items
   ├─ Menu? → Include only if array has items
   ├─ Ambiance? → Include only if array has items
   ├─ Price? → Include only if array has items
   ├─ Features? → Include only if array has items
   └─ Special Features? → Include only if array has items
```

---

### 1. Restaurant Metadata (Conditional)

**Include ONLY when:**
- Restaurant has `serverId` (synced to server)
- Restaurant is soft-deleted (`deletedLocally: true`)
- Restaurant was modified after creation
- Export needs audit trail

**Skip when:**
- Purely local restaurant
- Never synced
- Never modified
- Basic export for curator review

```json
{
  "type": "restaurant",
  "id": 123,
  "serverId": 456,
  "created": {
    "timestamp": "2025-10-15T10:30:00.000Z",
    "curator": {
      "id": 5,
      "name": "John Smith"
    }
  },
  "modified": {
    "timestamp": "2025-10-17T14:45:00.000Z"
  },
  "sync": {
    "status": "synced",
    "lastSyncedAt": "2025-10-17T15:00:00.000Z"
  }
}
```

**Omit fields:**
- `modified` → if never modified
- `deletedLocally` → if false (default)
- `deletedAt` → if null

---

### 2. Collector Internal Data (Usually Always Present)

**Name is required** - all other fields conditional:

```json
{
  "type": "collector",
  "source": "local",
  "data": {
    "name": "Restaurant Name"
    // Only include fields below if they have data
  }
}
```

**Optional fields** (include only if exist):
- `description` → if curator wrote description
- `transcription` → if audio was recorded
- `location` → if latitude/longitude set
- `photos` → if photos uploaded

---

### 3. Michelin Data (Only If Imported)

**Include entire object ONLY IF** restaurant was imported from Michelin.

```json
{
  "type": "michelin",
  "source": "michelin-api",
  "importedAt": "2025-10-16T09:00:00.000Z",
  "data": {
    "michelinId": "restaurant-abc-123",
    "rating": {
      "stars": 2,
      "distinction": "Two MICHELIN Stars",
      "year": 2025
    }
    // ... rest of Michelin data
  }
}
```

**Omit entire object** if restaurant never imported from Michelin.

---

### 4. Google Places Data (Only If Imported)

**Include entire object ONLY IF** restaurant was imported from Google Places.

```json
{
  "type": "google-places",
  "source": "google-places-api",
  "importedAt": "2025-10-17T08:30:00.000Z",
  "data": {
    "placeId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
    "rating": {
      "average": 4.5,
      "totalRatings": 1234
    }
    // ... rest of Google Places data
  }
}
```

**Omit entire object** if restaurant never imported from Google Places.

---

## Curator Categories (Root Level)

All curator-selected concepts remain at the root level, organized by category:

```json
{
  "Cuisine": ["Italian", "Mediterranean"],
  "Menu": ["Pasta", "Seafood"],
  "Ambiance": ["Fine Dining", "Romantic"],
  "Price": ["Expensive"],
  "Features": ["Reservations Required", "Wine List"],
  "Special Features": ["Chef's Table", "Wine Pairing"]
}
```

**Available Categories:**
- `Cuisine` - Type of food/cooking style
- `Menu` - Specific dishes or ingredients
- `Ambiance` - Atmosphere and setting
- `Price` - Price range
- `Features` - Special features or services
- `Special Features` - Unique offerings
- *(Additional categories can be added by curators)*

---

## Complete Export Example

### Full Restaurant Export with All Sources

```json
{
  "restaurants": [
    {
      "metadata": [
        {
          "type": "restaurant",
          "id": 123,
          "serverId": 456,
          "created": {
            "timestamp": "2025-10-15T10:30:00.000Z",
            "curator": {
              "id": 5,
              "name": "John Smith"
            }
          },
          "modified": {
            "timestamp": "2025-10-17T14:45:00.000Z",
            "curator": {
              "id": 5,
              "name": "John Smith"
            }
          },
          "sync": {
            "status": "synced",
            "lastSyncedAt": "2025-10-17T15:00:00.000Z",
            "deletedLocally": false,
            "deletedAt": null
          },
          "system": {
            "exportedAt": "2025-10-17T16:00:00.000Z",
            "exportFormat": "concierge-v2",
            "schemaVersion": "2.0"
          }
        },
        {
          "type": "collector",
          "source": "local",
          "origin": "local",
          "data": {
            "name": "Osteria Francescana",
            "description": "Incredible three-star experience. Chef Massimo Bottura's creativity shines in every dish. The tortellini walk in brodo was a revelation - traditional yet completely reimagined.",
            "transcription": "Audio transcription: Just finished an amazing meal at Osteria Francescana. The tortellini was the highlight, but honestly every course was perfect. The service was impeccable without being stuffy. Would definitely recommend making a reservation well in advance.",
            "location": {
              "latitude": 44.6467,
              "longitude": 10.9252,
              "address": "Via Stella, 22, 41121 Modena MO, Italy",
              "enteredBy": "curator"
            },
            "photos": [
              {
                "id": 1,
                "restaurantId": 123,
                "photoData": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
                "capturedBy": "curator",
                "timestamp": "2025-10-15T13:30:00.000Z"
              }
            ],
            "notes": {
              "private": "Ask for the wine pairing - sommelier Marco is excellent",
              "public": "Book at least 3 months in advance. Dress code is smart casual."
            }
          }
        },
        {
          "type": "michelin",
          "source": "michelin-api",
          "importedAt": "2025-10-16T09:00:00.000Z",
          "data": {
            "michelinId": "osteria-francescana-modena",
            "rating": {
              "stars": 3,
              "distinction": "Three MICHELIN Stars",
              "year": 2025
            },
            "guide": {
              "country": "Italy",
              "region": "Emilia-Romagna",
              "city": "Modena"
            },
            "awards": [
              "Three MICHELIN Stars 2025",
              "Three MICHELIN Stars 2024",
              "Three MICHELIN Stars 2023",
              "Best Restaurant in the World 2016"
            ],
            "pricing": {
              "range": "€€€€",
              "averagePrice": 270
            },
            "michelinDescription": "Massimo Bottura's famous restaurant needs no introduction: as a symbol of Italian regional cuisine reinterpreted with a modern twist, his reputation extends far beyond the country's borders. Booking well in advance is essential.",
            "websiteUrl": "https://www.osteriafrancescana.it",
            "reservationUrl": "https://osteriafrancescana.sevenrooms.com",
            "michelinUrl": "https://guide.michelin.com/en/emilia-romagna/modena/restaurant/osteria-francescana"
          }
        },
        {
          "type": "google-places",
          "source": "google-places-api",
          "importedAt": "2025-10-17T08:30:00.000Z",
          "data": {
            "placeId": "ChIJpQKS3vC1f0cRDTy8wF0NxdI",
            "rating": {
              "average": 4.6,
              "totalRatings": 2847,
              "priceLevel": 4
            },
            "businessStatus": "OPERATIONAL",
            "location": {
              "latitude": 44.6467,
              "longitude": 10.9252,
              "formattedAddress": "Via Stella, 22, 41121 Modena MO, Italy",
              "vicinity": "Via Stella, 22, Modena"
            },
            "contact": {
              "phoneNumber": "+39 059 210118",
              "internationalPhone": "+39 059 210118",
              "website": "https://www.osteriafrancescana.it"
            },
            "hours": {
              "openNow": false,
              "weekdayText": [
                "Monday: Closed",
                "Tuesday: Closed",
                "Wednesday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
                "Thursday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
                "Friday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
                "Saturday: 12:30 – 2:00 PM, 7:30 – 10:00 PM",
                "Sunday: Closed"
              ]
            },
            "photos": [
              {
                "reference": "CmRaAAAAcGgT...",
                "width": 4032,
                "height": 3024,
                "attributions": ["Photo by Osteria Francescana"]
              }
            ],
            "types": ["restaurant", "food", "point_of_interest", "establishment"],
            "reviews": [
              {
                "author": "Maria Rossi",
                "rating": 5,
                "text": "Absolutely incredible experience. Every dish was a work of art. Worth every penny.",
                "time": 1697558400,
                "relativeTime": "2 months ago"
              }
            ]
          }
        }
      ],
      "Cuisine": [
        "Italian",
        "Contemporary",
        "Creative"
      ],
      "Menu": [
        "Pasta",
        "Tortellini",
        "Tasting Menu",
        "Decadent desserts"
      ],
      "Ambiance": [
        "Fine Dining",
        "Elegant",
        "Intimate"
      ],
      "Price": [
        "Very Expensive"
      ],
      "Features": [
        "Reservations Required",
        "Extensive Wine List",
        "Dress Code"
      ],
      "Special Features": [
        "Chef's Table",
        "Wine Pairing",
        "Tasting Menu Only",
        "Three Michelin Stars"
      ]
    }
  ]
}
```

---

## Benefits of This Structure

### 1. Clear Separation
✅ **Curator content at root level** - Easy to see what the curator selected
✅ **All metadata nested** - System data doesn't clutter the main view
✅ **Source-specific data isolated** - Easy to identify data origin

### 2. Source Traceability
✅ **Each source has its own section** - Michelin, Google Places, Collector
✅ **Import timestamps tracked** - Know when data was imported
✅ **Original source preserved** - Can verify against source APIs

### 3. Data Integrity
✅ **No data mixing** - Collector data separate from imported data
✅ **Complete provenance** - Full audit trail for each data source
✅ **Easy conflict resolution** - Can compare same field across sources

### 4. Flexibility
✅ **Optional sections** - Only include sources that exist
✅ **Extensible structure** - Easy to add new sources (Yelp, TripAdvisor, etc.)
✅ **Future-proof** - Array structure allows multiple entries per source

### 5. Query Efficiency
✅ **Fast category access** - Categories at root level for quick filtering
✅ **Metadata grouped** - All non-curator data in one place
✅ **Type-based filtering** - Easy to filter by metadata type

---

## Field Mapping from Current Database

### Current Database Schema
```javascript
restaurants: {
  id: 123,
  name: "Restaurant Name",
  curatorId: 5,
  timestamp: "2025-10-17T10:30:00Z",
  transcription: "Audio...",
  description: "Description...",
  origin: "local",
  source: "local",
  serverId: null,
  deletedLocally: false,
  deletedAt: null
}
```

### Maps To New Structure

**Restaurant Metadata Section:**
- `id` → `metadata[0].id`
- `serverId` → `metadata[0].serverId`
- `timestamp` → `metadata[0].created.timestamp`
- `curatorId` → `metadata[0].created.curator.id`
- `deletedLocally` → `metadata[0].sync.deletedLocally`
- `deletedAt` → `metadata[0].sync.deletedAt`

**Collector Data Section:**
- `name` → `metadata[1].data.name`
- `description` → `metadata[1].data.description`
- `transcription` → `metadata[1].data.transcription`
- `source` → `metadata[1].source`
- `origin` → `metadata[1].origin`

**Location Data:**
- `restaurantLocations` → `metadata[1].data.location`

**Photos:**
- `restaurantPhotos` → `metadata[1].data.photos`

**Concepts:**
- `restaurantConcepts` → Root level categories (Cuisine, Menu, etc.)

---

## Implementation Considerations

### Export Function Structure (With Conditional Inclusion)
```javascript
async function exportDataV2() {
    const restaurants = await db.restaurants.toArray();
    
    const exportRestaurants = await Promise.all(
        restaurants.map(async restaurant => {
            const curator = await db.curators.get(restaurant.curatorId);
            const location = await db.restaurantLocations
                .where('restaurantId').equals(restaurant.id).first();
            const photos = await db.restaurantPhotos
                .where('restaurantId').equals(restaurant.id).toArray();
            const concepts = await getRestaurantConcepts(restaurant.id);
            
            // Build metadata array
            const metadata = [];
            
            // 1. Restaurant metadata (CONDITIONAL - only if needed)
            const hasServerId = restaurant.serverId != null;
            const isDeleted = restaurant.deletedLocally === true;
            const wasModified = restaurant.modifiedAt && restaurant.modifiedAt !== restaurant.timestamp;
            
            if (hasServerId || isDeleted || wasModified) {
                const restaurantMeta = {
                    type: 'restaurant',
                    id: restaurant.id
                };
                
                if (hasServerId) {
                    restaurantMeta.serverId = restaurant.serverId;
                }
                
                restaurantMeta.created = {
                    timestamp: restaurant.timestamp,
                    curator: {
                        id: restaurant.curatorId,
                        name: curator?.name || 'Unknown'
                    }
                };
                
                if (wasModified) {
                    restaurantMeta.modified = {
                        timestamp: restaurant.modifiedAt
                    };
                }
                
                const syncData = {};
                if (hasServerId) {
                    syncData.status = 'synced';
                    if (restaurant.lastSyncedAt) {
                        syncData.lastSyncedAt = restaurant.lastSyncedAt;
                    }
                }
                if (isDeleted) {
                    syncData.deletedLocally = true;
                    if (restaurant.deletedAt) {
                        syncData.deletedAt = restaurant.deletedAt;
                    }
                }
                
                if (Object.keys(syncData).length > 0) {
                    restaurantMeta.sync = syncData;
                }
                
                metadata.push(restaurantMeta);
            }
            
            // 2. Collector data (ALWAYS present, but fields are conditional)
            const collectorData = {
                type: 'collector',
                source: restaurant.source || 'local',
                data: {
                    name: restaurant.name // Required
                }
            };
            
            // Only add optional fields if they have data
            if (restaurant.description) {
                collectorData.data.description = restaurant.description;
            }
            
            if (restaurant.transcription) {
                collectorData.data.transcription = restaurant.transcription;
            }
            
            if (location && location.latitude != null && location.longitude != null) {
                collectorData.data.location = {
                    latitude: location.latitude,
                    longitude: location.longitude
                };
                if (location.address) {
                    collectorData.data.location.address = location.address;
                }
            }
            
            if (photos && photos.length > 0) {
                collectorData.data.photos = photos.map(p => {
                    const photo = {
                        id: p.id,
                        photoData: p.photoData
                    };
                    if (p.timestamp) {
                        photo.timestamp = p.timestamp;
                    }
                    return photo;
                });
            }
            
            metadata.push(collectorData);
            
            // 3. Michelin data (ONLY if imported from Michelin)
            // TODO: Check if restaurant.michelinData exists
            // if (restaurant.michelinData) {
            //     metadata.push({
            //         type: 'michelin',
            //         source: 'michelin-api',
            //         importedAt: restaurant.michelinImportedAt,
            //         data: restaurant.michelinData
            //     });
            // }
            
            // 4. Google Places data (ONLY if imported from Google)
            // TODO: Check if restaurant.googlePlacesData exists
            // if (restaurant.googlePlacesData) {
            //     metadata.push({
            //         type: 'google-places',
            //         source: 'google-places-api',
            //         importedAt: restaurant.googlePlacesImportedAt,
            //         data: restaurant.googlePlacesData
            //     });
            // }
            
            // Build curator categories at root level (ONLY categories with values)
            const categorizedConcepts = {};
            concepts.forEach(concept => {
                if (concept.category && concept.value) {
                    if (!categorizedConcepts[concept.category]) {
                        categorizedConcepts[concept.category] = [];
                    }
                    categorizedConcepts[concept.category].push(concept.value);
                }
            });
            
            // Build final restaurant object
            const restaurantExport = {
                metadata,
                ...categorizedConcepts
            };
            
            return restaurantExport;
        })
    );
    
    return { restaurants: exportRestaurants };
}
```

**Key Changes:**
1. ✅ Restaurant metadata only added if `serverId`, `deletedLocally`, or `modifiedAt` exist
2. ✅ Each field within objects checked before inclusion
3. ✅ Photos array only added if photos exist
4. ✅ Location only added if latitude/longitude exist
5. ✅ Description/transcription only added if not empty
6. ✅ Curator categories only added if they have values
7. ✅ Clean, minimal JSON output

---

## Migration Path

### Phase 1: Update Export
1. Modify `dataStorage.exportData()` to use new structure
2. Keep old export format available as option
3. Test with sample data

### Phase 2: Update Import
1. Modify `dataStorage.importData()` to handle new structure
2. Maintain backward compatibility with old format
3. Add format detection

### Phase 3: Extend for External Sources
1. Add Michelin data storage to database
2. Add Google Places data storage to database
3. Update export to include these sources

---

## Example Use Cases

### Use Case 1: Export for Curator Review
**Need:** Curator wants to see only their content, no system data

**Solution:** Filter to show only root-level categories:
```javascript
{
  "Cuisine": ["Italian"],
  "Menu": ["Pasta"],
  "Ambiance": ["Fine Dining"]
}
```

### Use Case 2: Export for Sync
**Need:** Server needs all data including system metadata

**Solution:** Include full metadata array with restaurant metadata section

### Use Case 3: Export with Source Attribution
**Need:** Show where data came from (Michelin vs Google vs Curator)

**Solution:** Metadata array has type field for each source:
```javascript
metadata[1].type === "collector"
metadata[2].type === "michelin"
metadata[3].type === "google-places"
```

### Use Case 4: Merge Imported Data
**Need:** Restaurant exists locally, import additional Michelin data

**Solution:** Add new metadata array entry:
```javascript
metadata.push({
  type: "michelin",
  source: "michelin-api",
  importedAt: new Date().toISOString(),
  data: { /* Michelin data */ }
});
```

---

## Questions & Answers

**Q: What if a restaurant has no Michelin or Google data?**
A: Those sections simply won't appear in the metadata array. Only include what exists.

**Q: Can we have multiple entries of the same type?**
A: Yes! The array structure allows multiple entries. For example, if you import from Google Places twice, you could have two entries with different timestamps.

**Q: How do we handle conflicts (e.g., different addresses)?**
A: Each source maintains its own data. The Collector section has the curator's address, Google Places has its address, etc. The UI can show all versions and let the curator choose.

**Q: What about fields that exist in multiple sources?**
A: Keep them separate:
- Collector: curator's name/description
- Michelin: official Michelin description  
- Google Places: user reviews and ratings

**Q: Are categories always at root level?**
A: Yes! All curator-selected concepts (Cuisine, Menu, etc.) stay at the root level for easy access.

---

## Final Recommendation

**Use this structure** because it:
1. ✅ **Keeps curator categories accessible at root level**
2. ✅ **Groups all metadata in a clear array**
3. ✅ **Separates data by source** (Michelin, Google, Collector)
4. ✅ **Only includes objects with actual data** (no empty placeholders)
5. ✅ **Minimal JSON output** (no null fields, no empty arrays)
6. ✅ **Provides complete provenance and audit trail** when needed
7. ✅ **Supports future sources** (Yelp, TripAdvisor, etc.)
8. ✅ **Enables flexible queries and filtering**
9. ✅ **Maintains data integrity and traceability**
10. ✅ **Efficient storage** (smaller file sizes)

### Core Design Principle

> **"Only export what exists, nothing more."**

- No mandatory fields (except restaurant name in collector data)
- No null values
- No empty arrays
- No empty objects
- Clean, minimal, readable JSON

This structure is **semantic, extensible, efficient, and production-ready**.
