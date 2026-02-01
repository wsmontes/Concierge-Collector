# Refactoring Roadmap - Concierge Collector

**Date:** January 31, 2026  
**Status:** EXECUTION PHASE  
**Priority:** CRITICAL - God Objects must be broken down

**Previous:** Cleanup complete (6 commits, 2 files deleted, 4 paths fixed, 20 docs archived)  
**Next:** Systematic refactoring following SOLID principles

---

## 🎯 Refactoring Priorities

Based on CODE_QUALITY_AUDIT findings:

### Priority 1: Break Down God Objects (CRITICAL)
**Files:** 3 files, ~8000 lines total
- placesModule.js (3177 lines) - God Object
- recordingModule.js (2417 lines) - God Object  
- conceptModule.js (2512 lines) - God Object

**Problem:** Violates SRP, impossible to test, high coupling

**Solution:** Extract into specialized services

**Time:** 3-4 days (8-12 hours)

---

### Priority 2: Eliminate Duplicate Code (HIGH)
**Locations:** Across all modules
- Duplicate error handlers (5+ copies)
- Duplicate validation logic (8+ copies)
- Duplicate API calls (3+ copies)

**Problem:** Violates DRY, maintenance nightmare

**Solution:** Extract to utilities, create shared services

**Time:** 1-2 days (4-6 hours)

---

### Priority 3: Remove Fallback Hell (MEDIUM)
**Files:** dataStorage.js, apiService.js, conceptModule.js
- 15+ fallback chains
- Unclear error paths
- Silent failures

**Problem:** Hard to debug, unpredictable behavior

**Solution:** Explicit error handling, fail-fast approach

**Time:** 1-2 days (3-5 hours)

---

### Priority 4: Fix Mixed Responsibilities (MEDIUM)
**Files:** All modules
- UI logic mixed with business logic
- Storage mixed with validation
- API calls scattered everywhere

**Problem:** Violates SoC, hard to maintain

**Solution:** Layer separation, dependency injection

**Time:** 2-3 days (6-8 hours)

---

## 📋 Execution Plan

### Phase 1: Extract Services from God Objects (Days 1-2)

#### 1.1 placesModule.js Breakdown
**Current:** 3177 lines doing everything
**Target:** 5 focused files

```
placesModule.js (500 lines)
  - Orchestration only
  - Module initialization
  - Public API surface

+ placesSearchService.js (400 lines)
  - Google Places API integration
  - Search logic
  - Result formatting

+ placesUIManager.js (600 lines)
  - Search UI rendering
  - Modal management
  - Event handlers

+ placesValidation.js (300 lines)
  - Input validation
  - Data sanitization
  - Format checking

+ placesCache.js (400 lines)
  - Search result caching
  - Recent searches
  - Location history

+ placesSyncService.js (500 lines)
  - Server synchronization
  - Conflict resolution
  - Batch operations
```

**Implementation Steps:**
1. Create new service files
2. Extract methods preserving signatures
3. Update imports in placesModule.js
4. Test each service independently
5. Update index.html script tags
6. Commit: "refactor: break down placesModule into 5 services"

**Testing:** Create unit tests for each service

---

#### 1.2 recordingModule.js Breakdown
**Current:** 2417 lines doing everything
**Target:** 4 focused files

```
recordingModule.js (500 lines)
  - Recording orchestration
  - Workflow management
  - State machine

+ audioRecordingService.js (600 lines)
  - Microphone access
  - Audio capture
  - Format conversion
  - Moved from legacy/audioRecorder.js

+ audioTranscriptionService.js (400 lines)
  - Whisper API integration
  - Text processing
  - Language detection

+ audioUIManager.js (500 lines)
  - Recording UI
  - Timer display
  - Visual feedback

+ audioDraftManager.js (400 lines)
  - Draft persistence
  - Resume recording
  - Pending audio queue
```

**Implementation Steps:**
1. Merge legacy/audioRecorder.js into audioRecordingService.js
2. Extract transcription logic
3. Extract UI management
4. Extract draft handling
5. Update recordingModule.js to orchestrate
6. Commit: "refactor: break down recordingModule into 4 services"

**Testing:** Test audio capture, transcription, UI independently

---

#### 1.3 conceptModule.js Breakdown
**Current:** 2512 lines doing everything
**Target:** 4 focused files

```
conceptModule.js (400 lines)
  - Concept orchestration
  - Extraction workflow
  - State management

+ conceptExtractionService.js (500 lines)
  - GPT-4 API integration
  - Prompt management
  - Concept parsing

+ conceptValidation.js (300 lines)
  - Category validation
  - Duplicate detection
  - Data quality checks

+ conceptUIManager.js (600 lines)
  - Concept display
  - Category grouping
  - Tag rendering

+ conceptSyncService.js (500 lines)
  - Server synchronization
  - Conflict resolution
  - Batch updates
```

**Implementation Steps:**
1. Extract GPT-4 integration
2. Extract validation logic
3. Extract UI rendering
4. Extract sync logic
5. Update conceptModule.js to orchestrate
6. Commit: "refactor: break down conceptModule into 4 services"

**Testing:** Mock GPT-4, test validation, test UI rendering

---

### Phase 2: Extract Shared Utilities (Day 3)

#### 2.1 Create errorHandling.js
Extract duplicate error handlers:
```javascript
// From 5+ modules
handleApiError(error, context)
showErrorNotification(message, duration)
logError(module, method, error)
retryWithBackoff(fn, maxRetries)
```

**Impact:** -200 lines of duplicates

---

#### 2.2 Create validationUtils.js
Extract duplicate validators:
```javascript
// From 8+ modules
validateRestaurantData(data)
validateConceptData(data)
validateEmail(email)
validatePhoneNumber(phone)
sanitizeInput(input)
```

**Impact:** -150 lines of duplicates

---

#### 2.3 Create apiUtils.js
Extract duplicate API logic:
```javascript
// From 3+ modules
buildApiHeaders(authToken)
handleApiResponse(response)
parseApiError(error)
retryFailedRequest(request)
```

**Impact:** -100 lines of duplicates

---

### Phase 3: Fix Fallback Hell (Day 4)

#### 3.1 Explicit Error Paths
Replace:
```javascript
// BAD: Silent fallback chain
const data = await api.getData() || cache.getData() || defaultData || {};
```

With:
```javascript
// GOOD: Explicit error handling
try {
  return await api.getData();
} catch (apiError) {
  logger.warn('API failed, trying cache', apiError);
  try {
    return await cache.getData();
  } catch (cacheError) {
    logger.error('Cache failed, using default', cacheError);
    return defaultData;
  }
}
```

**Files to fix:**
- dataStorage.js (5 fallbacks)
- apiService.js (4 fallbacks)
- conceptModule.js (3 fallbacks)
- recordingModule.js (3 fallbacks)

---

#### 3.2 Fail-Fast Approach
Add validation guards:
```javascript
// Start of every method
if (!this.isInitialized) {
  throw new Error('Module not initialized');
}
if (!requiredParam) {
  throw new Error('Missing required parameter: requiredParam');
}
```

**Impact:** Easier debugging, clearer error messages

---

### Phase 4: Separate Responsibilities (Day 5)

#### 4.1 Layer Separation
```
scripts/
├── modules/          - Orchestration only (public API)
├── services/         - Business logic (private implementation)
├── ui-managers/      - UI rendering and events
├── validators/       - Data validation
└── utils/            - Shared utilities
```

#### 4.2 Dependency Injection
```javascript
// BEFORE: Hard-coded dependencies
class ConceptModule {
  constructor() {
    this.api = window.apiService;  // Hard coupling
  }
}

// AFTER: Injected dependencies
class ConceptModule {
  constructor(apiService, uiManager, validator) {
    this.api = apiService || window.apiService;
    this.ui = uiManager || window.conceptUIManager;
    this.validator = validator || window.conceptValidator;
  }
}
```

**Impact:** Testable, flexible, maintainable

---

## 🧪 Testing Strategy

### Unit Tests (New)
Create tests for each extracted service:
```
tests/services/
├── placesSearchService.test.js
├── audioRecordingService.test.js
├── conceptExtractionService.test.js
├── errorHandling.test.js
└── validationUtils.test.js
```

**Coverage target:** 80%+ for new services

---

### Integration Tests (Update)
Update existing tests to work with new structure:
```
tests/modules/
├── placesModule.test.js       - Update to use new services
├── recordingModule.test.js    - Update to use new services
└── conceptModule.test.js      - Update to use new services
```

**Coverage target:** 70%+ for modules

---

## 📊 Success Metrics

### Before (Current State)
```
Total JS files:           57 files
Largest file:            3177 lines (placesModule.js)
Average file size:        400 lines
Files >1000 lines:       3 files (God Objects)
Duplicate code:          ~500 lines
Test coverage:           ~40%
SOLID violations:        5 critical issues
```

### After (Target State)
```
Total JS files:           ~75 files (+18 new services)
Largest file:            <800 lines (no God Objects)
Average file size:        300 lines
Files >1000 lines:       0 files
Duplicate code:          <50 lines
Test coverage:           >70%
SOLID violations:        0 critical issues
```

---

## 🔄 Git Strategy

### Branch Structure
```
cleanup-2026-01-31        (✅ Complete - 6 commits)
  └─> refactor-2026-01-31 (🔄 New branch)
        ├─> phase1-god-objects
        ├─> phase2-duplicates
        ├─> phase3-fallbacks
        └─> phase4-separation
```

### Commit Strategy
- One commit per file breakdown
- Run tests after each commit
- Keep commits small and focused
- Descriptive commit messages

**Example:**
```bash
git commit -m "refactor(places): extract PlacesSearchService from placesModule

- Create placesSearchService.js (400 lines)
- Move Google Places API integration
- Move search logic and result formatting
- Update placesModule.js imports
- Add unit tests for search service

Part of Phase 1.1: Breaking down placesModule (3177 lines -> 500 lines)"
```

---

## 🚨 Risks & Mitigation

### Risk 1: Breaking Existing Functionality
**Mitigation:**
- Test after each extraction
- Keep original signatures
- Maintain backward compatibility
- Use feature flags for new code

### Risk 2: Incomplete Dependencies
**Mitigation:**
- Map all dependencies before extraction
- Use grep search to find all usages
- Update all references in single commit

### Risk 3: Test Failures
**Mitigation:**
- Update tests alongside code
- Run full test suite after each phase
- Fix tests before moving to next file

---

## 📅 Timeline

**Phase 1:** Days 1-2 (God Objects)  
**Phase 2:** Day 3 (Duplicates)  
**Phase 3:** Day 4 (Fallbacks)  
**Phase 4:** Day 5 (Separation)  
**Testing:** Day 6 (Full coverage)  
**Merge:** Day 7 (Code review + merge)

**Total:** 1 week (7 days, ~25-30 hours)

---

## ✅ Ready to Execute

All prerequisites complete:
- ✅ Code quality audit done
- ✅ Cleanup complete (backups, unused files, docs)
- ✅ Git branch created
- ✅ Project structure analyzed
- ✅ Refactoring plan documented

**Next command:** Create refactor-2026-01-31 branch and start Phase 1.1

---

## Related Documents

- [CODE_QUALITY_AUDIT_2026_01_31.md](CODE_QUALITY_AUDIT_2026_01_31.md) - Original findings
- [PROJECT_CLEANUP_PLAN_2026_01_31.md](PROJECT_CLEANUP_PLAN_2026_01_31.md) - Cleanup (complete)
- [STORAGE_LAYER_ARCHITECTURE.md](STORAGE_LAYER_ARCHITECTURE.md) - Storage documentation
- [COLLECTOR_V3_ARCHITECTURE.md](COLLECTOR_V3_ARCHITECTURE.md) - Target architecture
