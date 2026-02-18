# Changelog

All notable changes to the Concierge Collector project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

> Cadence note: references to historical sprint/day labels are preserved only as implementation chronology and are not current planning commitments.

### Added - 2025-01-XX

#### V3 Data Transformation Layer (Historical Phase)

**Decision**: Implement bidirectional transformation layer for 100% MongoDB ↔ IndexedDB compatibility.

**Implementation**:
- **V3DataTransformer.js** (580 lines): Bidirectional data transformation service
  * `mongoEntityToLocal()` / `localEntityToMongo()`: Entity transformations
  * `mongoCurationToLocal()` / `localCurationToMongo()`: Curation transformations
  * Batch transformation methods for bulk operations
  * Date conversion: ISO 8601 strings ↔ Date objects
  * Field mapping: `_id` ↔ `id`, `sync.serverId` management
  * Roundtrip validation for data integrity testing

**DataStorage Integration**:
- Added transformation reference in constructor
- New API-focused methods:
  * `saveEntityFromAPI()` / `getEntityForAPI()`
  * `saveEntitiesFromAPI()` / `getAllEntitiesForAPI()`
  * `saveCurationFromAPI()` / `getCurationForAPI()`
- Automatic transformation on all API sync operations
- Backward compatible with existing local operations

**Key Features**:
- **100% Field Compatibility**: All MongoDB fields preserved in IndexedDB
- **Sync Metadata**: Track server IDs, sync status, timestamps
- **Optimistic Locking**: Version field preserved across transformations
- **Date Handling**: Automatic ISO string ↔ Date object conversion
- **Validation**: Built-in roundtrip testing to ensure data integrity

**Technical Benefits**:
- **Zero Data Loss**: All MongoDB fields mapped to IndexedDB
- **Bidirectional Sync**: Changes flow cleanly in both directions
- **Type Safety**: Proper data type conversion (strings, dates, arrays)
- **Testable**: Validation methods for integration testing
- **Maintainable**: Single source of truth for data transformation logic

**Files Modified**:
- Created `scripts/services/V3DataTransformer.js`
- Updated `scripts/dataStorage.js` with transformation methods
- Updated `index.html` to load V3DataTransformer before dataStorage

**Related Documentation**:
- See `docs/COLLECTOR_MODERNIZATION_PLAN.md` (historical phase context)

---

#### Google Places Service-Based Architecture (Historical Phase)

**Decision**: Refactor Google Places integration from monolithic module to service-based architecture.

**Implementation**:
- **PlacesService.js** (331 lines): Core Google Places API wrapper
  * Promise-based async interface for all API operations
  * Nearby search, text search, place details, geocoding
  * Rate limiting (100ms minimum between calls)
  * Error handling with proper status code mapping
  * Singleton pattern for global access
  
- **PlacesCache.js** (285 lines): Intelligent caching layer
  * In-memory caching with configurable TTL (default: 15 minutes)
  * Cache key generation for search parameters
  * Hit/miss tracking and statistics
  * Automatic cleanup with LRU eviction
  * Memory-efficient storage
  
- **PlacesFormatter.js** (370 lines): Data transformation utilities
  * Google Place → Entity format transformation
  * Concept extraction from types and reviews
  * Photo formatting and lazy loading preparation
  * Display info formatting for UI
  * Cuisine type mapping and extraction

**Architectural Benefits**:
- **Separation of Concerns**: UI logic separated from API logic and caching
- **Testability**: Each service can be tested independently
- **Reusability**: Services can be used by other modules
- **Maintainability**: Reduced from 3394-line monolith to focused services
- **Performance**: Intelligent caching reduces API calls
- **Clean Delegation**: PlacesModule delegates to services, keeping UI code clean

**Files Modified**:
- Created `scripts/services/googlePlaces/PlacesService.js`
- Created `scripts/services/googlePlaces/PlacesCache.js`
- Created `scripts/services/googlePlaces/PlacesFormatter.js`
- Refactored `scripts/modules/placesModule.js` to use services
- Updated `index.html` to load services before module

**Related Documentation**:
- See `docs/COLLECTOR_MODERNIZATION_PLAN.md` (historical phase context)

---

### Removed - 2025-01-XX

#### Michelin Module Deprecation

**Decision**: Complete removal of `michelinStagingModule.js` and all related functionality.

**Rationale**:
- **Unmaintainable External Dependency**: The module relied on a PostgreSQL database hosted on AWS that was outside the project's control and maintenance scope
- **Architectural Complexity**: Added unnecessary complexity with external database connections, authentication, and network error handling
- **Data Staleness**: The staging data was not being regularly updated, reducing its value
- **Project Focus**: The core value of Concierge Collector lies in Google Places integration and user-curated concepts, not Michelin data aggregation

**Technical Impact**:
- Removed `scripts/modules/michelinStagingModule.js` (1,841 lines)
- Removed script references from `index.html` (2 locations)
- Disabled `michelinStaging` feature flag in `scripts/config.js`
- Removed Michelin metadata transformation in `scripts/migrationManager.js`

**Migration Path**:
- Existing Michelin data in the database remains intact and functional
- Future Michelin data will be batch imported via separate administrative script (outside main application)
- No breaking changes to entity data model - Michelin metadata format preserved for compatibility

**Related Documentation**:
- See `docs/COLLECTOR_MODERNIZATION_PLAN.md` for full historical context

---

## [Version History]

### API V3 FastAPI Migration - 2025-01-XX

**Major architectural change**: Complete migration from Flask to FastAPI for API backend.

**Motivation**:
- Resolved "Task attached to different loop" errors from Flask + Motor async incompatibility
- Achieved industry-standard async architecture with FastAPI's native async/await support
- Improved developer experience with automatic OpenAPI documentation
- Enhanced performance with ASGI server (Uvicorn)

**Technical Changes**:
- Migrated from Flask 3.0.0 to FastAPI 0.109.0
- Maintained Motor 3.3.2 for MongoDB async operations (now fully compatible)
- Upgraded to Pydantic 2.5.3 with v2 syntax (ConfigDict, Field annotations)
- Professional project structure: `app/{api,core,models}`
- Implemented comprehensive pytest suite: 28/28 tests passing (100% coverage)
- Added optimistic locking with If-Match/ETag headers
- Fixed datetime.utcnow() deprecation warnings (migrated to timezone-aware datetime)

**Preserved Functionality**:
- All CRUD endpoints maintain identical API contracts
- MongoDB collections and data models unchanged
- CORS configuration preserved
- Error handling enhanced with proper HTTPException usage

**Testing**:
- System health checks: 2/2 passing
- Entity operations: 13/13 passing
- Curation operations: 12/12 passing
- Integration tests: 1/1 passing

**Backup**:
- Original Flask implementation preserved in `concierge-api-v3-flask-backup/`

---

## Notes

This changelog follows the modernization plan outlined in `docs/COLLECTOR_MODERNIZATION_PLAN.md`. Major architectural changes are documented here with clear rationale, technical impact, and migration paths.
