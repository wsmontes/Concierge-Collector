# ApiService V3 - Complete Specification

**File:** `scripts/apiService.js`  
**Version:** 3.0.0  
**Date:** November 18, 2025  
**Purpose:** Unified API client for V3 FastAPI backend

---

## Overview

The ApiService is the single point of communication between the Concierge Collector frontend and the FastAPI V3 backend. It handles all HTTP requests, authentication, error handling, and data transformation.

---

## Key Responsibilities

### 1. Authentication Management
- Store and retrieve V3 API key from localStorage
- Attach `X-API-Key` header to write operations (POST, PATCH, DELETE)
- Validate API key against server

### 2. HTTP Communication
- Make HTTP requests to V3 API endpoints
- Handle timeouts and retries
- Parse responses and errors
- Support multipart/form-data for file uploads

### 3. Optimistic Locking
- Attach `If-Match` header with current version
- Handle version conflicts (409 responses)
- Increment version on successful updates

### 4. Error Handling
- Map HTTP status codes to user-friendly messages
- Parse FastAPI error responses
- Provide detailed error information to callers
- Log all errors for debugging

### 5. Entity Management (CRUD)
- Create entity (POST with upsert logic)
- Read entity (GET by ID)
- Update entity (PATCH with version check)
- Delete entity (DELETE)
- List/search entities (GET with filters)

### 6. Curation Management (CRUD)
- Create curation (POST)
- Read curation (GET by ID)
- Update curation (PATCH with version check)
- Delete curation (DELETE)
- List/search curations (GET with filters)
- Get entity's curations (GET by entity_id)

### 7. AI Services Integration
- Transcribe audio files (Whisper API)
- Extract concepts from text (GPT-4)
- Analyze images (GPT-4 Vision)

### 8. Google Places Integration
- Search places by query/location
- Get place details by place_id

### 9. Concept Matching
- Match free-text concepts to categories

### 10. System Utilities
- Get API info
- Check API health
- Validate connectivity

---

## Class Structure

```javascript
class ApiService {
    // Properties
    log: Logger
    baseUrl: string
    timeout: number
    retryAttempts: number
    retryDelay: number
    isInitialized: boolean
    
    // Initialization
    async initialize()
    
    // Authentication
    getApiKey()
    setApiKey(apiKey)
    removeApiKey()
    getAuthHeaders()
    async validateApiKey()
    
    // Core HTTP
    async request(method, endpoint, options)
    async handleErrorResponse(response)
    
    // System
    async getInfo()
    async checkHealth()
    
    // Entities
    async createEntity(entity)
    async getEntity(entityId)
    async listEntities(filters)
    async updateEntity(entityId, updates, currentVersion)
    async deleteEntity(entityId)
    async searchEntities(filters)
    
    // Curations
    async createCuration(curation)
    async getCuration(curationId)
    async listCurations(filters)
    async getEntityCurations(entityId)
    async updateCuration(curationId, updates, currentVersion)
    async deleteCuration(curationId)
    async searchCurations(filters)
    
    // Concepts
    async matchConcepts(concepts)
    
    // AI Services
    async transcribeAudio(audioBlob, language)
    async extractConcepts(text, entityType)
    async analyzeImage(imageBlob, prompt)
    
    // Places
    async searchPlaces(query, location, radius)
    async getPlaceDetails(placeId)
    
    // Utilities
    async isApiAvailable()
    async getStatus()
}
```

---

## Method Details

### initialize()
**Purpose:** Initialize the service, check API key, test connection  
**Returns:** `Promise<this>`  
**Side Effects:** Sets `isInitialized = true`, logs status

**Example:**
```javascript
await ApiService.initialize();
```

---

### getApiKey()
**Purpose:** Retrieve V3 API key from localStorage  
**Returns:** `string | null`  
**Storage Key:** `api_key_v3`

**Example:**
```javascript
const apiKey = ApiService.getApiKey();
if (!apiKey) {
    // Prompt user for API key
}
```

---

### setApiKey(apiKey)
**Purpose:** Store V3 API key in localStorage  
**Parameters:** `apiKey: string`  
**Side Effects:** Saves to localStorage, logs success

**Example:**
```javascript
ApiService.setApiKey('your-api-key-here');
```

---

### getAuthHeaders()
**Purpose:** Build authentication headers for requests  
**Returns:** `Object` - Headers object with X-API-Key

**Example:**
```javascript
const headers = ApiService.getAuthHeaders();
// { "X-API-Key": "your-api-key" }
```

---

### request(method, endpoint, options)
**Purpose:** Core HTTP request method  
**Parameters:**
- `method: string` - HTTP method (GET, POST, PATCH, DELETE)
- `endpoint: string` - Endpoint key or path
- `options: Object` - Fetch options (headers, body, etc.)

**Returns:** `Promise<Response>`  
**Throws:** Error on HTTP errors

**Auto-adds:**
- Content-Type: application/json (unless multipart)
- X-API-Key header for write operations

**Example:**
```javascript
const response = await ApiService.request('GET', 'entities');
const data = await response.json();
```

---

### handleErrorResponse(response)
**Purpose:** Parse and throw user-friendly errors  
**Parameters:** `response: Response`  
**Throws:** Error with descriptive message

**Status Code Mappings:**
- 401 → "API key is invalid or missing"
- 404 → "Resource not found"
- 409 → "Version conflict - data was modified by another user"
- 422 → "Validation error - check your input data"
- 428 → "Version information required for update"
- 500 → "Server error - please try again later"

---

### createEntity(entity)
**Purpose:** Create or upsert entity  
**Parameters:** `entity: Object` - Entity data with entity_id  
**Returns:** `Promise<Object>` - Created/updated entity  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
const entity = {
    entity_id: 'uuid-here',
    type: 'restaurant',
    name: 'Restaurant Name',
    data: { /* ... */ }
};
const created = await ApiService.createEntity(entity);
console.log(created.version); // 1
```

---

### getEntity(entityId)
**Purpose:** Get entity by ID  
**Parameters:** `entityId: string`  
**Returns:** `Promise<Object>` - Entity data  
**Auth:** Not required

**Example:**
```javascript
const entity = await ApiService.getEntity('uuid-here');
console.log(entity.name, entity.version);
```

---

### listEntities(filters)
**Purpose:** List entities with pagination  
**Parameters:** `filters: Object`
- `type?: string` - Filter by type
- `status?: string` - Filter by status
- `limit?: number` - Results per page
- `offset?: number` - Pagination offset

**Returns:** `Promise<Object>` - Paginated response

**Example:**
```javascript
const result = await ApiService.listEntities({
    type: 'restaurant',
    status: 'active',
    limit: 20,
    offset: 0
});
console.log(result.items, result.total);
```

---

### updateEntity(entityId, updates, currentVersion)
**Purpose:** Update entity with optimistic locking  
**Parameters:**
- `entityId: string`
- `updates: Object` - Partial update data
- `currentVersion: number` - Current version for If-Match

**Returns:** `Promise<Object>` - Updated entity  
**Auth:** Required (X-API-Key + If-Match)  
**Throws:** Error on 409 (version conflict)

**Example:**
```javascript
// First, get current entity
const entity = await ApiService.getEntity('uuid-here');

// Then update with version check
const updated = await ApiService.updateEntity(
    'uuid-here',
    { name: 'New Name' },
    entity.version  // Current version
);
console.log(updated.version); // version + 1
```

---

### deleteEntity(entityId)
**Purpose:** Delete entity  
**Parameters:** `entityId: string`  
**Returns:** `Promise<void>`  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
await ApiService.deleteEntity('uuid-here');
```

---

### createCuration(curation)
**Purpose:** Create curation  
**Parameters:** `curation: Object` - Curation data  
**Returns:** `Promise<Object>` - Created curation  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
const curation = {
    curation_id: 'uuid-here',
    entity_id: 'entity-uuid',
    curator: { id: 'curator-uuid', name: 'Name' },
    content: { transcription: 'Text here' },
    concepts: [{ category: 'Cuisine', value: 'Italian' }]
};
const created = await ApiService.createCuration(curation);
```

---

### getEntityCurations(entityId)
**Purpose:** Get all curations for an entity  
**Parameters:** `entityId: string`  
**Returns:** `Promise<Array>` - List of curations  
**Auth:** Not required

**Example:**
```javascript
const curations = await ApiService.getEntityCurations('entity-uuid');
curations.forEach(c => console.log(c.content.transcription));
```

---

### updateCuration(curationId, updates, currentVersion)
**Purpose:** Update curation with optimistic locking  
**Parameters:**
- `curationId: string`
- `updates: Object`
- `currentVersion: number`

**Returns:** `Promise<Object>`  
**Auth:** Required (X-API-Key + If-Match)

**Example:**
```javascript
const updated = await ApiService.updateCuration(
    'curation-uuid',
    { status: 'published' },
    2  // Current version
);
```

---

### transcribeAudio(audioBlob, language)
**Purpose:** Transcribe audio using Whisper API  
**Parameters:**
- `audioBlob: Blob` - Audio file
- `language?: string` - Language code (default: 'pt')

**Returns:** `Promise<Object>` - { text, language, duration }  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
const result = await ApiService.transcribeAudio(audioBlob, 'pt');
console.log(result.text);
```

---

### extractConcepts(text, entityType)
**Purpose:** Extract concepts from text using GPT-4  
**Parameters:**
- `text: string` - Text to analyze
- `entityType?: string` - Entity type (default: 'restaurant')

**Returns:** `Promise<Object>` - { concepts: [...] }  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
const result = await ApiService.extractConcepts(
    'Excellent Italian restaurant with great wine selection',
    'restaurant'
);
result.concepts.forEach(c => {
    console.log(c.category, c.value, c.confidence);
});
```

---

### analyzeImage(imageBlob, prompt)
**Purpose:** Analyze image using GPT-4 Vision  
**Parameters:**
- `imageBlob: Blob` - Image file
- `prompt: string` - Analysis prompt

**Returns:** `Promise<Object>` - { analysis, details }  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
const result = await ApiService.analyzeImage(
    imageBlob,
    'Describe this restaurant interior'
);
console.log(result.analysis);
```

---

### searchPlaces(query, location, radius)
**Purpose:** Search Google Places  
**Parameters:**
- `query: string` - Search query
- `location?: string` - Lat,lng
- `radius?: number` - Radius in meters

**Returns:** `Promise<Object>` - { results: [...] }  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
const result = await ApiService.searchPlaces(
    'italian restaurant',
    '-23.5505,-46.6333',
    5000
);
result.results.forEach(place => {
    console.log(place.name, place.rating);
});
```

---

### getPlaceDetails(placeId)
**Purpose:** Get Google Place details  
**Parameters:** `placeId: string` - Google Place ID  
**Returns:** `Promise<Object>` - Place details  
**Auth:** Required (X-API-Key)

**Example:**
```javascript
const place = await ApiService.getPlaceDetails('ChIJ...');
console.log(place.name, place.formatted_address);
```

---

## Error Handling Pattern

All methods follow this error handling pattern:

```javascript
try {
    const result = await ApiService.someMethod();
    // Handle success
} catch (error) {
    // error.message contains user-friendly message
    if (error.message.includes('API key')) {
        // Prompt for API key
    } else if (error.message.includes('Version conflict')) {
        // Handle conflict resolution
    } else if (error.message.includes('not found')) {
        // Handle 404
    } else {
        // Generic error handling
    }
}
```

---

## Optimistic Locking Pattern

```javascript
// Pattern for updates with version check
async function updateEntitySafely(entityId, updates) {
    // Step 1: Get current entity
    const entity = await ApiService.getEntity(entityId);
    
    // Step 2: Update with version
    try {
        const updated = await ApiService.updateEntity(
            entityId,
            updates,
            entity.version
        );
        return updated;
    } catch (error) {
        if (error.message.includes('Version conflict')) {
            // Conflict detected - show resolution UI
            return handleConflict(entity, updates);
        }
        throw error;
    }
}
```

---

## Dependencies

- **ModuleWrapper** - Module definition pattern
- **Logger** - Logging service
- **AppConfig** - Configuration service
- **fetch API** - Native browser API
- **FormData** - Native browser API for file uploads

---

## Integration Points

### With DataStorage
```javascript
// Save entity locally then sync to server
const entity = await DataStorage.getEntity(entityId);
const synced = await ApiService.updateEntity(
    entity.entity_id,
    entity,
    entity.version
);
await DataStorage.saveEntity(synced);
```

### With SyncManager
```javascript
// Sync manager uses ApiService for all server operations
await SyncManager.pullEntities(); // Uses listEntities()
await SyncManager.pushEntity(entity); // Uses createEntity/updateEntity()
```

### With UI Modules
```javascript
// UI calls ApiService directly for immediate operations
const entity = await ApiService.createEntity(formData);
showSuccessMessage('Entity created!');
```

---

## Testing Checklist

- [ ] Initialize without API key (should warn but not fail)
- [ ] Initialize with API key (should succeed)
- [ ] Validate API key (valid vs invalid)
- [ ] Create entity (with and without API key)
- [ ] Get entity (should work without API key)
- [ ] Update entity with correct version (should succeed)
- [ ] Update entity with old version (should throw 409)
- [ ] Update entity without If-Match (should throw 428)
- [ ] Delete entity (should require API key)
- [ ] List entities with filters
- [ ] Create curation
- [ ] Get entity curations
- [ ] Transcribe audio
- [ ] Extract concepts
- [ ] Analyze image
- [ ] Search places
- [ ] Get place details
- [ ] Handle network errors
- [ ] Handle 401 (invalid API key)
- [ ] Handle 404 (not found)
- [ ] Handle 409 (version conflict)
- [ ] Handle 500 (server error)

---

## Performance Considerations

1. **Caching:** ApiService does NOT cache responses - that's DataStorage's job
2. **Retries:** Configure retry logic in AppConfig
3. **Timeouts:** Set appropriate timeouts for different operations
4. **Batching:** For bulk operations, use loops with rate limiting
5. **Concurrency:** Limit concurrent requests to avoid overwhelming server

---

## Security Considerations

1. **API Key Storage:** Stored in localStorage (not secure for production)
2. **HTTPS Only:** API should only be accessed over HTTPS in production
3. **Key Rotation:** Implement key rotation mechanism
4. **Error Messages:** Don't expose sensitive info in error messages
5. **Input Validation:** Validate data before sending to API

---

## Future Enhancements

1. Request deduplication
2. Response caching with TTL
3. Request queueing for offline mode
4. Retry with exponential backoff
5. Request cancellation support
6. Progress tracking for uploads
7. Websocket support for real-time updates
8. Request interceptors for logging/debugging
9. Response transformers
10. Batch operations endpoint

---

**This specification serves as the complete reference for implementing apiService.js V3.**
