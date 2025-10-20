# Complete API Integration Guide for Concierge Collector

**Last Updated:** October 20, 2025  
**API Version:** 1.1.2  
**Base URL:** `https://wsmontes.pythonanywhere.com/api`

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Available Endpoints](#available-endpoints)
4. [Primary Sync Endpoints](#primary-sync-endpoints)
5. [Data Formats](#data-formats)
6. [Current Implementation Status](#current-implementation-status)
7. [Migration Recommendations](#migration-recommendations)

---

## Overview

The Concierge Collector application currently uses **`/api/restaurants/batch`** for synchronization. However, the server offers **three different sync approaches**, each with specific use cases and data formats.

### Server Health
- **Health Check:** `GET /api/health`
- **Server Status:** `GET /status`

---

## Authentication

Currently, the API **does not require authentication**. All endpoints accept requests from any origin (CORS enabled).

**IMPORTANT:** This may change in future versions. Plan for adding Bearer token authentication.

---

## Available Endpoints

### 1. Health & Status

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Database connectivity check |
| `/status` | GET | Server version and timestamp |
| `/ping` | GET | Simple uptime check (returns "pong") |

**Example Response (`/api/health`):**
```json
{
  "status": "healthy",
  "database": "connected",
  "timestamp": "2025-10-20T10:30:00.000Z"
}
```

---

## Primary Sync Endpoints

### 🔴 Option 1: `/api/restaurants/batch` (Current Implementation)

**Purpose:** Legacy batch upload with flat structure  
**Current Usage:** ✅ Used by Concierge Collector  
**Database Target:** `restaurants`, `concepts`, `restaurant_concepts` tables

#### Request Format
```http
POST /api/restaurants/batch
Content-Type: application/json
```

```json
[
  {
    "id": 123,
    "name": "Restaurant Name",
    "description": "Brief description",
    "transcription": "Full audio transcription",
    "timestamp": "2025-10-20T10:00:00.000Z",
    "server_id": null,
    "curator": {
      "name": "Curator Name"
    },
    "concepts": [
      {
        "category": "Cuisine",
        "value": "Italian"
      },
      {
        "category": "Price Range",
        "value": "$$$$"
      }
    ]
  }
]
```

#### Response Format
```json
{
  "status": "success",
  "summary": {
    "total": 1,
    "successful": 1,
    "failed": 0
  },
  "restaurants": [
    {
      "localId": 123,
      "serverId": 456,
      "name": "Restaurant Name",
      "status": "success"
    }
  ]
}
```

#### Partial Success (Status 207)
If some restaurants fail, the response includes both successful and failed items:

```json
{
  "status": "partial",
  "summary": {
    "total": 3,
    "successful": 2,
    "failed": 1
  },
  "restaurants": [
    {
      "localId": 1,
      "serverId": 100,
      "name": "Success Restaurant",
      "status": "success"
    },
    {
      "localId": 2,
      "name": "Failed Restaurant",
      "status": "error",
      "message": "Missing restaurant name"
    }
  ]
}
```

#### Current Implementation Issues

1. **Missing Fields:** The current format doesn't include:
   - Location data (latitude, longitude, address)
   - Michelin data (stars, distinction, URL)
   - Google Places data (placeId, ratings)
   - Notes (private/public)
   - Photos

2. **Concept Categories:** Uses flat category strings, requires pre-existing categories in DB

3. **No Sync Metadata:** Doesn't track sync status, last sync time, or deleted status

---

### 🟢 Option 2: `/api/curation/json` (Recommended)

**Purpose:** Modern JSON storage with full metadata  
**Current Usage:** ❌ Not implemented in Concierge Collector  
**Database Target:** `restaurants_json` table (JSONB storage)

#### Advantages
- ✅ Stores complete restaurant document as JSON
- ✅ No schema migrations needed for new fields
- ✅ Preserves all metadata exactly as sent
- ✅ Supports composite key (name + city + curator_id)
- ✅ Future-proof and flexible

#### Request Format
```http
POST /api/curation/json
Content-Type: application/json
```

```json
[
  {
    "metadata": [
      {
        "type": "restaurant",
        "id": 123,
        "serverId": null,
        "created": {
          "timestamp": "2025-10-20T10:00:00.000Z",
          "curator": {
            "id": 1,
            "name": "John Doe"
          }
        },
        "modified": {
          "timestamp": "2025-10-20T11:00:00.000Z",
          "curator": {
            "id": 1,
            "name": "John Doe"
          }
        },
        "sync": {
          "status": "synced",
          "lastSyncedAt": "2025-10-20T11:00:00.000Z",
          "deletedLocally": false
        }
      },
      {
        "type": "collector",
        "data": {
          "name": "Osteria Francescana",
          "description": "Three Michelin stars",
          "transcription": "Full audio transcription...",
          "location": {
            "latitude": 44.6468,
            "longitude": 10.9252,
            "address": "Via Stella, 22, Modena, Italy",
            "enteredBy": "manual"
          },
          "notes": {
            "private": "Private curator notes",
            "public": "Public tasting notes"
          },
          "photos": [
            {
              "id": "photo-123",
              "photoData": "data:image/jpeg;base64,...",
              "capturedBy": "John Doe",
              "timestamp": "2025-10-20T10:00:00.000Z"
            }
          ]
        }
      },
      {
        "type": "michelin",
        "data": {
          "michelinId": "massimo-bottura-osteria-francescana",
          "rating": {
            "stars": 3,
            "distinction": "Three MICHELIN Stars"
          },
          "michelinDescription": "Worth a special journey",
          "michelinUrl": "https://guide.michelin.com/...",
          "guide": {
            "city": "Modena",
            "country": "Italy"
          }
        }
      },
      {
        "type": "google-places",
        "data": {
          "placeId": "ChIJ...",
          "location": {
            "latitude": 44.6468,
            "longitude": 10.9252,
            "vicinity": "Via Stella, 22, Modena",
            "formattedAddress": "Via Stella, 22, 41121 Modena MO, Italy"
          },
          "rating": {
            "average": 4.7,
            "totalRatings": 3245,
            "priceLevel": 4
          }
        }
      }
    ],
    "Cuisine": ["Italian", "Contemporary"],
    "Menu": ["Tasting Menu"],
    "Price Range": ["$$$$"],
    "Mood": ["Sophisticated", "Fine Dining"],
    "Setting": ["Indoor", "Intimate"],
    "Crowd": ["Foodies", "Couples"],
    "Suitable For": ["Special Occasion", "Business Dinner"],
    "Food Style": ["Innovative", "Seasonal"],
    "Drinks": ["Wine Pairing", "Cocktails"],
    "Special Features": ["Chef's Table", "Reservations Required"]
  }
]
```

#### Response Format
```json
{
  "status": "success",
  "processed": 1,
  "message": "Successfully processed 1 restaurants"
}
```

#### Composite Key Strategy
The server uses `(restaurant_name, city, curator_id)` to prevent duplicates:

- **restaurant_name:** From `collector.data.name`
- **city:** From `michelin.data.guide.city` (priority 1) or parsed from address
- **curator_id:** From `restaurant.created.curator.id`

---

### 🟡 Option 3: `/api/curation/v2` (Structured V2)

**Purpose:** V2 structured format with relational tables  
**Current Usage:** ❌ Not implemented in Concierge Collector  
**Database Target:** `restaurants_v2` table (relational with expanded columns)

#### Request Format
```http
POST /api/curation/v2
Content-Type: application/json
```

Same as `/api/curation/json` above. The difference is internal storage:
- `/api/curation/json` → Stores as JSONB in `restaurants_json` table
- `/api/curation/v2` → Parses and stores in normalized `restaurants_v2` table

#### Response Format
```json
{
  "status": "success",
  "processed": 1
}
```

---

## Data Formats

### Restaurant Metadata Structure

```typescript
interface RestaurantMetadata {
  type: "restaurant";
  id: number;              // Local client ID
  serverId?: number;       // Server-assigned ID after sync
  created: {
    timestamp: string;     // ISO 8601
    curator: {
      id: number;
      name: string;
    }
  };
  modified?: {
    timestamp: string;
    curator: {
      id: number;
      name: string;
    }
  };
  sync?: {
    status: "pending" | "synced" | "error";
    lastSyncedAt?: string;
    deletedLocally?: boolean;
  };
}
```

### Collector Data Structure

```typescript
interface CollectorData {
  type: "collector";
  data: {
    name: string;           // Required
    description?: string;
    transcription?: string;
    location?: {
      latitude: number;
      longitude: number;
      address?: string;
      enteredBy: "manual" | "gps" | "google-places";
    };
    notes?: {
      private?: string;
      public?: string;
    };
    photos?: Array<{
      id: string;
      photoData: string;    // Base64 encoded
      capturedBy: string;
      timestamp: string;
    }>;
  };
}
```

### Michelin Data Structure

```typescript
interface MichelinData {
  type: "michelin";
  data: {
    michelinId: string;
    rating: {
      stars: 1 | 2 | 3;
      distinction: string;
    };
    michelinDescription?: string;
    michelinUrl?: string;
    guide: {
      city: string;         // Used for composite key
      country: string;
    };
  };
}
```

### Google Places Data Structure

```typescript
interface GooglePlacesData {
  type: "google-places";
  data: {
    placeId: string;
    location: {
      latitude: number;
      longitude: number;
      vicinity?: string;
      formattedAddress?: string;
    };
    rating?: {
      average: number;
      totalRatings: number;
      priceLevel: 1 | 2 | 3 | 4;
    };
  };
}
```

---

## Current Implementation Status

### ✅ What's Working

1. **Basic Sync:** `apiService.batchUploadRestaurants()` successfully uploads to `/api/restaurants/batch`
2. **Response Handling:** Correctly extracts `serverId` from batch response
3. **Error Recovery:** Handles network errors and retries
4. **Curator Tracking:** Associates restaurants with curators

### ❌ What's Missing

1. **Location Data:** Not sent to server (latitude, longitude, address)
2. **Michelin Integration:** No Michelin metadata sent
3. **Google Places:** No Google Places data sent
4. **Photos:** Photo data not uploaded
5. **Notes:** Private/public notes not synced
6. **JSON Format:** Not using the recommended `/api/curation/json` endpoint
7. **Sync Metadata:** No tracking of sync status, timestamps, or deletion flags

---

## Migration Recommendations

### Phase 1: Immediate Fixes (Current Endpoint)

**Keep using `/api/restaurants/batch` but add missing fields:**

```javascript
// In syncManager.js - uploadRestaurantToServer()
const serverData = {
    id: localRestaurant.id,
    name: localRestaurant.name,
    description: localRestaurant.description,
    transcription: localRestaurant.transcription,
    timestamp: localRestaurant.timestamp,
    server_id: localRestaurant.serverId || null,
    
    // ADD THESE:
    latitude: localRestaurant.location?.latitude,
    longitude: localRestaurant.location?.longitude,
    address: localRestaurant.location?.address,
    private_notes: localRestaurant.notes?.private,
    public_notes: localRestaurant.notes?.public,
    
    curator: {
        name: localRestaurant.curatorName || 'Unknown'
    },
    concepts: localRestaurant.concepts || []
};
```

### Phase 2: Migrate to JSON Endpoint (Recommended)

**Switch to `/api/curation/json` for full metadata support:**

1. **Update apiService.js:**

```javascript
// Add new method
async uploadRestaurantJson(restaurant) {
    return this.post('/curation/json', [restaurant]);
}
```

2. **Update syncManager.js:**

```javascript
async uploadRestaurantToServer(localRestaurant) {
    // Build complete metadata structure
    const restaurantJson = {
        metadata: [
            {
                type: "restaurant",
                id: localRestaurant.id,
                serverId: localRestaurant.serverId,
                created: {
                    timestamp: localRestaurant.timestamp,
                    curator: {
                        id: localRestaurant.curatorId || 0,
                        name: localRestaurant.curatorName || 'Unknown'
                    }
                },
                sync: {
                    status: "synced",
                    lastSyncedAt: new Date().toISOString(),
                    deletedLocally: false
                }
            },
            {
                type: "collector",
                data: {
                    name: localRestaurant.name,
                    description: localRestaurant.description,
                    transcription: localRestaurant.transcription,
                    location: localRestaurant.location,
                    notes: localRestaurant.notes,
                    photos: localRestaurant.photos
                }
            }
        ],
        // Add category arrays
        "Cuisine": localRestaurant.concepts
            ?.filter(c => c.category === "Cuisine")
            .map(c => c.value) || [],
        "Price Range": localRestaurant.concepts
            ?.filter(c => c.category === "Price Range")
            .map(c => c.value) || [],
        // ... add other categories
    };
    
    // Upload using JSON endpoint
    const response = await window.apiService.uploadRestaurantJson(restaurantJson);
    
    if (response.success) {
        // Update local restaurant with sync confirmation
        await dataStorage.db.restaurants.update(localRestaurant.id, {
            source: 'remote',
            needsSync: false,
            lastSyncedAt: new Date().toISOString()
        });
    }
    
    return response;
}
```

3. **Benefits:**
   - ✅ Preserves ALL data (location, photos, notes, Michelin, Google Places)
   - ✅ No data loss during sync
   - ✅ Future-proof for new fields
   - ✅ Supports city-based duplicate prevention

### Phase 3: Add Michelin & Google Places Integration

**When restaurant has Michelin or Google Places data:**

```javascript
// Add to metadata array if available
if (localRestaurant.michelinData) {
    restaurantJson.metadata.push({
        type: "michelin",
        data: localRestaurant.michelinData
    });
}

if (localRestaurant.googlePlacesData) {
    restaurantJson.metadata.push({
        type: "google-places",
        data: localRestaurant.googlePlacesData
    });
}
```

---

## Other Available Endpoints

### CRUD Operations

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/restaurants` | GET | Get all restaurants (paginated) |
| `/restaurants/:id` | GET | Get single restaurant |
| `/restaurants/:id` | PUT | Update restaurant |
| `/restaurants/:id` | DELETE | Delete restaurant |
| `/restaurants/sync` | POST | Bulk create/update/delete |

### Query Parameters for GET /restaurants

- `page`: Page number (default: 1)
- `limit`: Items per page (default: 50, max: 100)
- `simple`: If 'true', returns without concepts (faster)

**Example:**
```http
GET /api/restaurants?page=1&limit=20&simple=true
```

---

## Error Handling

### Common Response Codes

| Code | Status | Meaning |
|------|--------|---------|
| 200 | Success | Operation completed successfully |
| 201 | Created | Resource created successfully |
| 207 | Multi-Status | Partial success in batch operation |
| 400 | Bad Request | Invalid request format or missing required fields |
| 404 | Not Found | Resource not found |
| 500 | Internal Server Error | Server-side error (check logs) |

### Error Response Format

```json
{
  "status": "error",
  "message": "Detailed error message",
  "timestamp": "2025-10-20T10:00:00.000Z"
}
```

---

## Testing Endpoints

### Health Check
```bash
curl https://wsmontes.pythonanywhere.com/api/health
```

### Upload Test Restaurant (Batch)
```bash
curl -X POST \
  https://wsmontes.pythonanywhere.com/api/restaurants/batch \
  -H 'Content-Type: application/json' \
  -d '[{
    "name": "Test Restaurant",
    "description": "Test description",
    "curator": {"name": "Test Curator"},
    "concepts": [
      {"category": "Cuisine", "value": "Italian"}
    ]
  }]'
```

### Upload Test Restaurant (JSON)
```bash
curl -X POST \
  https://wsmontes.pythonanywhere.com/api/curation/json \
  -H 'Content-Type: application/json' \
  -d '[{
    "metadata": [
      {
        "type": "restaurant",
        "id": 1,
        "created": {
          "timestamp": "2025-10-20T10:00:00Z",
          "curator": {"id": 1, "name": "Test Curator"}
        }
      },
      {
        "type": "collector",
        "data": {
          "name": "Test Restaurant",
          "description": "Test description"
        }
      }
    ],
    "Cuisine": ["Italian"]
  }]'
```

---

## Summary

### Current State
- ✅ Using `/api/restaurants/batch`
- ✅ Basic restaurant data syncing
- ❌ Missing location, photos, notes
- ❌ No Michelin or Google Places data
- ❌ No sync metadata tracking

### Recommended Migration Path

1. **Short-term:** Add missing fields to current batch endpoint
2. **Medium-term:** Migrate to `/api/curation/json` for complete metadata
3. **Long-term:** Integrate Michelin and Google Places APIs for enriched data

### Key Takeaway

**The `/api/curation/json` endpoint is the future-proof solution** that stores complete restaurant documents without schema changes. This is the recommended target for full integration.

---

**Document Version:** 1.0  
**Author:** GitHub Copilot  
**Date:** October 20, 2025
