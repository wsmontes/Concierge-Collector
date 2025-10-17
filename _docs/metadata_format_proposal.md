# Metadata Object Format Proposal for Restaurant Export

## Overview
This document proposes a metadata structure to separate curator-generated content from system/non-curator data in restaurant exports.

## Current Restaurant Structure

### What Exists in Collector
```javascript
{
  // Restaurant table fields
  id: 123,
  name: "Restaurant Name",
  curatorId: 5,
  timestamp: "2025-10-17T10:30:00Z",
  transcription: "Audio transcription text...",
  description: "Curator's description",
  origin: "local",
  source: "local",
  serverId: null,
  deletedLocally: false,
  deletedAt: null,
  
  // Related data (joined)
  concepts: [...],           // Array of concept objects
  location: {...},          // Location object
  photos: [...]             // Array of photo objects
}
```

---

## Proposed Metadata Format

### Option A: Comprehensive Metadata (Recommended)

```json
{
  "metadata": {
    "id": 123,
    "localId": 123,
    "serverId": null,
    "version": "1.0",
    "source": "local",
    "origin": "local",
    "created": {
      "timestamp": "2025-10-17T10:30:00.000Z",
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
      "appVersion": "2.0.0",
      "exportedAt": "2025-10-17T16:00:00.000Z",
      "exportFormat": "concierge-v1",
      "platform": "web"
    }
  },
  "name": "Restaurant Name",
  "description": "Curator's description",
  "transcription": "Audio transcription text...",
  "location": {
    "latitude": 40.758896,
    "longitude": -73.985130,
    "address": "123 Main St, New York, NY"
  },
  "concepts": [
    {
      "category": "Cuisine",
      "value": "Italian"
    }
  ],
  "photos": [
    {
      "id": 1,
      "restaurantId": 123,
      "photoData": "data:image/jpeg;base64,..."
    }
  ]
}
```

### Option B: Minimal Metadata (Lightweight)

```json
{
  "metadata": {
    "id": 123,
    "serverId": null,
    "source": "local",
    "createdAt": "2025-10-17T10:30:00.000Z",
    "curatorId": 5,
    "syncStatus": "synced"
  },
  "name": "Restaurant Name",
  "description": "Curator's description",
  "transcription": "Audio transcription text...",
  "location": {...},
  "concepts": [...],
  "photos": [...]
}
```

### Option C: Extended Metadata (Maximum Detail)

```json
{
  "metadata": {
    "identifiers": {
      "localId": 123,
      "serverId": null,
      "externalIds": []
    },
    "provenance": {
      "source": "local",
      "origin": "local",
      "importedFrom": null
    },
    "timestamps": {
      "created": "2025-10-17T10:30:00.000Z",
      "modified": "2025-10-17T14:45:00.000Z",
      "lastSynced": "2025-10-17T15:00:00.000Z",
      "exported": "2025-10-17T16:00:00.000Z"
    },
    "curator": {
      "id": 5,
      "name": "John Smith",
      "role": "contributor"
    },
    "sync": {
      "status": "synced",
      "conflicts": [],
      "deletedLocally": false,
      "deletedAt": null
    },
    "system": {
      "appVersion": "2.0.0",
      "schemaVersion": "1.0",
      "exportFormat": "concierge-v1",
      "platform": "web",
      "userAgent": "Mozilla/5.0..."
    },
    "validation": {
      "isComplete": true,
      "missingFields": [],
      "warnings": []
    }
  },
  "name": "Restaurant Name",
  "description": "Curator's description",
  "transcription": "Audio transcription text...",
  "location": {...},
  "concepts": [...],
  "photos": [...]
}
```

---

## Metadata Field Definitions

### Core Identifiers
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `id` | integer | Primary identifier | `123` |
| `localId` | integer | Local database ID | `123` |
| `serverId` | integer/null | Server-assigned ID | `456` or `null` |

### Provenance
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `source` | string | Data source | `"local"`, `"remote"` |
| `origin` | string | Original entry point | `"local"`, `"import"`, `"sync"` |

### Timestamps (ISO 8601)
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `timestamp` | string | Creation time | `"2025-10-17T10:30:00.000Z"` |
| `createdAt` | string | Alias for timestamp | Same as above |
| `modifiedAt` | string | Last modification | `"2025-10-17T14:45:00.000Z"` |
| `lastSyncedAt` | string | Last sync time | `"2025-10-17T15:00:00.000Z"` |
| `exportedAt` | string | Export timestamp | `"2025-10-17T16:00:00.000Z"` |

### Curator Information
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `curatorId` | integer | Curator's ID | `5` |
| `curatorName` | string | Curator's name | `"John Smith"` |

### Sync Status
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `syncStatus` | string | Current sync state | `"synced"`, `"pending"`, `"local"` |
| `deletedLocally` | boolean | Soft delete flag | `false` |
| `deletedAt` | string/null | Deletion timestamp | `null` |

### System Information
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `appVersion` | string | Collector version | `"2.0.0"` |
| `schemaVersion` | string | Data format version | `"1.0"` |
| `exportFormat` | string | Export format type | `"concierge-v1"` |
| `platform` | string | Platform type | `"web"`, `"mobile"` |

---

## Recommendation: Option A (Comprehensive Metadata)

### Why This Format?

**1. Clear Separation**
- Metadata vs Content clearly distinguished
- Non-curator data isolated in metadata block
- Easy to filter or strip metadata for curator-only views

**2. Human-Readable**
- Nested structure is intuitive
- Field names are self-explanatory
- Easy to understand at a glance

**3. Extensible**
- Can add new metadata fields without breaking existing structure
- Nested objects allow grouping related fields
- Version field enables format evolution

**4. Audit Trail**
- Created/Modified timestamps with curator info
- Sync history preserved
- Full provenance tracking

**5. Optimal Balance**
- Not too minimal (missing important data)
- Not too verbose (still readable)
- Contains all system/tracking data

---

## Implementation Example

### Current Export Format
```json
{
  "restaurants": [
    {
      "id": 123,
      "name": "Restaurant Name",
      "curatorId": 5,
      "timestamp": "2025-10-17T10:30:00Z",
      "source": "local",
      "serverId": null,
      "description": "Description...",
      "transcription": "Transcription..."
    }
  ]
}
```

### Proposed Export Format
```json
{
  "restaurants": [
    {
      "metadata": {
        "id": 123,
        "serverId": null,
        "source": "local",
        "created": {
          "timestamp": "2025-10-17T10:30:00.000Z",
          "curator": {
            "id": 5,
            "name": "John Smith"
          }
        },
        "sync": {
          "status": "synced",
          "deletedLocally": false
        },
        "system": {
          "exportedAt": "2025-10-17T16:00:00.000Z",
          "exportFormat": "concierge-v1"
        }
      },
      "name": "Restaurant Name",
      "description": "Description...",
      "transcription": "Transcription...",
      "location": {...},
      "concepts": [...],
      "photos": [...]
    }
  ]
}
```

---

## Benefits

### For Curators
- ✅ Clean separation of their content from system data
- ✅ Easy to see what they actually wrote
- ✅ Metadata doesn't clutter the main content

### For Developers
- ✅ Easy to parse and validate
- ✅ Clear versioning for format changes
- ✅ Complete audit trail for debugging
- ✅ Sync status tracking

### For Import/Export
- ✅ Can strip metadata for curator-only exports
- ✅ Can preserve metadata for full system exports
- ✅ Format version allows backward compatibility
- ✅ Easy to merge/update existing records

### For APIs
- ✅ RESTful pattern (metadata in headers concept)
- ✅ Consistent structure across all records
- ✅ Easy to filter by metadata fields
- ✅ Standard format for timestamps

---

## Migration Strategy

### Phase 1: Add Metadata to Export
1. Update `dataStorage.exportData()` to include metadata
2. Keep existing structure for backward compatibility
3. Add `metadata` as first property in each restaurant

### Phase 2: Update Import
1. Modify `dataStorage.importData()` to handle metadata
2. Extract metadata fields when importing
3. Preserve backward compatibility with old format

### Phase 3: Update Server Sync
1. Include metadata in server communication
2. Use metadata for conflict resolution
3. Track sync history via metadata

---

## Example Code Structure

### Export Function (Pseudocode)
```javascript
async exportData() {
    const restaurants = await this.db.restaurants.toArray();
    
    const exportRestaurants = await Promise.all(
        restaurants.map(async restaurant => {
            const curator = await this.db.curators.get(restaurant.curatorId);
            
            return {
                metadata: {
                    id: restaurant.id,
                    serverId: restaurant.serverId,
                    source: restaurant.source,
                    created: {
                        timestamp: restaurant.timestamp,
                        curator: {
                            id: restaurant.curatorId,
                            name: curator?.name || 'Unknown'
                        }
                    },
                    sync: {
                        status: restaurant.serverId ? 'synced' : 'local',
                        deletedLocally: restaurant.deletedLocally,
                        deletedAt: restaurant.deletedAt
                    },
                    system: {
                        exportedAt: new Date().toISOString(),
                        exportFormat: 'concierge-v1'
                    }
                },
                name: restaurant.name,
                description: restaurant.description,
                transcription: restaurant.transcription,
                location: await this.getLocation(restaurant.id),
                concepts: await this.getConcepts(restaurant.id),
                photos: await this.getPhotos(restaurant.id)
            };
        })
    );
    
    return { restaurants: exportRestaurants };
}
```

---

## Questions to Consider

1. **Should metadata be an array or object?**
   - **Recommendation:** Object (easier to parse, more intuitive)

2. **What if curator info changes after creation?**
   - Store curator info at time of creation in metadata
   - Don't update metadata on curator rename

3. **How to handle imported data without metadata?**
   - Generate metadata on import
   - Mark as `origin: "import"` with import timestamp

4. **Should photos be in metadata?**
   - **No** - Photos are curator-generated content
   - Only store photo metadata (size, format) in system metadata

5. **Version strategy?**
   - Use semantic versioning: `"1.0.0"`
   - Increment on breaking changes
   - Include in metadata for compatibility checks

---

## Final Recommendation

**Use Option A (Comprehensive Metadata)** with these specific fields:

```json
{
  "metadata": {
    "id": <integer>,
    "serverId": <integer|null>,
    "source": <string>,
    "created": {
      "timestamp": <ISO8601>,
      "curator": {
        "id": <integer>,
        "name": <string>
      }
    },
    "sync": {
      "status": <string>,
      "deletedLocally": <boolean>,
      "deletedAt": <ISO8601|null>
    },
    "system": {
      "exportedAt": <ISO8601>,
      "exportFormat": "concierge-v1"
    }
  },
  "name": <string>,
  "description": <string>,
  "transcription": <string>,
  "location": <object|null>,
  "concepts": <array>,
  "photos": <array>
}
```

This format provides the best balance of completeness, readability, and extensibility while clearly separating curator content from system metadata.
