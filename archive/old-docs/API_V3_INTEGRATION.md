# Concierge API V3 Integration Summary

## Overview

The Concierge Collector application has been updated to support the new **Concierge API V3** while maintaining backward compatibility with the existing V2 API. This document summarizes the integration work completed.

## What's New in API V3

### Key Features
- **Document-oriented storage** with JSON fields
- **Optimistic locking** using ETags for conflict prevention
- **JSON Merge Patch** (RFC 7396) for partial updates
- **Entities and Curations** model instead of just restaurants
- **Flexible query DSL** for advanced searches
- **Better error handling** and validation

### API Structure
- **Entities**: Represent restaurants, users, admins, or system objects
- **Curations**: Represent reviews, recommendations, or analysis of entities
- **Optimistic Locking**: Uses ETags to prevent conflicting updates
- **Partial Updates**: Only send fields that changed

## Integration Implementation

### 1. Updated ApiService (`scripts/apiService.js`)

**New V3 Methods Added:**

#### System Operations
- `v3Health()` - Health check
- `v3Info()` - API information
- `testConnectivity()` - Test both V2 and V3 API connectivity

#### Entity Operations
- `v3CreateEntity(entityData)` - Create entity
- `v3GetEntity(entityId)` - Get entity by ID
- `v3UpdateEntity(entityId, updates, etag)` - Partial update with optimistic locking
- `v3DeleteEntity(entityId)` - Delete entity
- `v3GetEntities(params)` - List/search entities

#### Curation Operations
- `v3CreateCuration(curationData)` - Create curation
- `v3GetCuration(curationId)` - Get curation by ID
- `v3UpdateCuration(curationId, updates, etag)` - Partial update with optimistic locking
- `v3DeleteCuration(curationId)` - Delete curation
- `v3GetEntityCurations(entityId, params)` - Get curations for entity
- `v3SearchCurations(params)` - Search curations

#### Advanced Features
- `v3Query(queryRequest)` - Flexible query DSL
- `v3Request(endpoint, options, etag)` - Generic V3 request with ETag support

#### Migration Helpers
- `convertV2ToV3(v2Restaurant, curatorInfo)` - Convert V2 format to V3
- `migrateV2ToV3(v2Restaurants, curatorInfo)` - Bulk migration from V2 to V3

#### Unified Interface
- `createRestaurantUnified(restaurantData, curatorInfo)` - Auto-route to preferred API
- `getRestaurantUnified(id)` - Auto-route to preferred API
- `searchRestaurantsUnified(searchTerm, options)` - Auto-route to preferred API

### 2. Updated Configuration (`scripts/config.js`)

**New Configuration Sections:**

#### V3 API Configuration
```javascript
api: {
  v3: {
    baseUrl: 'https://wsmontes.pythonanywhere.com/api/v3',
    timeout: 30000,
    features: {
      optimisticLocking: true,
      partialUpdates: true,
      flexibleQuery: true,
      documentOriented: true
    }
  }
}
```

#### API Version Management
```javascript
apiVersion: {
  preferred: 'v3',           // Default to V3
  autoFallback: true,        // Fall back to V2 if needed
  migration: {
    enabled: true,
    batchSize: 10,
    preserveV2Data: true
  }
}
```

#### New Helper Methods
- `getV3Url(endpoint)` - Build V3 API URLs
- `getPreferredApiVersion()` - Get current API version preference
- `setPreferredApiVersion(version)` - Set API version preference

### 3. Test Interface (`test_api_v3.html`)

Created a comprehensive test interface to verify V3 API integration:

- **Connectivity Tests**: Test both V2 and V3 API availability
- **Health Checks**: Verify V3 API status
- **Entity Operations**: Create, read, update, delete entities
- **Curation Operations**: Create and manage curations
- **Search & Query**: Test search and advanced query features
- **Migration Testing**: Test V2 to V3 data conversion

## Usage Examples

### JavaScript Client Code

```javascript
// Initialize API service
const apiService = window.apiService;

// Set API version preference
apiService.setApiVersion(true); // Use V3

// Create an entity (restaurant)
const entity = await apiService.v3CreateEntity({
  entity_id: 'restaurant_123',
  type: 'restaurant',
  name: 'Amazing Restaurant',
  metadata: {
    cuisine: ['Italian'],
    rating: 4.5,
    location: 'San Francisco'
  }
});

// Update with optimistic locking
const updates = {
  metadata: { rating: 4.7 }
};
await apiService.v3UpdateEntity('restaurant_123', updates, entity.etag);

// Create a curation (review)
await apiService.v3CreateCuration({
  curation_id: 'review_456',
  entity_id: 'restaurant_123',
  curator: {
    id: 'user_789',
    name: 'John Doe',
    email: 'john@example.com'
  },
  category: 'dining',
  concept: 'date_night',
  items: [
    {
      name: 'Pasta Carbonara',
      description: 'Excellent',
      rating: 5,
      price: 24.50
    }
  ]
});
```

### V2 to V3 Migration

```javascript
// Convert V2 restaurant data to V3 format
const v2Restaurant = {
  id: 123,
  name: 'Old Restaurant',
  Cuisine: ['Italian'],
  Menu: ['Pizza', 'Pasta']
};

const curatorInfo = {
  id: 'curator_1',
  name: 'Jane Curator',
  email: 'jane@example.com'
};

const { entity, curation } = apiService.convertV2ToV3(v2Restaurant, curatorInfo);

// Create both entity and curation in V3
await apiService.v3CreateEntity(entity);
if (curation) {
  await apiService.v3CreateCuration(curation);
}
```

## Migration Strategy

### Backward Compatibility
- **Dual API Support**: Both V2 and V3 APIs are supported
- **Automatic Fallback**: Falls back to V2 if V3 is unavailable
- **Data Preservation**: V2 data remains intact during migration
- **Gradual Migration**: Can migrate data incrementally

### Migration Options
1. **Manual Migration**: Use the test interface to convert specific records
2. **Batch Migration**: Use `migrateV2ToV3()` for bulk conversion
3. **Automatic Migration**: Configure auto-migration on startup (disabled by default)

## Configuration Options

### Enable V3 API
```javascript
// In config.js or programmatically
AppConfig.setPreferredApiVersion('v3');
```

### Migration Settings
```javascript
AppConfig.apiVersion.migration = {
  enabled: true,           // Allow migration
  batchSize: 10,          // Items per batch
  delayBetweenBatches: 500, // Milliseconds
  preserveV2Data: true,   // Keep V2 data
  autoMigrate: false      // Manual migration only
};
```

## Testing the Integration

### 1. Open Test Interface
```
file:///path/to/test_api_v3.html
```

### 2. Test Connectivity
- Click "Test V2 & V3 API Connectivity"
- Verify both APIs are reachable

### 3. Test V3 Features
- Health checks
- Entity operations (CRUD)
- Curation management
- Search and query
- Migration conversion

### 4. Check Console
Monitor browser console for detailed API interaction logs.

## Next Steps

### 1. UI Integration
- Update restaurant forms to support entity/curation model
- Add API version selector in settings
- Implement migration UI for bulk operations

### 2. Data Synchronization
- Extend sync module to support V3 API
- Implement conflict resolution for optimistic locking
- Add sync status indicators

### 3. Advanced Features
- Utilize V3 flexible query DSL for better search
- Implement partial updates for performance
- Add real-time collaboration features using ETags

### 4. Production Migration
- Plan production data migration strategy
- Set up monitoring for both API versions
- Implement graceful degradation

## Benefits of V3 Integration

1. **Better Data Model**: Separation of entities and curations
2. **Conflict Prevention**: Optimistic locking prevents data loss
3. **Performance**: Partial updates reduce bandwidth
4. **Flexibility**: Advanced query capabilities
5. **Future-Proof**: Modern API design patterns
6. **Collaboration**: Better support for multi-user scenarios

## Files Modified

- `scripts/apiService.js` - Added V3 API methods
- `scripts/config.js` - Added V3 configuration
- `test_api_v3.html` - New test interface
- `API_V3_INTEGRATION.md` - This documentation

## API References

- [V3 Complete Documentation](./API-REF/API_DOCUMENTATION_V3.md)
- [V3 Quick Reference](./API-REF/API_QUICK_REFERENCE.md)
- [OpenAPI Specification](./API-REF/openapi.yaml)

The Concierge Collector application is now ready to take advantage of the new V3 API features while maintaining full backward compatibility with existing V2 data and workflows.