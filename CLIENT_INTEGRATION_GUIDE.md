# Concierge V2 API - Client Integration Guide

**Version**: 2.0  
**Last Updated**: October 20, 2025  
**API Base URL**: `https://wsmontes.pythonanywhere.com`  
**Status**: ✅ Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Migration from V1 to V2](#migration-from-v1-to-v2)
3. [Authentication](#authentication)
4. [API Endpoints Reference](#api-endpoints-reference)
5. [Request/Response Formats](#requestresponse-formats)
6. [Two-Way Sync Implementation](#two-way-sync-implementation)
7. [Error Handling](#error-handling)
8. [Code Examples](#code-examples)
9. [Testing Guide](#testing-guide)
10. [Troubleshooting](#troubleshooting)

---

## Overview

### What's New in V2

The V2 API provides a **simplified, pure V2 JSON format** architecture that enables true two-way sync between Concierge app and the MySQL backend.

**Key Improvements:**
- ✅ **Pure V2 Format**: No data transformation - send and receive exact V2 JSON
- ✅ **Single Table Architecture**: Simplified from 3 tables to 1 table
- ✅ **Flexible Schema**: No required fields (except Name) - missing fields handled gracefully
- ✅ **True Two-Way Sync**: Import and export preserve all data exactly
- ✅ **Bulk Operations**: Import/export multiple restaurants in single request
- ✅ **Metadata Extraction**: Dedicated endpoints for accessing specific metadata types
- ✅ **Search Capabilities**: Search restaurants by name with pagination

### Architecture Changes

**V1 (Old):**
```
entities table → curators table → entity_sync table
   ↓
Complex transformations
   ↓
Custom format response
```

**V2 (New):**
```
restaurants_v2 table
   ↓
v2_data JSON column (stores complete V2 format)
   ↓
Pure V2 JSON response
```

---

## Migration from V1 to V2

### Endpoint Mapping

| V1 Endpoint (Deprecated) | V2 Endpoint (Use This) | Notes |
|--------------------------|------------------------|-------|
| `GET /api/entities?entity_type=restaurant` | `GET /api/v2/restaurants` | Returns pure V2 format |
| `GET /api/entities/{id}` | `GET /api/v2/restaurants/{id}` | Single restaurant |
| `POST /api/entities` | `POST /api/v2/restaurants` | Create single |
| `PUT /api/entities/{id}` | `PUT /api/v2/restaurants/{id}` | Update |
| `DELETE /api/entities/{id}` | `DELETE /api/v2/restaurants/{id}` | Soft delete |
| `POST /api/import/concierge-v2` | `POST /api/v2/restaurants/bulk` | Bulk create |
| `GET /api/export/concierge-v2` | `GET /api/v2/restaurants` | Bulk export |
| N/A | `GET /api/v2/restaurants/search?q=term` | New: Search |
| N/A | `GET /api/v2/restaurants/{id}/metadata` | New: Get metadata |
| N/A | `GET /api/v2/restaurants/{id}/metadata/{type}` | New: Get specific metadata |

### Breaking Changes

1. **Endpoint URLs**: All endpoints now use `/api/v2/restaurants` prefix
2. **Response Format**: Default response is now pure V2 JSON (no wrapper)
3. **Request Format**: POST/PUT require pure V2 JSON (no custom format)
4. **Entity Type Filter**: Use `?entity_type=restaurant` query param instead of path
5. **Curator Management**: Curators are now embedded in V2 JSON metadata, not separate table

### Backward Compatibility

❌ **V1 endpoints will be deprecated** - Update your client to V2 endpoints before V1 removal.

---

## Authentication

### Current Status
🔓 **No authentication required** (open API for development)

### Future Implementation
When authentication is added, you'll need to:
1. Obtain API key from backend admin
2. Include in request headers: `Authorization: Bearer YOUR_API_KEY`

**Note**: Authentication will be added before public production deployment.

---

## API Endpoints Reference

### Base URL
```
https://wsmontes.pythonanywhere.com
```

### Health Check

#### `GET /api/health`
Check API and database connectivity.

**Response:**
```json
{
  "status": "healthy",
  "database": "connected"
}
```

**Status Codes:**
- `200`: Healthy
- `500`: Unhealthy (database connection failed)

---

### Restaurant Endpoints

#### 1. Get All Restaurants

```http
GET /api/v2/restaurants
```

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `entity_type` | string | No | all | Filter by type: `restaurant`, `hotel`, `attraction`, `event` |
| `limit` | integer | No | 100 | Maximum results to return |
| `offset` | integer | No | 0 | Pagination offset |
| `format` | string | No | `v2` | Response format: `v2` (pure JSON) or `full` (with DB metadata) |

**Example Requests:**
```bash
# Get all restaurants (default V2 format)
GET /api/v2/restaurants

# Get first 20 restaurants
GET /api/v2/restaurants?limit=20

# Get restaurants with full database metadata
GET /api/v2/restaurants?format=full

# Get hotels only
GET /api/v2/restaurants?entity_type=hotel

# Pagination: get restaurants 21-40
GET /api/v2/restaurants?limit=20&offset=20
```

**Response (V2 Format - Default):**
```json
{
  "count": 2,
  "restaurants": [
    {
      "Name": "La Bernalda",
      "Type": "restaurant",
      "Cuisine": ["Peruvian", "Contemporary"],
      "Price Range": "$$$$",
      "Location": {
        "Address": "Calle Zurbano 5",
        "City": "Madrid",
        "Country": "Spain",
        "Coordinates": {"lat": 40.4289, "lng": -3.6935}
      },
      "metadata": [
        {
          "type": "michelin",
          "stars": 2,
          "year": 2024,
          "category": "Michelin Stars"
        },
        {
          "type": "50best",
          "rank": 15,
          "year": 2024,
          "category": "World's 50 Best Restaurants"
        }
      ]
    }
  ]
}
```

**Response (Full Format):**
```json
{
  "count": 1,
  "restaurants": [
    {
      "id": 1,
      "name": "La Bernalda",
      "entity_type": "restaurant",
      "v2_data": { /* Complete V2 JSON */ },
      "server_id": null,
      "sync_status": "pending",
      "last_synced_at": null,
      "created_at": "2025-10-20T17:54:14",
      "updated_at": "2025-10-20T17:54:14",
      "deleted_at": null
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `500`: Server error

---

#### 2. Get Single Restaurant

```http
GET /api/v2/restaurants/{id}
```

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | Yes | Restaurant ID |

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `format` | string | No | `v2` | Response format: `v2` or `full` |

**Example Requests:**
```bash
# Get restaurant by ID (V2 format)
GET /api/v2/restaurants/1

# Get with full database metadata
GET /api/v2/restaurants/1?format=full
```

**Response (V2 Format):**
```json
{
  "Name": "La Bernalda",
  "Type": "restaurant",
  "Cuisine": ["Peruvian", "Contemporary"],
  "Price Range": "$$$$",
  "Location": {
    "Address": "Calle Zurbano 5",
    "City": "Madrid",
    "Country": "Spain"
  },
  "metadata": [
    {
      "type": "michelin",
      "stars": 2,
      "year": 2024,
      "category": "Michelin Stars"
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `404`: Restaurant not found
- `500`: Server error

---

#### 3. Create Restaurant

```http
POST /api/v2/restaurants
```

**Request Body:**
Pure Concierge V2 JSON format.

**Required Fields:**
- `Name` (string)

**Optional Fields:**
- `Type` (string, default: "restaurant")
- `Cuisine` (array)
- `Price Range` (string)
- `Location` (object)
- `metadata` (array)
- Any other V2 fields

**Example Request:**
```json
{
  "Name": "El Celler de Can Roca",
  "Type": "restaurant",
  "Cuisine": ["Spanish", "Catalan", "Molecular"],
  "Price Range": "$$$$",
  "Location": {
    "Address": "Can Sunyer 48",
    "City": "Girona",
    "Country": "Spain",
    "Coordinates": {"lat": 41.9794, "lng": 2.8214}
  },
  "Contact": {
    "Phone": "+34 972 222 157",
    "Website": "https://cellercanroca.com",
    "Email": "info@cellercanroca.com"
  },
  "metadata": [
    {
      "type": "michelin",
      "stars": 3,
      "year": 2024,
      "category": "Michelin Stars",
      "curator": "Michelin Guide"
    },
    {
      "type": "50best",
      "rank": 2,
      "year": 2024,
      "category": "World's 50 Best Restaurants",
      "curator": "William Reed Business Media"
    }
  ]
}
```

**Response:**
```json
{
  "message": "Restaurant created successfully",
  "id": 5,
  "restaurant": {
    "Name": "El Celler de Can Roca",
    "Type": "restaurant",
    /* ... complete V2 JSON ... */
  }
}
```

**Status Codes:**
- `201`: Created successfully
- `400`: Bad request (invalid JSON or missing Name)
- `500`: Server error

---

#### 4. Update Restaurant

```http
PUT /api/v2/restaurants/{id}
```

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | Yes | Restaurant ID |

**Request Body:**
Complete V2 JSON object (replaces existing data).

**Example Request:**
```json
{
  "Name": "El Celler de Can Roca - UPDATED",
  "Type": "restaurant",
  "Cuisine": ["Spanish", "Catalan", "Molecular", "Contemporary"],
  "Price Range": "$$$$",
  "metadata": [
    {
      "type": "michelin",
      "stars": 3,
      "year": 2025,
      "category": "Michelin Stars"
    }
  ]
}
```

**Response:**
```json
{
  "message": "Restaurant updated successfully",
  "restaurant": {
    "Name": "El Celler de Can Roca - UPDATED",
    /* ... complete updated V2 JSON ... */
  }
}
```

**Status Codes:**
- `200`: Updated successfully
- `400`: Bad request (invalid JSON)
- `404`: Restaurant not found
- `500`: Server error

---

#### 5. Delete Restaurant

```http
DELETE /api/v2/restaurants/{id}
```

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | Yes | Restaurant ID |

**Note**: This is a **soft delete**. The restaurant is marked as deleted but not removed from database (sets `deleted_at` timestamp).

**Example Request:**
```bash
DELETE /api/v2/restaurants/5
```

**Response:**
```json
{
  "message": "Restaurant deleted successfully"
}
```

**Status Codes:**
- `200`: Deleted successfully
- `404`: Restaurant not found
- `500`: Server error

---

#### 6. Bulk Create Restaurants

```http
POST /api/v2/restaurants/bulk
```

**Request Body:**
Array of V2 JSON objects.

**Example Request:**
```json
[
  {
    "Name": "Restaurant One",
    "Type": "restaurant",
    "Cuisine": ["Italian"],
    "metadata": []
  },
  {
    "Name": "Restaurant Two",
    "Type": "restaurant",
    "Cuisine": ["Japanese", "Sushi"],
    "Price Range": "$$$",
    "metadata": [
      {
        "type": "michelin",
        "stars": 1,
        "year": 2024
      }
    ]
  },
  {
    "Name": "Hotel Example",
    "Type": "hotel",
    "metadata": []
  }
]
```

**Response:**
```json
{
  "message": "Created 3 restaurants",
  "ids": [12, 13, 14]
}
```

**Status Codes:**
- `201`: Created successfully
- `400`: Bad request (not an array, invalid JSON)
- `500`: Server error

**Notes:**
- All restaurants are created in single transaction
- Missing fields are allowed (flexible schema)
- If any restaurant fails, entire batch fails (rollback)

---

#### 7. Search Restaurants

```http
GET /api/v2/restaurants/search
```

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search term (matches restaurant name) |
| `limit` | integer | No | 20 | Maximum results |
| `format` | string | No | `v2` | Response format: `v2` or `full` |

**Example Requests:**
```bash
# Search for restaurants containing "roca"
GET /api/v2/restaurants/search?q=roca

# Search with limit
GET /api/v2/restaurants/search?q=madrid&limit=10

# Search with full format
GET /api/v2/restaurants/search?q=michelin&format=full
```

**Response:**
```json
{
  "count": 2,
  "restaurants": [
    {
      "Name": "El Celler de Can Roca",
      /* ... V2 JSON ... */
    },
    {
      "Name": "Roca Moo",
      /* ... V2 JSON ... */
    }
  ]
}
```

**Status Codes:**
- `200`: Success (even if no results)
- `400`: Bad request (missing `q` parameter)
- `500`: Server error

---

#### 8. Get Restaurant Metadata

```http
GET /api/v2/restaurants/{id}/metadata
```

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | Yes | Restaurant ID |

**Example Request:**
```bash
GET /api/v2/restaurants/1/metadata
```

**Response:**
```json
{
  "metadata": [
    {
      "type": "michelin",
      "stars": 2,
      "year": 2024,
      "category": "Michelin Stars",
      "curator": "Michelin Guide"
    },
    {
      "type": "50best",
      "rank": 15,
      "year": 2024,
      "category": "World's 50 Best Restaurants",
      "curator": "William Reed"
    },
    {
      "type": "pellegrino",
      "award": "Chef's Choice",
      "year": 2024
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `404`: Restaurant not found
- `500`: Server error

---

#### 9. Get Specific Metadata Type

```http
GET /api/v2/restaurants/{id}/metadata/{type}
```

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | integer | Yes | Restaurant ID |
| `type` | string | Yes | Metadata type (e.g., `michelin`, `50best`, `pellegrino`) |

**Example Requests:**
```bash
# Get Michelin metadata only
GET /api/v2/restaurants/1/metadata/michelin

# Get 50 Best metadata only
GET /api/v2/restaurants/1/metadata/50best
```

**Response:**
```json
{
  "type": "michelin",
  "count": 1,
  "metadata": [
    {
      "type": "michelin",
      "stars": 2,
      "year": 2024,
      "category": "Michelin Stars",
      "curator": "Michelin Guide"
    }
  ]
}
```

**Status Codes:**
- `200`: Success (even if no metadata of that type)
- `404`: Restaurant not found
- `500`: Server error

---

## Request/Response Formats

### V2 JSON Format Specification

The API uses **pure Concierge V2 JSON format**. Here's the complete specification:

```typescript
interface RestaurantV2 {
  // Required
  Name: string;
  
  // Standard Fields (Optional)
  Type?: "restaurant" | "hotel" | "attraction" | "event";
  Cuisine?: string[];
  "Price Range"?: string;  // "$", "$$", "$$$", "$$$$"
  
  // Location (Optional)
  Location?: {
    Address?: string;
    City?: string;
    Country?: string;
    Neighborhood?: string;
    Coordinates?: {
      lat: number;
      lng: number;
    };
  };
  
  // Contact (Optional)
  Contact?: {
    Phone?: string;
    Website?: string;
    Email?: string;
    "Social Media"?: {
      Instagram?: string;
      Facebook?: string;
      Twitter?: string;
    };
  };
  
  // Hours (Optional)
  Hours?: {
    [day: string]: string;  // e.g., "Monday": "12:00-15:00, 19:00-23:00"
  };
  
  // Metadata Array (Optional but important for curators)
  metadata?: MetadataItem[];
  
  // Any other custom fields
  [key: string]: any;
}

interface MetadataItem {
  type: string;  // e.g., "michelin", "50best", "pellegrino", "zagat"
  category?: string;
  curator?: string;
  year?: number;
  
  // Type-specific fields (examples)
  stars?: number;           // For Michelin
  rank?: number;            // For 50 Best
  award?: string;           // For other awards
  rating?: number | string; // For ratings
  
  // Any other custom metadata fields
  [key: string]: any;
}
```

### Example Complete V2 JSON

```json
{
  "Name": "Eleven Madison Park",
  "Type": "restaurant",
  "Cuisine": ["Contemporary", "American", "Plant-Based"],
  "Price Range": "$$$$",
  "Location": {
    "Address": "11 Madison Avenue",
    "City": "New York",
    "Country": "United States",
    "Neighborhood": "Flatiron District",
    "Coordinates": {
      "lat": 40.7421,
      "lng": -73.9877
    }
  },
  "Contact": {
    "Phone": "+1 212-889-0905",
    "Website": "https://elevenmadisonpark.com",
    "Email": "info@elevenmadisonpark.com",
    "Social Media": {
      "Instagram": "@elevenmadisonpark",
      "Facebook": "ElevenMadisonPark"
    }
  },
  "Hours": {
    "Monday": "Closed",
    "Tuesday": "17:30-22:00",
    "Wednesday": "17:30-22:00",
    "Thursday": "17:30-22:00",
    "Friday": "17:30-22:00",
    "Saturday": "17:30-22:00",
    "Sunday": "17:30-22:00"
  },
  "Description": "Plant-based fine dining experience in Manhattan",
  "Chef": "Daniel Humm",
  "Opened": 1998,
  "Renovated": 2017,
  "Seating Capacity": 90,
  "Dress Code": "Business Casual",
  "Reservations Required": true,
  "metadata": [
    {
      "type": "michelin",
      "stars": 3,
      "year": 2024,
      "category": "Michelin Stars",
      "curator": "Michelin Guide",
      "retained_since": 2012
    },
    {
      "type": "50best",
      "rank": 1,
      "year": 2017,
      "category": "World's 50 Best Restaurants",
      "curator": "William Reed Business Media",
      "notes": "Won #1 position"
    },
    {
      "type": "pellegrino",
      "award": "Best Restaurant in North America",
      "year": 2019,
      "curator": "S.Pellegrino"
    },
    {
      "type": "zagat",
      "rating": 29,
      "max_rating": 30,
      "year": 2024,
      "curator": "Zagat"
    },
    {
      "type": "custom",
      "category": "Sustainability",
      "award": "Zero Waste Certified",
      "year": 2022,
      "curator": "Green Restaurant Association"
    }
  ]
}
```

### Response Envelope

All list endpoints return data in this format:

```json
{
  "count": 10,
  "restaurants": [
    /* Array of V2 JSON objects */
  ]
}
```

### Error Response Format

```json
{
  "error": "Error description here"
}
```

---

## Two-Way Sync Implementation

### Sync Architecture

```
┌─────────────────┐         ┌─────────────────┐
│  Concierge App  │ ←─────→ │  MySQL Backend  │
│  (IndexedDB)    │         │  (restaurants_v2)│
└─────────────────┘         └─────────────────┘
        │                            │
        │                            │
    V2 JSON ←───────────────────→ V2 JSON
   (No transformation)
```

### Sync Workflow

#### 1. Export from Concierge (Client → Server)

**Step 1**: Export V2 data from Concierge IndexedDB
```javascript
const restaurants = await conciergeDB.restaurants.toArray();
// restaurants is array of V2 JSON objects
```

**Step 2**: Send to server
```javascript
const response = await fetch(
  'https://wsmontes.pythonanywhere.com/api/v2/restaurants/bulk',
  {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(restaurants)
  }
);

const result = await response.json();
// result = {message: "Created 10 restaurants", ids: [1,2,3...]}
```

#### 2. Import to Concierge (Server → Client)

**Step 1**: Fetch from server
```javascript
const response = await fetch(
  'https://wsmontes.pythonanywhere.com/api/v2/restaurants'
);

const {restaurants} = await response.json();
// restaurants is array of pure V2 JSON objects
```

**Step 2**: Import into Concierge IndexedDB
```javascript
await conciergeDB.restaurants.bulkPut(restaurants);
```

### Sync Manager Implementation

```javascript
class ConciergeServerSync {
  constructor(baseUrl = 'https://wsmontes.pythonanywhere.com') {
    this.baseUrl = baseUrl;
  }

  /**
   * Upload restaurants to server
   */
  async uploadToServer(restaurants) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v2/restaurants/bulk`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(restaurants)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  }

  /**
   * Download restaurants from server
   */
  async downloadFromServer(options = {}) {
    try {
      const params = new URLSearchParams(options);
      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants?${params}`
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Download failed');
      }

      const {restaurants} = await response.json();
      return restaurants;
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }

  /**
   * Sync single restaurant
   */
  async syncOne(restaurant, restaurantId = null) {
    try {
      const method = restaurantId ? 'PUT' : 'POST';
      const url = restaurantId 
        ? `${this.baseUrl}/api/v2/restaurants/${restaurantId}`
        : `${this.baseUrl}/api/v2/restaurants`;

      const response = await fetch(url, {
        method,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(restaurant)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Sync failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Sync error:', error);
      throw error;
    }
  }

  /**
   * Search restaurants on server
   */
  async search(searchTerm, options = {}) {
    try {
      const params = new URLSearchParams({q: searchTerm, ...options});
      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants/search?${params}`
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Search failed');
      }

      const {restaurants} = await response.json();
      return restaurants;
    } catch (error) {
      console.error('Search error:', error);
      throw error;
    }
  }

  /**
   * Delete restaurant from server
   */
  async delete(restaurantId) {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants/${restaurantId}`,
        {method: 'DELETE'}
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Delete failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Delete error:', error);
      throw error;
    }
  }

  /**
   * Check server health
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`);
      return await response.json();
    } catch (error) {
      console.error('Health check error:', error);
      return {status: 'unhealthy', error: error.message};
    }
  }
}

// Usage
const syncManager = new ConciergeServerSync();

// Upload all restaurants
const allRestaurants = await conciergeDB.restaurants.toArray();
await syncManager.uploadToServer(allRestaurants);

// Download all restaurants
const serverRestaurants = await syncManager.downloadFromServer();
await conciergeDB.restaurants.bulkPut(serverRestaurants);

// Sync one restaurant
await syncManager.syncOne(restaurant);

// Search
const results = await syncManager.search('madrid');
```

### Conflict Resolution Strategy

When the same restaurant exists in both client and server:

**Option 1: Last Write Wins**
```javascript
// Always use server version
const serverRestaurants = await syncManager.downloadFromServer();
await conciergeDB.restaurants.bulkPut(serverRestaurants);
```

**Option 2: Client Preference**
```javascript
// Keep client version, only add new from server
const serverRestaurants = await syncManager.downloadFromServer();
const clientRestaurants = await conciergeDB.restaurants.toArray();

for (const serverRest of serverRestaurants) {
  const exists = clientRestaurants.some(r => r.Name === serverRest.Name);
  if (!exists) {
    await conciergeDB.restaurants.add(serverRest);
  }
}
```

**Option 3: Use Updated Timestamps**
```javascript
// Use whichever is newer (requires format=full to get updated_at)
const response = await fetch(
  'https://wsmontes.pythonanywhere.com/api/v2/restaurants?format=full'
);
const {restaurants: serverRestaurants} = await response.json();

for (const serverRest of serverRestaurants) {
  const clientRest = await conciergeDB.restaurants
    .where('Name').equals(serverRest.v2_data.Name)
    .first();

  if (!clientRest) {
    // New restaurant, add it
    await conciergeDB.restaurants.add(serverRest.v2_data);
  } else {
    // Compare timestamps
    const serverTime = new Date(serverRest.updated_at);
    const clientTime = new Date(clientRest.updated_at || 0);
    
    if (serverTime > clientTime) {
      // Server is newer, update client
      await conciergeDB.restaurants
        .where('Name').equals(clientRest.Name)
        .modify(serverRest.v2_data);
    }
  }
}
```

---

## Error Handling

### HTTP Status Codes

| Status Code | Meaning | Action |
|-------------|---------|--------|
| `200` | Success | Process response data |
| `201` | Created | Resource created successfully |
| `400` | Bad Request | Check request format/data |
| `404` | Not Found | Resource doesn't exist |
| `405` | Method Not Allowed | Check HTTP method (GET/POST/PUT/DELETE) |
| `500` | Server Error | Retry or contact support |

### Error Response Format

All errors return JSON:
```json
{
  "error": "Detailed error message"
}
```

### Common Errors

#### 1. Invalid JSON
**Error:**
```json
{
  "error": "No JSON data provided"
}
```
**Solution**: Ensure `Content-Type: application/json` header is set and body contains valid JSON.

#### 2. Restaurant Not Found
**Error:**
```json
{
  "error": "Restaurant not found"
}
```
**Solution**: Check restaurant ID exists. May have been deleted.

#### 3. Database Connection Error
**Error:**
```json
{
  "error": "Failed to get database connection"
}
```
**Solution**: Server issue. Retry after a few seconds. If persists, contact support.

#### 4. Missing Required Field
**Error:**
```json
{
  "error": "Name field is required"
}
```
**Solution**: Ensure V2 JSON includes `Name` field.

### Error Handling Best Practices

```javascript
async function safeApiCall(apiFunction) {
  try {
    return await apiFunction();
  } catch (error) {
    if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
      // Network error
      console.error('Network error:', error);
      return {error: 'Network connection failed. Check internet connection.'};
    } else if (error.message.includes('404')) {
      // Not found
      console.error('Resource not found:', error);
      return {error: 'Resource not found.'};
    } else {
      // Other error
      console.error('API error:', error);
      return {error: error.message || 'Unknown error occurred.'};
    }
  }
}

// Usage
const result = await safeApiCall(() => 
  syncManager.uploadToServer(restaurants)
);

if (result.error) {
  showErrorToUser(result.error);
} else {
  showSuccessMessage(`Created ${result.ids.length} restaurants`);
}
```

---

## Code Examples

### Complete Integration Example

```javascript
// ====================================
// Complete Concierge Sync Manager
// ====================================

class ConciergeSync {
  constructor() {
    this.baseUrl = 'https://wsmontes.pythonanywhere.com';
    this.db = null;  // Initialize with your IndexedDB instance
  }

  /**
   * Initialize sync manager
   */
  async initialize(indexedDB) {
    this.db = indexedDB;
    
    // Check server health
    const health = await this.checkHealth();
    if (health.status !== 'healthy') {
      throw new Error('Server is not available');
    }
  }

  /**
   * Check server health
   */
  async checkHealth() {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`);
      return await response.json();
    } catch (error) {
      return {status: 'unhealthy', error: error.message};
    }
  }

  /**
   * Full sync: Upload local → Download server → Merge
   */
  async fullSync() {
    console.log('Starting full sync...');
    
    try {
      // Step 1: Upload local restaurants
      const localRestaurants = await this.db.restaurants.toArray();
      console.log(`Uploading ${localRestaurants.length} local restaurants...`);
      
      const uploadResult = await this.uploadAll(localRestaurants);
      console.log(`Upload complete: ${uploadResult.message}`);
      
      // Step 2: Download server restaurants
      console.log('Downloading from server...');
      const serverRestaurants = await this.downloadAll();
      console.log(`Downloaded ${serverRestaurants.length} restaurants`);
      
      // Step 3: Merge into local database
      console.log('Merging data...');
      await this.db.restaurants.bulkPut(serverRestaurants);
      
      console.log('Full sync complete!');
      
      return {
        success: true,
        uploaded: localRestaurants.length,
        downloaded: serverRestaurants.length
      };
    } catch (error) {
      console.error('Sync failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Upload all restaurants
   */
  async uploadAll(restaurants) {
    const response = await fetch(`${this.baseUrl}/api/v2/restaurants/bulk`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(restaurants)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Upload failed');
    }

    return await response.json();
  }

  /**
   * Download all restaurants
   */
  async downloadAll(options = {}) {
    const params = new URLSearchParams(options);
    const response = await fetch(
      `${this.baseUrl}/api/v2/restaurants?${params}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Download failed');
    }

    const {restaurants} = await response.json();
    return restaurants;
  }

  /**
   * Create single restaurant on server
   */
  async createOne(restaurant) {
    const response = await fetch(`${this.baseUrl}/api/v2/restaurants`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(restaurant)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Create failed');
    }

    return await response.json();
  }

  /**
   * Update single restaurant on server
   */
  async updateOne(restaurantId, restaurant) {
    const response = await fetch(
      `${this.baseUrl}/api/v2/restaurants/${restaurantId}`,
      {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(restaurant)
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Update failed');
    }

    return await response.json();
  }

  /**
   * Delete restaurant from server
   */
  async deleteOne(restaurantId) {
    const response = await fetch(
      `${this.baseUrl}/api/v2/restaurants/${restaurantId}`,
      {method: 'DELETE'}
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Delete failed');
    }

    return await response.json();
  }

  /**
   * Search restaurants
   */
  async search(query, limit = 20) {
    const params = new URLSearchParams({q: query, limit});
    const response = await fetch(
      `${this.baseUrl}/api/v2/restaurants/search?${params}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Search failed');
    }

    const {restaurants} = await response.json();
    return restaurants;
  }

  /**
   * Get Michelin starred restaurants only
   */
  async getMichelinRestaurants() {
    const allRestaurants = await this.downloadAll();
    
    return allRestaurants.filter(restaurant => {
      const metadata = restaurant.metadata || [];
      return metadata.some(m => m.type === 'michelin' && m.stars > 0);
    });
  }

  /**
   * Get restaurants by city
   */
  async getRestaurantsByCity(city) {
    const allRestaurants = await this.downloadAll();
    
    return allRestaurants.filter(restaurant => {
      return restaurant.Location?.City?.toLowerCase() === city.toLowerCase();
    });
  }
}

// ====================================
// Usage in Concierge App
// ====================================

// Initialize
const sync = new ConciergeSync();
await sync.initialize(conciergeDB);

// Full sync (recommended on app startup)
const result = await sync.fullSync();
if (result.success) {
  console.log(`Synced: ${result.uploaded} up, ${result.downloaded} down`);
} else {
  console.error('Sync failed:', result.error);
}

// Create new restaurant
const newRestaurant = {
  Name: "New Restaurant",
  Type: "restaurant",
  Cuisine: ["Italian"],
  metadata: []
};

// Save locally
await conciergeDB.restaurants.add(newRestaurant);

// Sync to server
await sync.createOne(newRestaurant);

// Search
const results = await sync.search('madrid');
console.log(`Found ${results.length} restaurants in Madrid`);

// Get Michelin restaurants
const michelinStars = await sync.getMichelinRestaurants();
console.log(`${michelinStars.length} Michelin-starred restaurants`);
```

### UI Integration Example

```javascript
// ====================================
// UI Integration for Sync Button
// ====================================

class SyncUI {
  constructor(syncManager) {
    this.sync = syncManager;
    this.button = document.getElementById('sync-button');
    this.status = document.getElementById('sync-status');
    
    this.button.addEventListener('click', () => this.handleSync());
  }

  async handleSync() {
    // Disable button during sync
    this.button.disabled = true;
    this.button.textContent = 'Syncing...';
    this.showStatus('Syncing with server...', 'info');

    try {
      // Check health first
      const health = await this.sync.checkHealth();
      if (health.status !== 'healthy') {
        throw new Error('Server is not available');
      }

      // Perform full sync
      const result = await this.sync.fullSync();

      if (result.success) {
        this.showStatus(
          `Sync complete! Uploaded ${result.uploaded}, Downloaded ${result.downloaded}`,
          'success'
        );
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      this.showStatus(`Sync failed: ${error.message}`, 'error');
    } finally {
      // Re-enable button
      this.button.disabled = false;
      this.button.textContent = 'Sync';
    }
  }

  showStatus(message, type) {
    this.status.textContent = message;
    this.status.className = `status status-${type}`;
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.status.textContent = '';
      this.status.className = 'status';
    }, 5000);
  }
}

// Initialize
const syncUI = new SyncUI(syncManager);
```

---

## Testing Guide

### 1. Health Check Test

```bash
curl https://wsmontes.pythonanywhere.com/api/health
```

**Expected Response:**
```json
{"status":"healthy","database":"connected"}
```

### 2. Create Restaurant Test

```bash
curl -X POST https://wsmontes.pythonanywhere.com/api/v2/restaurants \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "Test Restaurant",
    "Type": "restaurant",
    "Cuisine": ["Test"],
    "metadata": []
  }'
```

**Expected Response:**
```json
{
  "message": "Restaurant created successfully",
  "id": 1,
  "restaurant": {
    "Name": "Test Restaurant",
    "Type": "restaurant",
    "Cuisine": ["Test"],
    "metadata": []
  }
}
```

### 3. Get All Restaurants Test

```bash
curl https://wsmontes.pythonanywhere.com/api/v2/restaurants
```

**Expected Response:**
```json
{
  "count": 1,
  "restaurants": [
    {
      "Name": "Test Restaurant",
      "Type": "restaurant",
      "Cuisine": ["Test"],
      "metadata": []
    }
  ]
}
```

### 4. Bulk Create Test

```bash
curl -X POST https://wsmontes.pythonanywhere.com/api/v2/restaurants/bulk \
  -H "Content-Type": application/json" \
  -d '[
    {"Name": "Bulk 1", "Type": "restaurant", "metadata": []},
    {"Name": "Bulk 2", "Type": "restaurant", "metadata": []}
  ]'
```

**Expected Response:**
```json
{
  "message": "Created 2 restaurants",
  "ids": [2, 3]
}
```

### 5. Search Test

```bash
curl "https://wsmontes.pythonanywhere.com/api/v2/restaurants/search?q=Test"
```

**Expected Response:**
```json
{
  "count": 1,
  "restaurants": [
    {
      "Name": "Test Restaurant",
      "Type": "restaurant",
      "Cuisine": ["Test"],
      "metadata": []
    }
  ]
}
```

### 6. Update Test

```bash
curl -X PUT https://wsmontes.pythonanywhere.com/api/v2/restaurants/1 \
  -H "Content-Type: application/json" \
  -d '{
    "Name": "Test Restaurant UPDATED",
    "Type": "restaurant",
    "Cuisine": ["Test", "Updated"],
    "metadata": []
  }'
```

**Expected Response:**
```json
{
  "message": "Restaurant updated successfully",
  "restaurant": {
    "Name": "Test Restaurant UPDATED",
    "Type": "restaurant",
    "Cuisine": ["Test", "Updated"],
    "metadata": []
  }
}
```

### 7. Delete Test

```bash
curl -X DELETE https://wsmontes.pythonanywhere.com/api/v2/restaurants/1
```

**Expected Response:**
```json
{
  "message": "Restaurant deleted successfully"
}
```

### JavaScript Testing

```javascript
// ====================================
// Automated Test Suite
// ====================================

class APITester {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.testResults = [];
  }

  async runAllTests() {
    console.log('Starting API tests...\n');

    await this.testHealth();
    await this.testCreate();
    await this.testGetAll();
    await this.testGetOne();
    await this.testSearch();
    await this.testUpdate();
    await this.testBulkCreate();
    await this.testDelete();

    this.printResults();
  }

  async testHealth() {
    console.log('Test: Health Check');
    try {
      const response = await fetch(`${this.baseUrl}/api/health`);
      const data = await response.json();
      
      if (data.status === 'healthy') {
        this.pass('Health Check');
      } else {
        this.fail('Health Check', 'Status not healthy');
      }
    } catch (error) {
      this.fail('Health Check', error.message);
    }
  }

  async testCreate() {
    console.log('Test: Create Restaurant');
    try {
      const restaurant = {
        Name: "Test Restaurant",
        Type: "restaurant",
        Cuisine: ["Test"],
        metadata: []
      };

      const response = await fetch(`${this.baseUrl}/api/v2/restaurants`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(restaurant)
      });

      const data = await response.json();

      if (response.ok && data.id) {
        this.pass('Create Restaurant');
        this.testRestaurantId = data.id;
      } else {
        this.fail('Create Restaurant', 'No ID returned');
      }
    } catch (error) {
      this.fail('Create Restaurant', error.message);
    }
  }

  async testGetAll() {
    console.log('Test: Get All Restaurants');
    try {
      const response = await fetch(`${this.baseUrl}/api/v2/restaurants`);
      const data = await response.json();

      if (response.ok && Array.isArray(data.restaurants)) {
        this.pass('Get All Restaurants');
      } else {
        this.fail('Get All Restaurants', 'Invalid response format');
      }
    } catch (error) {
      this.fail('Get All Restaurants', error.message);
    }
  }

  async testGetOne() {
    console.log('Test: Get Single Restaurant');
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants/${this.testRestaurantId}`
      );
      const data = await response.json();

      if (response.ok && data.Name) {
        this.pass('Get Single Restaurant');
      } else {
        this.fail('Get Single Restaurant', 'Invalid response');
      }
    } catch (error) {
      this.fail('Get Single Restaurant', error.message);
    }
  }

  async testSearch() {
    console.log('Test: Search');
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants/search?q=Test`
      );
      const data = await response.json();

      if (response.ok && Array.isArray(data.restaurants)) {
        this.pass('Search');
      } else {
        this.fail('Search', 'Invalid response');
      }
    } catch (error) {
      this.fail('Search', error.message);
    }
  }

  async testUpdate() {
    console.log('Test: Update Restaurant');
    try {
      const updated = {
        Name: "Test Restaurant UPDATED",
        Type: "restaurant",
        Cuisine: ["Test", "Updated"],
        metadata: []
      };

      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants/${this.testRestaurantId}`,
        {
          method: 'PUT',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(updated)
        }
      );

      const data = await response.json();

      if (response.ok && data.restaurant.Name.includes('UPDATED')) {
        this.pass('Update Restaurant');
      } else {
        this.fail('Update Restaurant', 'Update not reflected');
      }
    } catch (error) {
      this.fail('Update Restaurant', error.message);
    }
  }

  async testBulkCreate() {
    console.log('Test: Bulk Create');
    try {
      const restaurants = [
        {Name: "Bulk 1", Type: "restaurant", metadata: []},
        {Name: "Bulk 2", Type: "restaurant", metadata: []}
      ];

      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants/bulk`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(restaurants)
        }
      );

      const data = await response.json();

      if (response.ok && data.ids && data.ids.length === 2) {
        this.pass('Bulk Create');
      } else {
        this.fail('Bulk Create', 'Incorrect number of IDs');
      }
    } catch (error) {
      this.fail('Bulk Create', error.message);
    }
  }

  async testDelete() {
    console.log('Test: Delete Restaurant');
    try {
      const response = await fetch(
        `${this.baseUrl}/api/v2/restaurants/${this.testRestaurantId}`,
        {method: 'DELETE'}
      );

      const data = await response.json();

      if (response.ok && data.message.includes('deleted')) {
        this.pass('Delete Restaurant');
      } else {
        this.fail('Delete Restaurant', 'Delete failed');
      }
    } catch (error) {
      this.fail('Delete Restaurant', error.message);
    }
  }

  pass(testName) {
    this.testResults.push({test: testName, status: 'PASS'});
    console.log(`✅ ${testName}: PASS\n`);
  }

  fail(testName, reason) {
    this.testResults.push({test: testName, status: 'FAIL', reason});
    console.log(`❌ ${testName}: FAIL - ${reason}\n`);
  }

  printResults() {
    console.log('\n=================================');
    console.log('Test Results Summary');
    console.log('=================================');
    
    const passed = this.testResults.filter(r => r.status === 'PASS').length;
    const failed = this.testResults.filter(r => r.status === 'FAIL').length;
    
    console.log(`Total: ${this.testResults.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log('=================================\n');

    if (failed > 0) {
      console.log('Failed Tests:');
      this.testResults
        .filter(r => r.status === 'FAIL')
        .forEach(r => console.log(`- ${r.test}: ${r.reason}`));
    }
  }
}

// Run tests
const tester = new APITester('https://wsmontes.pythonanywhere.com');
await tester.runAllTests();
```

---

## Troubleshooting

### Problem: Network Error / Cannot Connect

**Symptoms:**
- `NetworkError` or `fetch failed` errors
- Timeout errors
- CORS errors in browser console

**Solutions:**
1. Check internet connection
2. Verify base URL is correct: `https://wsmontes.pythonanywhere.com`
3. Check CORS settings in browser (should allow cross-origin requests)
4. Try health check endpoint: `curl https://wsmontes.pythonanywhere.com/api/health`

---

### Problem: 404 Not Found

**Symptoms:**
- `404` status code
- "Endpoint not found" error

**Solutions:**
1. Verify endpoint URL is correct (use `/api/v2/restaurants`, not `/api/entities`)
2. Check HTTP method (GET, POST, PUT, DELETE)
3. Ensure restaurant ID exists when accessing `/api/v2/restaurants/{id}`

---

### Problem: 400 Bad Request

**Symptoms:**
- `400` status code
- "No JSON data provided" error
- "Invalid JSON" error

**Solutions:**
1. Ensure `Content-Type: application/json` header is set
2. Verify request body is valid JSON
3. Check that `Name` field is included in V2 JSON
4. Validate JSON format with online validator

---

### Problem: 500 Server Error

**Symptoms:**
- `500` status code
- "Internal server error" message
- "Database connection failed" error

**Solutions:**
1. Check server status (contact administrator)
2. Retry request after few seconds
3. Check server logs for detailed error
4. Verify database is accessible

---

### Problem: Data Not Syncing

**Symptoms:**
- Upload succeeds but data doesn't appear on server
- Download returns empty array
- Data mismatch between client and server

**Solutions:**
1. Verify upload response includes IDs
2. Check that restaurants aren't soft deleted (`deleted_at` field)
3. Use `?format=full` to see database metadata
4. Clear local cache and re-download from server
5. Check that Name field is unique (duplicates may be overwritten)

---

### Problem: Bulk Create Fails

**Symptoms:**
- Bulk create returns error
- Only some restaurants created

**Solutions:**
1. Ensure request body is array of objects (not single object)
2. Verify each restaurant has `Name` field
3. Check JSON is valid (no trailing commas, correct quotes)
4. Split large batches into smaller chunks (e.g., 50 restaurants per request)

---

### Problem: Search Returns No Results

**Symptoms:**
- Search returns empty array
- Known restaurants not found

**Solutions:**
1. Verify search term matches restaurant name (case-insensitive)
2. Check that restaurants exist: `GET /api/v2/restaurants`
3. Try partial search (e.g., "roca" instead of "El Celler de Can Roca")
4. Ensure restaurants aren't soft deleted

---

### Debug Checklist

When troubleshooting, check:

- [ ] Server health: `curl https://wsmontes.pythonanywhere.com/api/health`
- [ ] Endpoint URL is correct (`/api/v2/restaurants`)
- [ ] HTTP method is correct (GET, POST, PUT, DELETE)
- [ ] `Content-Type: application/json` header for POST/PUT
- [ ] Request body is valid JSON
- [ ] `Name` field exists in V2 JSON
- [ ] Restaurant ID exists for GET/PUT/DELETE operations
- [ ] Network connection is stable
- [ ] CORS is not blocking request (check browser console)

---

## Additional Resources

### Related Documentation
- `V2_API_DEPLOYMENT.md` - Deployment guide for backend
- `V2_API_TEST_RESULTS.md` - Complete test results
- `V2_API_FINAL_STATUS.md` - Current API status
- `DEPLOY_V2_SCHEMA.sql` - Database schema

### Support
For issues or questions:
1. Check this documentation first
2. Review error messages carefully
3. Test with curl commands
4. Check server logs (if access available)
5. Contact backend administrator

### Changelog

**Version 2.0** (October 20, 2025)
- Initial V2 API release
- Pure V2 JSON format
- Single table architecture
- Bulk operations support
- Search functionality
- Metadata extraction endpoints
- Full two-way sync capability

---

## Summary

The Concierge V2 API provides a **clean, RESTful interface** for managing restaurants with **true two-way sync** capabilities. Key features:

✅ **11 production-ready endpoints**  
✅ **Pure V2 JSON format** (no transformation)  
✅ **Bulk operations** for efficient sync  
✅ **Flexible schema** (missing fields allowed)  
✅ **Search and filter** capabilities  
✅ **Metadata extraction** for curator data  
✅ **CORS enabled** for web apps  
✅ **Error handling** with clear messages  

**Start integrating today!** Begin with the health check, then implement the sync manager class, and test with your Concierge data.

---

**End of Documentation**
