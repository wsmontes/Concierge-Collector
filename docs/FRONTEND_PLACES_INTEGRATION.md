# Frontend Integration - Places Orchestration

## Changes Summary

### New Files Created

#### 1. `scripts/services/PlacesOrchestrationService.js`
**Purpose:** Unified service for all Google Places operations via backend orchestration endpoint

**Key Features:**
- Single entry point for all Places operations
- Automatic operation detection (nearby, text search, details, bulk)
- Built-in caching (5-minute TTL)
- Legacy format conversion for backwards compatibility
- Performance metrics tracking

**API Methods:**
```javascript
// Nearby search
await PlacesOrchestrationService.searchNearby({
    latitude: -23.5,
    longitude: -46.6,
    radius: 1000,
    types: ['restaurant'],
    maxResults: 20,
    minRating: 4.0
});

// Text search
await PlacesOrchestrationService.searchByText({
    query: 'pizza restaurant',
    latitude: -23.5,
    longitude: -46.6,
    maxResults: 10
});

// Single place details
await PlacesOrchestrationService.getPlaceDetails('ChIJ...');

// Bulk details
await PlacesOrchestrationService.getBulkDetails(['ChIJ1...', 'ChIJ2...']);

// Multi-operation
await PlacesOrchestrationService.multiOperation([
    {query: 'pizza', maxResults: 5},
    {query: 'sushi', maxResults: 5}
], {latitude: -23.5, longitude: -46.6});
```

### Modified Files

#### 1. `index.html`
**Change:** Added script tag for PlacesOrchestrationService

```html
<!-- Places Orchestration Service (Unified API endpoint) -->
<script src="scripts/services/PlacesOrchestrationService.js"></script>
```

**Location:** After PlacesService.js, before PlacesAutomation.js

#### 2. `scripts/modules/placesModule.js`
**Change:** Updated `searchPlaces()` method to use orchestration service

**Behavior:**
1. **Primary:** Uses `PlacesOrchestrationService` if available
2. **Fallback:** Uses Google Maps JavaScript API if orchestration unavailable
3. **Automatic:** Detects which service to use at runtime

**Benefits:**
- Backend handles API key management
- Better rate limiting
- Automatic caching
- Bulk operation support
- Consistent error handling

**Implementation:**
```javascript
if (window.PlacesOrchestrationService) {
    // Use backend orchestration (preferred)
    const response = await window.PlacesOrchestrationService.searchNearby({
        latitude: this.currentLatitude,
        longitude: this.currentLongitude,
        radius: radius,
        types: types,
        maxResults: 20,
        minRating: minRating
    });
    
    // Convert to legacy format for compatibility
    const legacyResults = window.PlacesOrchestrationService.toLegacyFormat(response.results);
    this.displaySearchResults(legacyResults);
    
} else {
    // Fallback to Google Maps API
    this.placesService.nearbySearch(request, callback);
}
```

## Architecture

### Before (Direct Google API)
```
Frontend → Google Maps JavaScript API → Google Places API
```

**Issues:**
- API key exposed in frontend
- No centralized rate limiting
- No caching
- Limited bulk operations
- Client-side only

### After (Orchestration)
```
Frontend → PlacesOrchestrationService → Backend API → Google Places API
                                              ↓
                                         Caching
                                         Rate Limiting
                                         Bulk Processing
```

**Benefits:**
- ✅ API key secure on backend
- ✅ Centralized rate limiting
- ✅ Response caching (5min TTL)
- ✅ Bulk operations support
- ✅ Multi-operation support
- ✅ Consistent error handling
- ✅ Performance metrics

## Migration Strategy

### Phase 1: ✅ Core Search (Completed)
- [x] Created PlacesOrchestrationService
- [x] Updated placesModule.js searchPlaces()
- [x] Added to index.html
- [x] Maintains backwards compatibility

### Phase 2: Advanced Features (Recommended)
- [ ] Update PlacesAutomation.js to use orchestration
- [ ] Add bulk entity enrichment
- [ ] Implement multi-cuisine search
- [ ] Add place comparison features

### Phase 3: Optimization (Future)
- [ ] Remove Google Maps JavaScript API dependency
- [ ] Migrate all Places operations to orchestration
- [ ] Implement frontend-side result aggregation
- [ ] Add advanced caching strategies

## Testing

### Test Scenarios

1. **Basic Nearby Search**
```javascript
// Open browser console
const service = window.PlacesOrchestrationService;
const results = await service.searchNearby({
    latitude: -23.561684,
    longitude: -46.655981,
    radius: 1000,
    types: ['restaurant']
});
console.log(results);
```

2. **Text Search**
```javascript
const results = await service.searchByText({
    query: 'italian restaurant',
    latitude: -23.561684,
    longitude: -46.655981
});
console.log(results);
```

3. **Cache Test**
```javascript
// First call (cache miss)
await service.searchNearby({latitude: -23.5, longitude: -46.6, radius: 500});

// Second call (cache hit)
await service.searchNearby({latitude: -23.5, longitude: -46.6, radius: 500});

// Check metrics
console.log(service.getMetrics());
```

4. **Fallback Test**
```javascript
// Temporarily disable orchestration
const temp = window.PlacesOrchestrationService;
window.PlacesOrchestrationService = null;

// Should fallback to Google Maps API
await placesModule.searchPlaces();

// Restore
window.PlacesOrchestrationService = temp;
```

## Configuration

### Backend Endpoint
Default: `http://localhost:8000/api/v3/places/orchestrate`

To change, update `AppConfig.apiBaseUrl`:
```javascript
window.AppConfig = {
    apiBaseUrl: 'https://your-domain.com'
};
```

### Cache TTL
Default: 5 minutes

To change:
```javascript
PlacesOrchestrationService.cacheTTL = 10 * 60 * 1000; // 10 minutes
```

### Clear Cache
```javascript
PlacesOrchestrationService.clearCache();
```

## Performance Metrics

Access metrics:
```javascript
const metrics = PlacesOrchestrationService.getMetrics();
console.log(metrics);
// {
//   requests: 42,
//   errors: 0,
//   cacheHits: 15,
//   cacheSize: 8,
//   cacheHitRate: "26.32%"
// }
```

## Error Handling

All methods throw errors with descriptive messages:

```javascript
try {
    const results = await service.searchNearby({...});
} catch (error) {
    console.error('Search failed:', error.message);
    // Display user-friendly message
}
```

Common errors:
- `API error 400: Invalid request` - Check parameters
- `API error 500: Internal error` - Backend issue
- `Network error` - Connection problem
- `Timeout` - Request took too long

## Backwards Compatibility

The integration maintains full backwards compatibility:

1. **Legacy Format:** Results converted to Google Maps API format
2. **Fallback Support:** Automatically uses Google Maps API if orchestration unavailable
3. **Existing Code:** No changes required to result display/processing
4. **Gradual Migration:** Can migrate features one at a time

## Next Steps

### Immediate
1. Test search functionality in UI
2. Verify cache is working
3. Monitor performance metrics

### Short Term
1. Update PlacesAutomation.js
2. Implement bulk entity updates
3. Add multi-operation searches

### Long Term
1. Remove Google Maps API dependency
2. Implement advanced caching
3. Add request batching
4. Optimize for mobile

## Benefits Summary

| Aspect | Before | After |
|--------|--------|-------|
| API Key | Exposed in frontend | Secure on backend |
| Rate Limiting | Client-side only | Centralized backend |
| Caching | None | 5-minute TTL |
| Bulk Operations | Not supported | Full support |
| Error Handling | Inconsistent | Unified |
| Performance | Direct API calls | Cached + optimized |
| Scalability | Limited | Highly scalable |

## Documentation

- **API Docs:** `/api/v3/docs` (Swagger UI)
- **Backend Spec:** `concierge-api-v3/docs/PLACES_ORCHESTRATION.md`
- **Bulk Operations:** `concierge-api-v3/docs/PLACES_BULK_OPERATIONS.md`
