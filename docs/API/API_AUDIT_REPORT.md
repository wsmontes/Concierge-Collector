# API Interaction Audit Report
**Date:** October 19, 2025  
**Application:** Concierge Collector  
**Purpose:** Comprehensive audit of all API interactions and standardization recommendations

---

## Executive Summary

The application interacts with **three primary external APIs** and one internal API:

1. **Concierge Parser API** (Internal Backend) - Restaurant CRUD & Sync
2. **OpenAI API** - Whisper (transcription) and GPT-4 (analysis)
3. **Google Maps/Places API** - Restaurant search and data import
4. **Michelin Guide** (via Concierge Parser) - Staging data

### Current State Assessment

**Issues Identified:**
- ❌ **API Pattern Duplication**: Both `apiService.js` and `apiHandler.js` exist with overlapping functionality
- ❌ **Inconsistent Error Handling**: Some modules use direct `fetch()`, bypassing centralized error handling
- ❌ **Hardcoded URLs**: Multiple files contain hardcoded API endpoints
- ❌ **Multiple OpenAI Integration Points**: OpenAI API called directly from 4+ different modules
- ❌ **No Centralized Configuration**: API keys and endpoints scattered across files
- ⚠️ **Legacy syncService.js**: Old sync service file still exists alongside newer syncManager.js

**Strengths:**
- ✅ Well-structured `apiService.js` with retry logic and timeout handling
- ✅ Comprehensive error messages in `apiService.js`
- ✅ Good separation between sync logic and API calls in `syncManager.js`

---

## Detailed API Inventory

### 1. Concierge Parser API (Backend)
**Base URL:** `https://wsmontes.pythonanywhere.com/api`

#### Files Making Calls:
| File | Methods Used | Pattern | Issues |
|------|-------------|---------|---------|
| `apiService.js` | GET, POST, PUT, DELETE | ✅ Centralized | None |
| `apiHandler.js` | POST, PUT | ⚠️ Duplicate | Redundant with apiService |
| `syncManager.js` | Via apiService | ✅ Correct | None |
| `syncService.js` | Direct fetch() | ❌ Legacy | Should be removed |
| `exportImportModule.js` | Via apiService | ✅ Correct | None |
| `michelinStagingModule.js` | Direct fetch() | ⚠️ Mixed | Should use apiService |

#### Endpoints Used:
```
GET    /restaurants              - List all restaurants
GET    /restaurants/{id}         - Get single restaurant
POST   /restaurants/batch        - Batch upload restaurants
PUT    /restaurants/{id}         - Update restaurant
DELETE /restaurants/{id}         - Delete restaurant
POST   /curators                 - Create curator
GET    /restaurants-staging      - Michelin staging list
POST   /restaurants-staging/{name}/approve - Approve Michelin restaurant
```

#### Hardcoded Occurrences:
- `apiService.js:20` - `this.baseUrl = 'https://wsmontes.pythonanywhere.com/api'`
- `apiHandler.js:17` - `this.serverBase = 'https://wsmontes.pythonanywhere.com'`
- `syncService.js:11` - `this.apiBase = 'https://wsmontes.pythonanywhere.com/api'`
- `michelinStagingModule.js:13` - `this.apiEndpoint = 'https://wsmontes.pythonanywhere.com/api/restaurants-staging'`
- `exportImportModule.js:1031` - Hardcoded in console.log

---

### 2. OpenAI API
**Base URL:** `https://api.openai.com/v1`

#### Files Making Direct Calls:
| File | Endpoint | Purpose | Pattern |
|------|----------|---------|---------|
| `apiService.js` | `/audio/transcriptions` | Transcription | ✅ Centralized |
| `apiService.js` | `/chat/completions` | GPT Analysis | ✅ Centralized |
| `apiHandler.js` | `/audio/transcriptions` | Transcription | ❌ Duplicate |
| `apiHandler.js` | `/chat/completions` | Translation & Concepts | ❌ Duplicate |
| `conceptModule.js:1086` | `/chat/completions` | Generate descriptions | ❌ Direct fetch |
| `conceptModule.js:1138` | `/chat/completions` | Extract concepts | ❌ Direct fetch |
| `conceptModule.js:1765` | `/chat/completions` | (Unknown use) | ❌ Direct fetch |
| `conceptModule.js:1851` | `/chat/completions` | (Unknown use) | ❌ Direct fetch |
| `recordingModule.js:1470` | `/audio/translations` | Audio translation | ❌ Direct fetch |

#### API Key Storage:
- **Primary:** `localStorage.getItem('openai_api_key')`
- **Also stored in:** `apiService.openAiKey`, `apiHandler.apiKey`
- **Access pattern:** Multiple modules read directly from localStorage

#### Issues:
1. **No centralization**: 5 different files make direct OpenAI API calls
2. **Duplicate logic**: Error handling and request formatting repeated
3. **Inconsistent patterns**: Some use apiService, others use direct fetch()
4. **No rate limiting**: Each module makes independent calls

---

### 3. Google Maps/Places API
**Base URL:** `https://maps.googleapis.com/maps/api/place`

#### Files Making Calls:
| File | Purpose | Pattern |
|------|---------|---------|
| `placesModule.js` | Restaurant search & import | ⚠️ Google SDK + direct fetch |
| `michelinStagingModule.js` | Maps integration | ⚠️ Direct fetch |

#### API Key Storage:
- **Primary:** `localStorage.getItem('google_places_api_key')`
- **Also:** Stored in `dataStorage` settings table
- **Access pattern:** Module-level management

#### Integration Method:
- Uses Google Maps JavaScript SDK loaded via script tag
- Some direct API calls for details/photos
- Hybrid approach mixing SDK and REST API

---

## API Configuration Audit

### Current Configuration Locations:

```javascript
// apiService.js
this.baseUrl = 'https://wsmontes.pythonanywhere.com/api';
this.timeout = 30000;
this.maxRetries = 3;
this.retryDelay = 1000;
this.openAiKey = localStorage.getItem('openai_api_key');

// apiHandler.js  
this.serverBase = 'https://wsmontes.pythonanywhere.com';
this.apiKey = localStorage.getItem('openai_api_key');

// syncService.js
this.apiBase = 'https://wsmontes.pythonanywhere.com/api';

// michelinStagingModule.js
this.apiEndpoint = 'https://wsmontes.pythonanywhere.com/api/restaurants-staging';

// placesModule.js
this.apiEndpoint = 'https://maps.googleapis.com/maps/api/place';

// Multiple modules
localStorage.getItem('openai_api_key')
localStorage.getItem('google_places_api_key')
```

### ❌ Problems:
1. No centralized config file
2. Hardcoded URLs in 5+ files
3. Timeouts and retry logic not consistent
4. No environment-based configuration (dev vs prod)

---

## Error Handling Patterns

### apiService.js ✅ (Good)
```javascript
- Timeout handling with AbortController
- Automatic retries (3 attempts)
- User-friendly error messages
- Comprehensive logging
- Network error detection
```

### Direct fetch() calls ❌ (Inconsistent)
```javascript
// conceptModule.js example - Basic error handling
try {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
    }
    return await response.json();
} catch (error) {
    console.error('Error:', error);
    throw error;
}
```

**Issues:**
- No retry logic
- No timeout handling
- Inconsistent error messages
- No network error detection
- Each module reimplements error handling

---

## Response Format Analysis

### apiService.js Response Format ✅
```javascript
{
    success: boolean,
    data: any,
    status: number,
    error?: string
}
```

### Direct fetch() Response Format ⚠️
```javascript
// Varies by module:
- Some return raw response.json()
- Some return { success, data, error }
- Some throw errors directly
- Inconsistent error objects
```

---

## Recommendations for Standardization

### Priority 1: Critical Issues

#### 1.1 Remove Duplicate API Handlers
**Action:** Consolidate `apiHandler.js` functionality into `apiService.js`
- Move OpenAI transcription/analysis methods to apiService
- Update all modules to use apiService exclusively
- Delete apiHandler.js

#### 1.2 Remove Legacy Sync Service
**Action:** Delete `syncService.js`
- Already replaced by `syncManager.js`
- No longer referenced in index.html
- Remove file completely

#### 1.3 Centralize All OpenAI Calls
**Action:** Route all OpenAI API calls through `apiService.js`
- Update conceptModule.js to use apiService.analyzeWithGPT()
- Update recordingModule.js to use apiService.transcribeAudio()
- Remove direct fetch() calls to OpenAI API
- Ensure consistent error handling

#### 1.4 Create Centralized Configuration
**Action:** Create `scripts/config.js`
```javascript
const AppConfig = {
    api: {
        backend: {
            baseUrl: 'https://wsmontes.pythonanywhere.com/api',
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 1000
        },
        openai: {
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-4',
            whisperModel: 'whisper-1',
            timeout: 60000
        },
        googlePlaces: {
            baseUrl: 'https://maps.googleapis.com/maps/api/place',
            timeout: 10000
        }
    },
    storage: {
        keys: {
            openaiApiKey: 'openai_api_key',
            googlePlacesApiKey: 'google_places_api_key'
        }
    }
};
```

### Priority 2: Enhancements

#### 2.1 Standardize All API Calls
**Pattern to enforce:**
```javascript
// ✅ Correct - Use apiService
const result = await apiService.getRestaurants();
if (result.success) {
    // Handle success
} else {
    // Handle error: result.error
}

// ❌ Wrong - Direct fetch
const response = await fetch(url);
```

#### 2.2 Add API Request Queue
**Purpose:** Prevent rate limiting and manage concurrent requests
- Implement request queue in apiService
- Add configurable rate limits per API
- Queue requests when limit reached

#### 2.3 Enhance Error Reporting
**Add:**
- Error codes for different failure types
- Detailed error context
- User-actionable error messages
- Error tracking/analytics

#### 2.4 Add Request/Response Interceptors
**Purpose:** Cross-cutting concerns
- Authentication header injection
- Request/response logging
- Performance monitoring
- Error tracking

### Priority 3: Documentation

#### 3.1 API Standards Documentation
Create `docs/api_standards.md` with:
- Required patterns for all API calls
- Error handling guidelines
- Response format specifications
- Configuration management rules

#### 3.2 API Integration Guide
Create `docs/api_integration_guide.md` with:
- How to add new API endpoints
- How to make API calls correctly
- Common patterns and examples
- Troubleshooting guide

---

## Standardization Checklist

### Configuration
- [ ] Create centralized config.js
- [ ] Update all files to use centralized config
- [ ] Remove hardcoded URLs
- [ ] Add environment detection (dev/prod)

### Code Cleanup
- [ ] Delete apiHandler.js
- [ ] Delete syncService.js
- [ ] Remove all direct fetch() calls to OpenAI
- [ ] Consolidate OpenAI logic in apiService

### Pattern Enforcement
- [ ] All API calls through apiService
- [ ] Consistent error handling everywhere
- [ ] Standardized response format
- [ ] Proper timeout and retry logic

### Testing
- [ ] Test all API endpoints still work
- [ ] Verify error handling works
- [ ] Test retry logic
- [ ] Test timeout handling

### Documentation
- [ ] Create API standards doc
- [ ] Create API integration guide
- [ ] Update README with API info
- [ ] Add inline code comments

---

## Files Requiring Updates

### High Priority (Must Fix)
1. `scripts/conceptModule.js` - Replace 4 direct OpenAI fetch() calls
2. `scripts/recordingModule.js` - Replace OpenAI audio translation call
3. `scripts/apiHandler.js` - Delete (move to apiService)
4. `scripts/syncService.js` - Delete (legacy file)
5. `scripts/michelinStagingModule.js` - Use apiService for backend calls

### Medium Priority (Should Fix)
6. `scripts/exportImportModule.js` - Remove hardcoded URL in console.log
7. All modules - Use centralized config instead of localStorage direct access
8. `scripts/placesModule.js` - Standardize API key management

### Low Priority (Nice to Have)
9. Add request interceptors in apiService
10. Add response caching where appropriate
11. Add API call analytics/monitoring

---

## Estimated Impact

**Files to Update:** 8 files  
**Files to Delete:** 2 files  
**New Files to Create:** 2 files (config.js, api_standards.md)  
**Lines of Code to Change:** ~500-800 lines  
**Time Estimate:** 4-6 hours for complete standardization  
**Risk Level:** Medium (requires thorough testing)

---

## Next Steps

1. **Create config.js** - Centralized configuration
2. **Update apiService.js** - Add missing OpenAI methods from apiHandler
3. **Update conceptModule.js** - Use apiService instead of direct fetch
4. **Update recordingModule.js** - Use apiService for transcription
5. **Delete apiHandler.js** - No longer needed
6. **Delete syncService.js** - Legacy file
7. **Test thoroughly** - Ensure all API interactions still work
8. **Create documentation** - API standards and integration guide

---

**Status:** Audit Complete - Ready for Standardization Implementation
