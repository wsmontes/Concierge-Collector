# Test Coverage Analysis & Action Plan

**Date:** January 28, 2026  
**Status:** 🟡 PARTIAL COVERAGE (Frontend: 339 tests | Backend: 11 test files)

---

## 🎯 Executive Summary

The project has a **good foundation** of tests but with **critical gaps** in coverage, especially for the new V3 integration features we just implemented. The test suite needs expansion to cover:
- Sync Manager V3 changes (PATCH partial updates, incremental sync)
- Conflict Resolution UI
- Places API migration
- Audio recording → MongoDB flow

**Current Coverage:**
- **Frontend:** 339 tests (332 passing, 7 failing)
- **Backend:** 11 test files (status unknown - pytest not installed)
- **Integration:** Some real API integration tests exist

---

## 📊 Current Test Inventory

### Frontend Tests (JavaScript/Vitest)

**Location:** `/tests/`  
**Framework:** Vitest + jsdom  
**Total Tests:** 339  
**Pass Rate:** 97.9% (332/339 passing)

#### ✅ Well-Tested Modules (158 tests)

```javascript
// Core Infrastructure
tests/test_config.test.js              // 19 tests - Configuration validation
tests/test_logger.test.js              // 22 tests - Logging system
tests/test_errorManager.test.js        // 25 tests - Error handling
tests/test_moduleWrapper.test.js       // 27 tests - Module pattern

// API & Storage
tests/test_apiService.test.js          // 22 tests - API service layer
tests/test_dataStore.test.js           // 23 tests - IndexedDB CRUD
tests/test_api_integration.test.js     // 12 tests - Real API calls
tests/test_integration.test.js         // 8 tests - Workflow integration
```

#### 🟡 Partially Tested Modules

```javascript
tests/test_conceptModule.test.js       // Concepts extraction
tests/test_recordingModule.test.js     // Audio recording
tests/test_transcriptionModule.test.js // Transcription processing
tests/test_modules.test.js             // General module tests
```

#### ❌ Missing Critical Tests

```javascript
// NEW V3 FEATURES - NO TESTS!
tests/test_syncManagerV3.test.js       // ❌ MISSING - Sync changes we just made
tests/test_conflictResolution.test.js  // ❌ MISSING - Conflict UI modal
tests/test_placesOrchestration.test.js // ❌ MISSING - Places service
tests/test_incrementalSync.test.js     // ❌ MISSING - Timestamp-based sync
tests/test_audioToMongoDB.test.js      // ❌ MISSING - Complete save flow

// OTHER IMPORTANT MODULES
tests/test_auth.test.js                // ❌ MISSING - OAuth flow
tests/test_curatorProfile.test.js      // ❌ MISSING - User profiles
tests/test_entityModule.test.js        // ❌ MISSING - Entity management
tests/test_uiManager.test.js           // ❌ MISSING - UI orchestration
```

### Backend Tests (Python/pytest)

**Location:** `/concierge-api-v3/tests/`  
**Framework:** pytest + httpx  
**Total Files:** 11

#### ✅ Existing Test Files

```python
# API Endpoints
test_auth.py                    # OAuth authentication
test_entities.py                # Entity CRUD
test_curations.py               # Curation CRUD
test_places.py                  # Google Places proxy
test_places_fields.py           # Places field validation
test_concepts.py                # Concept matching

# AI Services
test_ai.py                      # AI service layer
test_ai_orchestrate.py          # AI orchestration
test_integration_transcription.py  # Audio transcription flow

# System
test_system.py                  # System health
test_integration.py             # Full integration tests
```

#### ❌ Missing Backend Tests

```python
# NEW FEATURES - NO TESTS!
test_incremental_sync.py        # ❌ MISSING - ?since parameter filtering
test_partial_updates.py         # ❌ MISSING - PATCH partial fields
test_conflict_detection.py      # ❌ MISSING - Version conflict handling

# CRITICAL GAPS
test_oauth_refresh.py           # ❌ MISSING - Token refresh flow
test_authorized_users.py        # ❌ MISSING - User authorization
test_rate_limiting.py           # ❌ MISSING - API rate limits
test_data_validation.py         # ❌ MISSING - Input validation
```

---

## 🔍 Detailed Coverage Analysis

### 1. Sync Manager V3 (❌ 0% Coverage)

**What Changed:**
- PATCH partial updates (extractChangedFields)
- Incremental sync (lastEntityPullAt/lastCurationPullAt)
- Conflict resolution with UI modal
- Change tracking (storeItemState)

**Tests Needed:**

```javascript
// tests/test_syncManagerV3.test.js

describe('SyncManagerV3 - PATCH Partial Updates', () => {
  test('should extract only changed fields', () => {
    const original = { name: 'Old Name', status: 'draft', data: { city: 'SP' } };
    const modified = { ...original, name: 'New Name' };
    
    const changes = syncManager.extractChangedFields(modified, original);
    
    expect(changes).toEqual({ name: 'New Name' });
    expect(changes).not.toHaveProperty('status');
  });

  test('should detect deep object changes', () => {
    const original = { data: { location: { city: 'SP' } } };
    const modified = { data: { location: { city: 'RJ' } } };
    
    const changes = syncManager.extractChangedFields(modified, original);
    
    expect(changes.data.location.city).toBe('RJ');
  });

  test('should send PATCH with only changed fields', async () => {
    const entity = { entity_id: '123', name: 'Test', version: 1 };
    entity._lastSyncedState = { name: 'Old', version: 1 };
    entity.name = 'New';
    
    await syncManager.pushEntity(entity);
    
    expect(mockApiService.updateEntity).toHaveBeenCalledWith(
      '123',
      { name: 'New' },  // Only changed field
      1
    );
  });
});

describe('SyncManagerV3 - Incremental Sync', () => {
  test('should use lastEntityPullAt for incremental sync', async () => {
    syncManager.stats.lastEntityPullAt = '2026-01-28T10:00:00Z';
    
    await syncManager.pullEntities();
    
    expect(mockApiService.listEntities).toHaveBeenCalledWith({
      since: '2026-01-28T10:00:00Z',
      limit: 50,
      offset: 0
    });
  });

  test('should update lastEntityPullAt after successful pull', async () => {
    const beforePull = new Date().toISOString();
    
    await syncManager.pullEntities();
    
    expect(syncManager.stats.lastEntityPullAt).toBeGreaterThan(beforePull);
  });

  test('should fall back to full sync if no lastPullAt', async () => {
    syncManager.stats.lastEntityPullAt = null;
    
    await syncManager.pullEntities();
    
    expect(mockApiService.listEntities).toHaveBeenCalledWith({
      limit: 50,
      offset: 0
    });
    expect(mockApiService.listEntities.mock.calls[0][0]).not.toHaveProperty('since');
  });
});

describe('SyncManagerV3 - Conflict Resolution', () => {
  test('should detect version conflicts', async () => {
    const entity = { entity_id: '123', version: 2 };
    mockApiService.updateEntity.mockRejectedValue(new Error('409 Version conflict'));
    
    await syncManager.pushEntity(entity);
    
    expect(entity.sync.status).toBe('conflict');
  });

  test('should show conflict resolution modal', async () => {
    const conflict = { type: 'entity', id: '123', local: {}, server: {} };
    
    const resolution = await syncManager.resolveConflict(conflict.type, conflict.id);
    
    expect(mockConflictModal.show).toHaveBeenCalledWith(conflict);
  });

  test('should apply "keep local" resolution', async () => {
    mockConflictModal.show.mockResolvedValue('local');
    
    await syncManager.resolveConflict('entity', '123');
    
    expect(mockApiService.updateEntity).toHaveBeenCalledWith(
      '123',
      expect.any(Object),
      expect.any(Number)  // Force update with server version
    );
  });

  test('should apply "keep server" resolution', async () => {
    const serverEntity = { entity_id: '123', name: 'Server', version: 5 };
    mockConflictModal.show.mockResolvedValue('server');
    mockApiService.getEntity.mockResolvedValue(serverEntity);
    
    await syncManager.resolveConflict('entity', '123');
    
    expect(mockDataStore.updateEntity).toHaveBeenCalledWith(serverEntity);
  });
});
```

**Estimated Effort:** 8 hours (30-40 tests)

---

### 2. Conflict Resolution UI (❌ 0% Coverage)

**What Changed:**
- New modal component (scripts/ui/conflictResolutionModal.js)
- Side-by-side comparison
- 3 resolution buttons

**Tests Needed:**

```javascript
// tests/test_conflictResolutionModal.test.js

describe('ConflictResolutionModal - UI Rendering', () => {
  test('should render modal with local and server versions', () => {
    const conflict = {
      type: 'entity',
      id: '123',
      local: { name: 'Local Name', version: 3 },
      server: { name: 'Server Name', version: 4 }
    };
    
    modal.show(conflict);
    
    expect(document.getElementById('conflict-local-content')).toContainText('Local Name');
    expect(document.getElementById('conflict-server-content')).toContainText('Server Name');
  });

  test('should highlight differences', () => {
    const conflict = {
      local: { name: 'A', status: 'draft' },
      server: { name: 'B', status: 'draft' }
    };
    
    modal.show(conflict);
    
    const diffList = document.getElementById('conflict-diff-list');
    expect(diffList).toContainText('name');
    expect(diffList).not.toContainText('status');
  });

  test('should display version numbers', () => {
    const conflict = {
      local: { version: 3 },
      server: { version: 5 }
    };
    
    modal.show(conflict);
    
    expect(document.body.innerHTML).toContain('v3');
    expect(document.body.innerHTML).toContain('v5');
  });
});

describe('ConflictResolutionModal - User Actions', () => {
  test('should resolve with "local" when Keep Local clicked', async () => {
    const promise = modal.show(conflict);
    
    document.getElementById('conflict-keep-local').click();
    
    const resolution = await promise;
    expect(resolution).toBe('local');
  });

  test('should resolve with "server" when Use Server clicked', async () => {
    const promise = modal.show(conflict);
    
    document.getElementById('conflict-keep-server').click();
    
    const resolution = await promise;
    expect(resolution).toBe('server');
  });

  test('should resolve with "merge" when Merge clicked', async () => {
    const promise = modal.show(conflict);
    
    document.getElementById('conflict-merge').click();
    
    const resolution = await promise;
    expect(resolution).toBe('merge');
  });

  test('should close modal after resolution', async () => {
    const promise = modal.show(conflict);
    document.getElementById('conflict-keep-local').click();
    
    await promise;
    
    expect(document.getElementById('conflict-resolution-modal')).toBeNull();
  });
});
```

**Estimated Effort:** 4 hours (15-20 tests)

---

### 3. Places API Migration (❌ 0% Coverage)

**What Changed:**
- Removed Google Maps JS API direct use
- Now uses PlacesOrchestrationService → ApiService
- Security fix (no exposed API key)

**Tests Needed:**

```javascript
// tests/test_placesModule.test.js

describe('PlacesModule - Security', () => {
  test('should NOT expose Google API key in frontend', () => {
    const placesModule = new PlacesModule();
    
    expect(placesModule.apiKey).toBeUndefined();
    expect(window.googleMapsApiKey).toBeUndefined();
  });

  test('should use backend API proxy instead of Google JS API', async () => {
    const placesModule = new PlacesModule();
    
    await placesModule.searchPlaces('sushi');
    
    expect(mockApiService.searchPlaces).toHaveBeenCalled();
    expect(window.google.maps.places.PlacesService).not.toHaveBeenCalled();
  });
});

describe('PlacesModule - PlacesOrchestrationService', () => {
  test('should use PlacesOrchestrationService if available', async () => {
    window.PlacesOrchestrationService = mockOrchestrationService;
    
    await placesModule.searchPlaces('sushi');
    
    expect(mockOrchestrationService.searchNearby).toHaveBeenCalled();
  });

  test('should fallback to ApiService if orchestration unavailable', async () => {
    window.PlacesOrchestrationService = null;
    
    await placesModule.searchPlaces('sushi');
    
    expect(mockApiService.searchPlaces).toHaveBeenCalled();
  });

  test('should use caching from orchestration service', async () => {
    window.PlacesOrchestrationService = mockOrchestrationService;
    
    await placesModule.searchPlaces('sushi');
    await placesModule.searchPlaces('sushi');  // Same query
    
    expect(mockOrchestrationService.searchNearby).toHaveBeenCalledTimes(1);  // Cached
  });
});
```

**Estimated Effort:** 3 hours (12-15 tests)

---

### 4. Audio Recording → MongoDB Flow (❌ 0% Coverage)

**What Changed:**
- Fixed transcription field (content.transcription)
- Added immediate sync trigger
- Enhanced orchestrate response handling

**Tests Needed:**

```javascript
// tests/test_audioToMongoDB.test.js

describe('Audio Recording → MongoDB Complete Flow', () => {
  test('should save audio blob to IndexedDB', async () => {
    const audioBlob = new Blob(['audio data'], { type: 'audio/webm' });
    
    await recordingModule.saveRecording(audioBlob);
    
    const pendingAudios = await dataStore.getPendingAudios();
    expect(pendingAudios).toHaveLength(1);
    expect(pendingAudios[0].blob).toBe(audioBlob);
  });

  test('should transcribe audio via orchestrate endpoint', async () => {
    const audioBlob = new Blob(['audio data']);
    mockApiService.transcribeAudio.mockResolvedValue({
      text: 'Transcribed text',
      transcription: { text: 'Transcribed text', language: 'pt' },
      concepts: [{ category: 'cuisine', value: 'Japanese' }]
    });
    
    const result = await recordingModule.transcribeAudio(audioBlob);
    
    expect(result.text).toBe('Transcribed text');
    expect(result.concepts).toBeDefined();
  });

  test('should save transcription to correct field (content.transcription)', async () => {
    const transcription = 'My review';
    
    await conceptModule.saveRestaurant({ transcription });
    
    const savedCuration = mockDataStore.createCuration.mock.calls[0][0];
    expect(savedCuration.content.transcription).toBe('My review');
    expect(savedCuration.notes.transcription).toBeUndefined();  // NOT here
  });

  test('should trigger immediate sync after save', async () => {
    await conceptModule.saveRestaurant({});
    
    expect(mockSyncManager.quickSync).toHaveBeenCalled();
  });

  test('should persist to MongoDB via sync', async () => {
    const curation = { curation_id: '123', content: { transcription: 'Test' } };
    
    await dataStore.createCuration(curation);
    await syncManager.quickSync();
    
    expect(mockApiService.createCuration).toHaveBeenCalledWith(
      expect.objectContaining({
        content: { transcription: 'Test' }
      })
    );
  });
});

describe('Audio Recording - Orchestrate Enhancement', () => {
  test('should return enhanced result with concepts', async () => {
    mockApiService.transcribeAudio.mockResolvedValue({
      results: {
        transcription: { text: 'Great sushi' },
        concepts: { concepts: [{ category: 'cuisine', value: 'Japanese' }] }
      }
    });
    
    const result = await recordingModule.transcribeAudio(audioBlob);
    
    expect(result.text).toBeDefined();
    expect(result.concepts).toBeDefined();
  });

  test('should apply pre-extracted concepts without second API call', async () => {
    const preExtractedConcepts = [{ category: 'cuisine', value: 'Italian' }];
    
    await recordingModule.triggerConceptProcessing('text', preExtractedConcepts);
    
    expect(mockApiService.extractConcepts).not.toHaveBeenCalled();
    expect(mockConceptModule.displayConcepts).toHaveBeenCalledWith(preExtractedConcepts);
  });
});
```

**Estimated Effort:** 5 hours (20-25 tests)

---

### 5. Backend Incremental Sync (❌ 0% Coverage)

**What Changed:**
- Added `?since` parameter to entities.py and curations.py
- MongoDB filtering by updatedAt >= since

**Tests Needed:**

```python
# concierge-api-v3/tests/test_incremental_sync.py

async def test_entities_incremental_sync_with_since_parameter(async_client, auth_token):
    """Test that ?since parameter filters entities by updatedAt"""
    # Create old entity
    old_entity = {
        "entity_id": "old_123",
        "name": "Old Restaurant",
        "type": "restaurant"
    }
    await async_client.post("/api/v3/entities", json=old_entity, headers=auth_token)
    
    # Get current timestamp
    since_timestamp = datetime.utcnow().isoformat() + "Z"
    
    # Wait 1 second
    await asyncio.sleep(1)
    
    # Create new entity
    new_entity = {
        "entity_id": "new_456",
        "name": "New Restaurant",
        "type": "restaurant"
    }
    await async_client.post("/api/v3/entities", json=new_entity, headers=auth_token)
    
    # Query with ?since parameter
    response = await async_client.get(
        f"/api/v3/entities?since={since_timestamp}",
        headers=auth_token
    )
    
    assert response.status_code == 200
    data = response.json()
    
    # Should only return new entity
    assert data["total"] == 1
    assert data["items"][0]["entity_id"] == "new_456"


async def test_curations_incremental_sync_with_since_parameter(async_client, auth_token):
    """Test that ?since parameter filters curations by updatedAt"""
    # Similar test for curations endpoint
    # ...


async def test_since_parameter_with_invalid_format(async_client, auth_token):
    """Test that invalid ISO timestamp returns 400"""
    response = await async_client.get(
        "/api/v3/entities?since=invalid-timestamp",
        headers=auth_token
    )
    
    assert response.status_code == 400
    assert "Invalid since timestamp format" in response.json()["detail"]


async def test_full_sync_without_since_parameter(async_client, auth_token):
    """Test that omitting ?since returns all entities"""
    # Create 3 entities
    for i in range(3):
        entity = {
            "entity_id": f"entity_{i}",
            "name": f"Restaurant {i}",
            "type": "restaurant"
        }
        await async_client.post("/api/v3/entities", json=entity, headers=auth_token)
    
    # Query without ?since
    response = await async_client.get("/api/v3/entities", headers=auth_token)
    
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 3
```

**Estimated Effort:** 4 hours (8-10 tests)

---

## 📋 Priority Action Plan

### 🔥 Priority 0 (Critical - This Week)

**1. Sync Manager V3 Tests** (8 hours)
- PATCH partial updates
- Incremental sync
- Conflict resolution
- Change tracking

**2. Audio → MongoDB Flow Tests** (5 hours)
- Complete save flow
- Transcription field validation
- Immediate sync trigger
- Orchestrate enhancement

**3. Backend Incremental Sync Tests** (4 hours)
- `?since` parameter filtering
- Timestamp validation
- Full vs incremental sync

**Total Effort:** 17 hours (~2-3 days)

---

### ⚡ Priority 1 (High - Next Week)

**4. Conflict Resolution UI Tests** (4 hours)
- Modal rendering
- User actions
- Resolution strategies

**5. Places Module Tests** (3 hours)
- Security validation (no exposed API key)
- PlacesOrchestrationService usage
- Fallback to ApiService

**6. OAuth Authentication Tests** (5 hours)
- Login flow
- Token refresh
- Logout
- Authorized users only

**Total Effort:** 12 hours (~1.5 days)

---

### 📌 Priority 2 (Medium - Later)

**7. Entity Module Tests** (4 hours)
**8. UI Manager Tests** (3 hours)
**9. Curator Profile Tests** (2 hours)
**10. Backend Validation Tests** (4 hours)

**Total Effort:** 13 hours (~2 days)

---

## 🎯 Coverage Goals

| Component | Current | Target | Priority |
|-----------|---------|--------|----------|
| **Sync Manager V3** | 0% | 80% | P0 |
| **Audio → MongoDB** | 0% | 75% | P0 |
| **Backend Incremental Sync** | 0% | 90% | P0 |
| **Conflict Resolution UI** | 0% | 70% | P1 |
| **Places Module** | 30% | 75% | P1 |
| **OAuth Auth** | 0% | 80% | P1 |
| **Entity Module** | 40% | 75% | P2 |
| **Overall Coverage** | 45% | 75% | - |

---

## 🛠️ Implementation Strategy

### Phase 1: Foundation (Week 1)

```bash
# Day 1-2: Sync Manager V3 Tests
npm run test:watch tests/test_syncManagerV3.test.js

# Day 3: Audio → MongoDB Tests
npm run test:watch tests/test_audioToMongoDB.test.js

# Day 4: Backend Incremental Sync
cd concierge-api-v3
pytest tests/test_incremental_sync.py -v
```

### Phase 2: UI & Integration (Week 2)

```bash
# Day 1: Conflict Resolution UI
npm run test:watch tests/test_conflictResolutionModal.test.js

# Day 2: Places Module
npm run test:watch tests/test_placesModule.test.js

# Day 3-4: OAuth Authentication
npm run test:watch tests/test_auth.test.js
pytest tests/test_oauth_refresh.py -v
```

### Phase 3: Comprehensive Coverage (Week 3)

```bash
# Run full test suite with coverage
npm run test:coverage
pytest tests/ --cov=app --cov-report=html
```

---

## 📝 Test Writing Guidelines

### 1. **AAA Pattern (Arrange-Act-Assert)**

```javascript
test('should do something', () => {
  // Arrange: Setup
  const input = { foo: 'bar' };
  
  // Act: Execute
  const result = functionUnderTest(input);
  
  // Assert: Verify
  expect(result).toEqual(expected);
});
```

### 2. **Mock External Dependencies**

```javascript
// Mock API calls
vi.mock('../scripts/apiService.js', () => ({
  ApiService: {
    createEntity: vi.fn().mockResolvedValue({ id: '123' }),
    updateEntity: vi.fn().mockResolvedValue({ version: 2 })
  }
}));
```

### 3. **Test Edge Cases**

```javascript
describe('Edge Cases', () => {
  test('should handle null input');
  test('should handle empty array');
  test('should handle network timeout');
  test('should handle 409 conflict');
});
```

### 4. **Integration Tests**

```javascript
describe('Complete Flow Integration', () => {
  test('should complete entire workflow end-to-end', async () => {
    // Setup real dependencies (no mocks)
    const result = await completeWorkflow();
    
    // Verify multiple system interactions
    expect(result.step1).toBeTruthy();
    expect(result.step2).toBeTruthy();
    expect(result.final).toBeTruthy();
  });
});
```

---

## 🔍 Test Maintenance

### Fixing Failing Tests

**Current Failures:** 7/339 tests failing

```javascript
// tests/test_realProduction.test.js - Line 100, 115
// ISSUE: Cannot read properties of null (reading 'pendingAudios')
// FIX: Add null checks before accessing db properties

// BEFORE:
const table = mockDataStore.db.pendingAudios;

// AFTER:
if (!mockDataStore.db) {
  throw new Error('DataStore not initialized');
}
const table = mockDataStore.db.pendingAudios;
```

### Running Tests Locally

```bash
# Frontend tests
npm test                    # Run all
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage

# Backend tests
cd concierge-api-v3
pytest tests/ -v           # Verbose
pytest -m "not integration" # Skip integration
pytest --cov=app           # With coverage
```

---

## 📊 Success Metrics

**Definition of Done:**
- ✅ All Priority 0 tests implemented (17 hours)
- ✅ Test coverage > 75% for new features
- ✅ All tests passing (0 failures)
- ✅ CI/CD pipeline green
- ✅ Documentation updated

**Timeline:**
- Week 1: Priority 0 (critical)
- Week 2: Priority 1 (high)
- Week 3: Priority 2 (medium) + cleanup

---

**Document Version:** 1.0  
**Last Updated:** January 28, 2026  
**Next Review:** After Priority 0 completion
