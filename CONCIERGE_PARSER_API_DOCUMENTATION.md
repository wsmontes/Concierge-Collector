# Concierge Parser API Documentation

**Version:** 1.1.2  
**Base URL:** `https://wsmontes.pythonanywhere.com` (Production) | `http://localhost:5000` (Development)  
**Content-Type:** `application/json`  
**Database:** PostgreSQL  
**Framework:** Flask with CORS enabled  

## Table of Contents
1. [Authentication & Security](#authentication--security)
2. [Error Handling](#error-handling)
3. [Health & Status Endpoints](#health--status-endpoints)
4. [Data Curation Endpoints](#data-curation-endpoints)
5. [Restaurant Management Endpoints](#restaurant-management-endpoints)
6. [Restaurant Staging Endpoints](#restaurant-staging-endpoints)
7. [Web Interface Endpoints](#web-interface-endpoints)
8. [Database Schema](#database-schema)
9. [Response Formats](#response-formats)

---

## Authentication & Security

- **CORS:** Enabled for all origins (`*`)
- **Content Validation:** JSON content-type validation on POST/PUT requests
- **Request Limits:** 16MB maximum content length
- **Environment Variables Required:**
  - `DB_HOST`: PostgreSQL host
  - `DB_NAME`: Database name
  - `DB_USER`: Database username
  - `DB_PASSWORD`: Database password
  - `DB_PORT`: Database port (default: 5432)

---

## Error Handling

### Standard Error Response
```json
{
  "status": "error",
  "message": "Human-readable error message",
  "details": "Technical error details",
  "timestamp": "2025-10-18T10:00:00Z"
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `404` - Not Found
- `500` - Internal Server Error
- `503` - Service Unavailable (database issues)

---

## Health & Status Endpoints

### Health Check
**Endpoint:** `GET /api/health`  
**Purpose:** Database connectivity verification with detailed status

**Response:**
```json
{
  "status": "healthy|unhealthy",
  "database": "connected|disconnected",
  "timestamp": "2025-10-18T10:00:00Z",
  "error": "Error details if unhealthy"
}
```

**Database Query:** `SELECT 1` with 10-second timeout

### Simple Status
**Endpoint:** `GET /status`  
**Purpose:** Basic server health check

**Response:**
```json
{
  "status": "ok",
  "version": "1.1.2",
  "timestamp": "2025-10-18T10:00:00Z"
}
```

### Ping
**Endpoint:** `GET /ping`  
**Response:** `pong` (200 status)

### Test
**Endpoint:** `GET /test`  
**Purpose:** Environment verification

**Response:**
```json
{
  "status": "ok",
  "message": "Flask server is running",
  "environment": "PythonAnywhere|Local"
}
```

---

## Data Curation Endpoints

### JSON Curation (Recommended)
**Endpoint:** `POST /api/curation/json`  
**Purpose:** Store restaurants as complete JSON documents  
**Content-Type:** `application/json`

**Request Body:**
```json
[
  {
    "name": "Restaurant Name",
    "restaurant_id": "unique_identifier",
    "server_id": "external_server_id",
    "metadata": [
      {
        "type": "restaurant|collector|michelin|google-places",
        "data": { /* type-specific data */ }
      }
    ],
    "categories": {
      "cuisine": ["Italian", "Mediterranean"],
      "price_range": ["$$"],
      "atmosphere": ["Casual"]
    }
  }
]
```

**Database Operations:**
- Upserts into `restaurants_json` table
- Conflict resolution on `name` field
- JSON document storage in `restaurant_data` column

**Response:**
```json
{
  "status": "success",
  "processed": 1,
  "message": "Restaurants processed successfully"
}
```

### Legacy V1 Curation
**Endpoint:** `POST /api/curation`  
**Purpose:** Legacy format support for existing integrations

**Request Body:**
```json
{
  "restaurants": [
    {
      "name": "Restaurant Name",
      "description": "Description",
      "transcription": "Chat transcription",
      "server_id": "external_id"
    }
  ],
  "concepts": [
    {
      "category": "cuisine",
      "value": "Italian"
    }
  ],
  "restaurantConcepts": [
    {
      "restaurantName": "Restaurant Name",
      "conceptValue": "Italian"
    }
  ]
}
```

**Database Operations:**
1. Insert/update `restaurants` table
2. Process `concepts` with `concept_categories` lookup
3. Create `restaurant_concepts` relationships
4. Handle curator assignments

### V2 Enhanced Curation
**Endpoint:** `POST /api/curation/v2`  
**Purpose:** Enhanced format with rich metadata structure

**Request Body:**
```json
[
  {
    "metadata": [
      {
        "type": "restaurant",
        "data": {
          "name": "Restaurant Name",
          "description": "Enhanced description"
        }
      },
      {
        "type": "collector",
        "data": {
          "name": "Restaurant Name",
          "categories": {
            "cuisine": ["Italian", "Mediterranean"],
            "price": ["$$"],
            "location": ["Manhattan"]
          }
        }
      },
      {
        "type": "michelin",
        "data": {
          "stars": 1,
          "guide_year": 2025
        }
      },
      {
        "type": "google-places",
        "data": {
          "place_id": "ChIJ...",
          "rating": 4.5,
          "price_level": 2
        }
      }
    ]
  }
]
```

**Database Operations:**
- Processes metadata by type
- Creates structured restaurant records
- Handles external service integrations
- Maintains data lineage

---

## Restaurant Management Endpoints

### Get All Restaurants
**Endpoint:** `GET /api/restaurants`  
**Purpose:** Retrieve all restaurants with complete data

**SQL Query:**
```sql
SELECT r.id, r.name, r.description, r.transcription, r.timestamp, 
       r.server_id, c.name as curator_name, c.id as curator_id
FROM restaurants r
LEFT JOIN curators c ON r.curator_id = c.id
ORDER BY r.id DESC
```

**Response:**
```json
[
  {
    "id": 123,
    "name": "Restaurant Name",
    "description": "Description",
    "transcription": "Chat transcription",
    "timestamp": "2025-10-18T10:00:00Z",
    "server_id": "ext_123",
    "curator": {
      "id": 1,
      "name": "Curator Name"
    },
    "concepts": [
      {
        "category": "cuisine",
        "value": "Italian"
      }
    ]
  }
]
```

### Get Single Restaurant
**Endpoint:** `GET /api/restaurants/{id}`  
**Purpose:** Retrieve specific restaurant by ID

**Path Parameters:**
- `id` (integer): Restaurant database ID

**SQL Queries:**
1. Restaurant data with curator info
2. Associated concepts via joins:
```sql
SELECT cc.name, con.value
FROM restaurant_concepts rc
JOIN concepts con ON rc.concept_id = con.id
JOIN concept_categories cc ON con.category_id = cc.id
WHERE rc.restaurant_id = %s
```

### Update Restaurant
**Endpoint:** `PUT /api/restaurants/{id}`  
**Purpose:** Update existing restaurant data

**Path Parameters:**
- `id` (integer): Restaurant database ID

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "transcription": "Updated transcription",
  "curator_id": 2,
  "server_id": "new_server_id",
  "concepts": [
    {
      "category": "cuisine",
      "value": "French"
    }
  ]
}
```

**Database Operations:**
1. Validate restaurant exists
2. Build dynamic UPDATE query for provided fields
3. Handle concept replacement:
   - Delete existing `restaurant_concepts`
   - Insert/update `concept_categories`
   - Insert/update `concepts`
   - Create new `restaurant_concepts` relationships
4. Transaction rollback on error

**Allowed Update Fields:**
- `name`, `description`, `transcription`, `curator_id`, `server_id`

### Delete Restaurant
**Endpoint:** `DELETE /api/restaurants/{id}`  
**Purpose:** Remove restaurant and all relationships

**Database Operations:**
1. Verify restaurant exists
2. Delete from `restaurant_concepts` (cascade)
3. Delete from `restaurants`
4. Return deletion summary

**Response:**
```json
{
  "status": "success",
  "message": "Restaurant \"Name\" deleted successfully",
  "deleted_restaurant_id": 123,
  "deleted_concepts": 5
}
```

### Batch Insert
**Endpoint:** `POST /api/restaurants/batch`  
**Purpose:** Create multiple restaurants in single transaction

**Request Body:**
```json
[
  {
    "name": "Restaurant Name",
    "description": "Description",
    "transcription": "Transcription",
    "timestamp": "2025-10-18T10:00:00Z",
    "server_id": "ext_123",
    "curator": {
      "name": "Curator Name"
    },
    "concepts": [
      {
        "category": "cuisine",
        "value": "Italian"
      }
    ]
  }
]
```

**Database Operations:**
1. For each restaurant:
   - Insert/get curator
   - Insert restaurant with conflict handling
   - Process concepts and categories
   - Create relationships
2. Single transaction with rollback on any failure

### Server ID Management
**Endpoint:** `GET /api/restaurants/server-ids`  
**Purpose:** Retrieve restaurants with server ID information for sync operations

**Query Parameters:**
- `has_server_id` (boolean): Filter by server ID presence

**Response:**
```json
[
  {
    "id": 123,
    "name": "Restaurant Name",
    "server_id": "ext_123"
  }
]
```

### Restaurant Sync
**Endpoint:** `POST /api/restaurants/sync`  
**Purpose:** Synchronize restaurant data with external server

**Request Body:**
```json
{
  "server_url": "https://external-server.com/api",
  "sync_direction": "bidirectional|push|pull",
  "batch_size": 100
}
```

---

## Restaurant Staging Endpoints

### Query Staging Restaurants
**Endpoint:** `GET /api/restaurants-staging`  
**Purpose:** Search and filter staging restaurants with pagination

**Query Parameters:**
- `name`, `address`, `city`, `country`, `phone`, `website`: Text filters
- `latitude`, `longitude`, `tolerance`: Proximity search (tolerance in meters)
- `page`: Page number (default: 1)
- `per_page`: Results per page (default: 20, max: 100)

**Proximity Search Algorithm:**
```sql
WHERE (
  6371 * acos(
    cos(radians(%s)) * cos(radians(latitude)) * 
    cos(radians(longitude) - radians(%s)) + 
    sin(radians(%s)) * sin(radians(latitude))
  ) * 1000
) <= %s
```

**Response:**
```json
{
  "restaurants": [
    {
      "id": 1,
      "name": "Restaurant Name",
      "address": "123 Main St",
      "city": "New York",
      "country": "USA",
      "latitude": 40.7128,
      "longitude": -74.0060,
      "phone": "+1-555-0123",
      "website": "https://restaurant.com",
      "created_at": "2025-10-18T10:00:00Z",
      "updated_at": "2025-10-18T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 150,
    "pages": 8
  }
}
```

### Create/Update Staging Restaurant
**Endpoint:** `POST /api/restaurants-staging`  
**Purpose:** Upsert restaurant in staging table

**Request Body:**
```json
{
  "name": "Restaurant Name",
  "address": "123 Main St",
  "city": "New York",
  "country": "USA",
  "latitude": 40.7128,
  "longitude": -74.0060,
  "phone": "+1-555-0123",
  "website": "https://restaurant.com"
}
```

**Database Operation:**
```sql
INSERT INTO restaurants_staging (name, address, city, country, latitude, longitude, phone, website)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (name) DO UPDATE SET
  address = EXCLUDED.address,
  city = EXCLUDED.city,
  /* ... other fields ... */
  updated_at = NOW()
```

### Get Distinct Values
**Endpoint:** `GET /api/restaurants-staging/distinct/{field}`  
**Purpose:** Retrieve unique values for specified field

**Path Parameters:**
- `field`: One of `name`, `address`, `city`, `country`, `phone`, `website`

**Response:**
```json
{
  "field": "city",
  "values": ["New York", "Los Angeles", "Chicago"],
  "count": 3
}
```

---

## Web Interface Endpoints

### Main Application
**Endpoint:** `GET /`  
**Purpose:** Serve main application interface  
**Returns:** HTML template (`index.html`)

### Dashboard
**Endpoint:** `GET /dashboard`  
**Purpose:** Dashboard interface  
**Returns:** HTML template (`index.html`)

### File Upload
**Endpoint:** `POST /upload`  
**Purpose:** Process chat files for analysis  
**Content-Type:** `multipart/form-data`

**Supported File Types:**
- `.txt` - Plain text chat files
- `.xlsx`, `.xls` - Excel files with chat data

**Processing Pipeline:**
1. File validation and decoding
2. WhatsApp chat parsing
3. Persona analysis loading
4. Conversation extraction
5. Metrics generation
6. Restaurant recommendation extraction
7. Network data generation

**Response:**
```json
{
  "conversation_count": 150,
  "metrics": { /* conversation metrics */ },
  "recommendations": [ /* restaurant recommendations */ ],
  "network": { /* network visualization data */ },
  "persona_summary": { /* persona analysis */ },
  "conversation_summaries": [ /* PDF export data */ ],
  "sheet_restaurants": [ /* Excel restaurant data */ ],
  "excel_file_processed": true
}
```

### Analysis Endpoints
- **GET** `/conversation/{id}` - Get specific conversation data
- **GET** `/metrics` - Get conversation metrics
- **GET** `/recommendations` - Get restaurant recommendations
- **GET** `/network` - Get network visualization data
- **GET** `/personas` - Get persona analysis
- **GET** `/persona_summary` - Get persona summary
- **GET** `/debug_analysis` - Debug analysis interface
- **GET** `/debug_analysis/{id}` - Debug specific conversation
- **GET** `/sheet_restaurants` - Get Excel restaurant data

---

## Database Schema

### Core Tables

#### restaurants
```sql
CREATE TABLE restaurants (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  transcription TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  curator_id INTEGER REFERENCES curators(id),
  server_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### restaurants_json
```sql
CREATE TABLE restaurants_json (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  restaurant_id VARCHAR(255),
  server_id VARCHAR(255),
  restaurant_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### restaurants_staging
```sql
CREATE TABLE restaurants_staging (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  address TEXT,
  city VARCHAR(255),
  country VARCHAR(255),
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  phone VARCHAR(50),
  website VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### concept_categories
```sql
CREATE TABLE concept_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL
);
```

#### concepts
```sql
CREATE TABLE concepts (
  id SERIAL PRIMARY KEY,
  category_id INTEGER REFERENCES concept_categories(id),
  value VARCHAR(255) NOT NULL,
  UNIQUE(category_id, value)
);
```

#### restaurant_concepts
```sql
CREATE TABLE restaurant_concepts (
  id SERIAL PRIMARY KEY,
  restaurant_id INTEGER REFERENCES restaurants(id),
  concept_id INTEGER REFERENCES concepts(id),
  UNIQUE(restaurant_id, concept_id)
);
```

#### curators
```sql
CREATE TABLE curators (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Indexes
```sql
CREATE INDEX idx_restaurants_name ON restaurants(name);
CREATE INDEX idx_restaurants_server_id ON restaurants(server_id);
CREATE INDEX idx_restaurants_staging_name ON restaurants_staging(name);
CREATE INDEX idx_restaurants_staging_location ON restaurants_staging(latitude, longitude);
CREATE INDEX idx_restaurant_concepts_restaurant_id ON restaurant_concepts(restaurant_id);
CREATE INDEX idx_restaurant_concepts_concept_id ON restaurant_concepts(concept_id);
```

---

## Response Formats

### Success Response Template
```json
{
  "status": "success",
  "message": "Operation completed successfully",
  "data": { /* response data */ },
  "timestamp": "2025-10-18T10:00:00Z"
}
```

### Error Response Template
```json
{
  "status": "error",
  "message": "Human-readable error message",
  "details": "Technical error details",
  "timestamp": "2025-10-18T10:00:00Z"
}
```

### Pagination Response Template
```json
{
  "data": [ /* paginated results */ ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 150,
    "pages": 8,
    "has_next": true,
    "has_prev": false
  }
}
```

---

## Technical Implementation Notes

### Database Connection Management
- Connection pooling with `psycopg2`
- 10-second connection timeout
- Automatic connection cleanup in `finally` blocks
- Transaction rollback on errors

### Error Handling Strategy
- Comprehensive try-catch blocks
- Detailed logging with request context
- Graceful degradation for non-critical failures
- Database transaction integrity

### Performance Considerations
- Efficient SQL queries with proper joins
- Pagination for large datasets
- Proximity search optimization
- JSON document indexing for fast retrieval

### Security Measures
- SQL injection prevention via parameterized queries
- Input validation and sanitization
- Content-type verification
- Request size limitations

### Logging
```python
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

All endpoints include comprehensive logging for debugging and monitoring purposes.