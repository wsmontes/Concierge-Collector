# Testing Documentation - Concierge Collector

## Overview

This document provides comprehensive information about the test structure and coverage for the Concierge Collector application.

**Current Status: ✅ 399/399 tests passing (100%)**

## Test Structure

```
tests/
├── test_apiService.test.js          # API integration tests (60 tests)
├── test_api_integration.test.js     # API endpoint tests (12 tests)
├── test_config.test.js              # Configuration tests (19 tests)
├── test_conceptModule.test.js       # Concept/restaurant tests (47 tests)
├── test_dataStore.test.js           # Database operations (23 tests)
├── test_errorManager.test.js        # Error handling (25 tests)
├── test_integration.test.js         # Integration tests (8 tests)
├── test_logger.test.js              # Logging system (22 tests)
├── test_modules.test.js             # All modules (78 tests)
├── test_moduleWrapper.test.js       # Module wrapper (27 tests)
├── test_recordingModule.test.js     # Audio recording (39 tests)
├── test_transcriptionModule.test.js # Transcription (39 tests)
└── helpers.js                       # Test utilities
```

## Test Coverage by Module

### 1. **Recording Module** (39 tests)
Tests for audio recording functionality

**Features Tested:**
- Start/stop recording
- Audio capture and playback
- Transcription workflow
- Timer functionality
- Permission handling
- Error scenarios (no microphone, permission denied)
- UI state management
- Integration workflows

**Key Test Cases:**
```javascript
✓ should start recording when start button is clicked
✓ should stop recording and display audio preview
✓ should transcribe audio via API
✓ should handle microphone permission denial
✓ should display timer in MM:SS format
✓ should discard recording and reset state
```

### 2. **Transcription Module** (39 tests)
Tests for transcription display and concept extraction

**Features Tested:**
- Transcription text display
- Concept extraction trigger
- Discard workflow
- Text validation
- Special character handling
- Multi-paragraph support
- Navigation flow

**Key Test Cases:**
```javascript
✓ should display transcription text
✓ should extract concepts when button is clicked
✓ should show error if transcription is empty
✓ should discard transcription and return to recording
✓ should handle unicode characters
✓ should preserve punctuation
```

### 3. **Concept Module** (47 tests)
Tests for restaurant details and concepts

**Features Tested:**
- Save/update restaurant
- Photo handling (camera/gallery)
- Geolocation
- Places API lookup
- Concept processing
- Description generation
- Validation rules
- Discard workflow

**Key Test Cases:**
```javascript
✓ should validate restaurant name is required
✓ should save restaurant with valid data
✓ should handle photo selection (single/multiple)
✓ should get current location via Geolocation API
✓ should reprocess concepts from transcription
✓ should generate AI description
✓ should discard restaurant and clear all fields
```

### 4. **Consolidated Modules** (78 tests)
Tests for curator, sync, export/import, quick actions, UI, and database

**A. Curator Module (7 tests)**
- Profile creation/editing
- Validation (name, API key)
- Cancel/save workflow

**B. Sync Manager (14 tests)**
- Manual/automatic sync
- Pull/push operations
- Conflict resolution
- Online/offline detection
- Sync statistics
- Version control

**C. Export/Import (13 tests)**
- JSON export
- ZIP export with photos
- Import validation
- Concierge data import
- Error handling

**D. Quick Actions (12 tests)**
- FAB button modal
- Quick record/location/photo/manual
- Modal interactions
- Auto-start workflows

**E. UI Manager (18 tests)**
- Loading states
- Section navigation
- Notifications (success/error/info)
- Modal interactions
- Bottom sheet

**F. DataStore (14 tests)**
- Database initialization
- Entity CRUD
- Curation operations
- Settings management
- Optimistic locking

### 5. **API Service** (60 tests)
Comprehensive API integration tests

**A. Authentication (4 tests)**
```javascript
✓ should accept valid API key
✓ should reject requests without API key
✓ should reject invalid API key
✓ should allow GET requests without API key
```

**B. Entity Operations (15 tests)**
```javascript
✓ should create entity
✓ should get entity by ID
✓ should list all entities
✓ should filter entities by type/status
✓ should update entity with version control
✓ should delete entity
✓ should reject update without version
```

**C. Curation Operations (11 tests)**
```javascript
✓ should create curation for entity
✓ should get curation by ID
✓ should list all curations
✓ should filter curations by entity_id/category/curator_id
✓ should update curation with version control
✓ should delete curation
✓ should create multiple curations for same entity
```

**D. Curator Operations (10 tests)**
```javascript
✓ should create curator profile
✓ should get curator by ID
✓ should list all curators
✓ should filter curators by status
✓ should update curator profile
✓ should validate email format
✓ should prevent duplicate emails
✓ should delete curator
```

**E. Advanced Entity Operations (8 tests)**
```javascript
✓ should support flexible data field
✓ should support partial updates
✓ should support entity search by name
✓ should support entity sorting
✓ should support pagination
✓ should handle status transitions
```

**F. Optimistic Locking (2 tests)**
```javascript
✓ should prevent lost updates with version control
✓ should increment version on each update
```

**G. Google Places Integration (9 tests)**
```javascript
✓ should return only restaurants when type=restaurant
✓ should accept custom place type (cafe)
✓ should handle all query parameters
✓ should return error for invalid coordinates
✓ should validate response structure
✓ should include place_id field (not id)
```

**H. Error Handling (5 tests)**
```javascript
✓ should return 404 for non-existent entity
✓ should return 403 for unauthorized requests
✓ should handle version conflicts
✓ should handle malformed JSON
✓ should validate required fields
```

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Specific Test File
```bash
npx vitest run tests/test_recordingModule.test.js
```

### Run Tests Matching Pattern
```bash
npx vitest run -t "should save restaurant"
```

## Test Configuration

### Vitest Configuration
Location: `vitest.config.js`

```javascript
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '*.config.js'
      ]
    }
  }
});
```

### Environment Variables
Location: `.env.test`

```bash
VITE_API_BASE_URL=http://localhost:8000/api/v3
VITE_API_KEY=test_api_key_12345
VITE_GOOGLE_PLACES_API_KEY=your_google_places_key
```

## Test Utilities

### Helper Functions
Location: `tests/helpers.js`

```javascript
// Check if API is available
const apiAvailable = await isApiAvailable();

// Cleanup test entities after tests
await cleanupTestEntities();

// Create test entity
const entity = await createTestEntity({
  name: 'Test Restaurant',
  type: 'restaurant'
});
```

## CI/CD Integration

### GitHub Actions Workflow
Location: `.github/workflows/test-frontend.yml`

**Triggers:**
- Push to `main`, `Front-End-V3`, `develop` branches
- Pull requests to these branches

**Steps:**
1. Checkout code
2. Setup Node.js 20.x
3. Install dependencies
4. Run tests
5. Upload coverage reports

```yaml
name: Frontend Tests

on:
  push:
    branches: [main, Front-End-V3, develop]
  pull_request:
    branches: [main, Front-End-V3, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test
      - run: npm run test:coverage
```

## Test Types

### 1. Unit Tests
Test individual functions and components in isolation
- Mock external dependencies
- Fast execution
- High coverage of edge cases

**Example:**
```javascript
test('should validate restaurant name is required', () => {
  const nameInput = document.getElementById('restaurant-name');
  nameInput.value = '';
  
  const isValid = nameInput.value.trim().length > 0;
  expect(isValid).toBe(false);
});
```

### 2. Integration Tests
Test interaction between multiple modules
- Real DOM manipulation
- Event handlers
- Module communication

**Example:**
```javascript
test('should complete full recording workflow', async () => {
  // Start recording
  await startRecording();
  
  // Stop recording
  const audioData = await stopRecording();
  
  // Transcribe
  const transcription = await transcribeAudio(audioData);
  
  expect(transcription).toBeDefined();
});
```

### 3. API Integration Tests
Test real API communication
- Require live API server
- Real HTTP requests
- Database interactions

**Example:**
```javascript
test('should create entity via API', async () => {
  const entity = {
    entity_id: `test_${Date.now()}`,
    type: 'restaurant',
    name: 'Test Restaurant'
  };
  
  const response = await fetch(`${API_BASE}/entities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    },
    body: JSON.stringify(entity)
  });
  
  expect(response.ok).toBe(true);
});
```

## Mocking Strategy

### DOM Mocking
```javascript
beforeEach(() => {
  document.body.innerHTML = `
    <button id="save-restaurant">Save</button>
    <input id="restaurant-name" />
  `;
});
```

### API Mocking
```javascript
const mockApiService = {
  searchPlaces: vi.fn().mockResolvedValue({
    results: [/* mock data */]
  })
};
```

### Browser API Mocking
```javascript
global.navigator.geolocation = {
  getCurrentPosition: vi.fn((success) => success({
    coords: { latitude: 40.7128, longitude: -74.0060 }
  }))
};
```

## Test Coverage Goals

### Current Coverage
- **Total Tests:** 399
- **Passing:** 399 (100%)
- **Failing:** 0

### Coverage by Category
- ✅ **Audio Recording:** 100% (39/39 tests)
- ✅ **Transcription:** 100% (39/39 tests)
- ✅ **Concepts/Restaurant:** 100% (47/47 tests)
- ✅ **All Modules:** 100% (78/78 tests)
- ✅ **API Service:** 100% (60/60 tests)
- ✅ **Configuration:** 100% (19/19 tests)
- ✅ **DataStore:** 100% (23/23 tests)
- ✅ **Error Manager:** 100% (25/25 tests)
- ✅ **Logger:** 100% (22/22 tests)
- ✅ **Module Wrapper:** 100% (27/27 tests)
- ✅ **Integration:** 100% (20/20 tests)

## Best Practices

### 1. Test Naming
Use descriptive test names that explain what is being tested:
```javascript
✅ test('should create entity with valid data')
❌ test('create entity')
```

### 2. Arrange-Act-Assert Pattern
```javascript
test('should update entity', async () => {
  // Arrange
  const entity = { id: 1, name: 'Original' };
  
  // Act
  const updated = await updateEntity(entity.id, { name: 'Updated' });
  
  // Assert
  expect(updated.name).toBe('Updated');
});
```

### 3. Cleanup After Tests
```javascript
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});
```

### 4. Test Independence
Each test should be independent and not rely on other tests:
```javascript
✅ Each test creates its own test data
❌ Tests share global state
```

### 5. Mock External Dependencies
```javascript
// Mock API calls
vi.mock('./apiService.js', () => ({
  fetchEntities: vi.fn()
}));

// Mock browser APIs
global.fetch = vi.fn();
```

## Debugging Tests

### Run Single Test
```bash
npx vitest run -t "should create entity"
```

### Run Tests in Debug Mode
```bash
npx vitest --inspect-brk
```

### View Test Output
```bash
npx vitest --reporter=verbose
```

### Check Coverage for Specific File
```bash
npx vitest --coverage --coverage.include=scripts/apiService.js
```

## Common Issues

### 1. Tests Skip When API Not Available
**Solution:** Start the API server before running tests
```bash
cd concierge-api-v3
./venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. DOM Not Available
**Solution:** Ensure `environment: 'jsdom'` in vitest.config.js

### 3. Async Tests Timeout
**Solution:** Increase timeout in vitest.config.js
```javascript
test: {
  testTimeout: 10000 // 10 seconds
}
```

### 4. Module Import Errors
**Solution:** Check module paths and ensure proper exports

## Future Improvements

### 1. E2E Tests
Add Playwright or Cypress for end-to-end testing
```javascript
test('complete user workflow', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.click('#start-recording');
  // ...
});
```

### 2. Visual Regression Testing
Add screenshot comparison tests
```javascript
await expect(page).toHaveScreenshot('recording-section.png');
```

### 3. Performance Testing
Add performance benchmarks
```javascript
test('entity creation should complete in < 100ms', async () => {
  const start = Date.now();
  await createEntity(testData);
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(100);
});
```

### 4. Accessibility Testing
Add a11y testing with axe-core
```javascript
const results = await axe.run(container);
expect(results.violations).toHaveLength(0);
```

## Contributing

### Adding New Tests

1. **Create test file** following naming convention:
   ```
   test_[moduleName].test.js
   ```

2. **Import dependencies:**
   ```javascript
   import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
   ```

3. **Write descriptive tests:**
   ```javascript
   describe('ModuleName - Feature Category', () => {
     test('should perform specific action', () => {
       // Test implementation
     });
   });
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

5. **Ensure all tests pass** before committing

### Test Review Checklist

- [ ] Test names are descriptive
- [ ] Tests are independent
- [ ] Mocks are properly configured
- [ ] Cleanup is performed after tests
- [ ] Edge cases are covered
- [ ] Error scenarios are tested
- [ ] All tests pass locally
- [ ] Coverage is maintained or improved

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Jest DOM Matchers](https://github.com/testing-library/jest-dom)
- [Mock Service Worker](https://mswjs.io/)

## Support

For questions or issues with tests:
1. Check this documentation
2. Review test examples in `tests/` directory
3. Check GitHub Issues
4. Contact the development team

---

**Last Updated:** 2025-11-20
**Test Count:** 399 passing
**Status:** ✅ All tests passing
