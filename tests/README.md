# Front-End Testing Suite

## 📊 Test Statistics

- **Total Tests**: 158
- **Pass Rate**: 100% ✅
- **Test Files**: 8
- **Execution Time**: ~11s
- **Coverage**: API integration, data storage, core modules

## 🏗️ Test Structure

```
tests/
├── .env.test.example          # Environment configuration template
├── conftest.js                # Global test setup and mocks
├── helpers.js                 # Test utilities and fixtures
├── README.md                  # This file
│
├── API & Integration Tests (57 tests)
│   ├── test_api_integration.test.js    # Real API integration (12 tests)
│   ├── test_apiService.test.js         # API service layer (22 tests)
│   ├── test_integration.test.js        # Workflow integration (8 tests)
│   └── test_dataStore.test.js          # Local storage CRUD (23 tests)
│
└── Module Tests (101 tests)
    ├── test_config.test.js             # Configuration validation (19 tests)
    ├── test_logger.test.js             # Logging system (22 tests)
    ├── test_errorManager.test.js       # Error handling (25 tests)
    └── test_moduleWrapper.test.js      # Module pattern (27 tests)
```

## 🚀 Quick Start

### Installation
```bash
# Install dependencies (from project root)
npm install
```

### Running Tests
```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run with coverage report
npm run test:coverage

# Open interactive UI
npm run test:ui
```

### Environment Configuration
```bash
# Copy example configuration
cp tests/.env.test.example .env.test

# Edit with your API key (from backend/.env)
# API_SECRET_KEY=your_api_key_here
```

## 📝 Test Categories

### 1. API Integration Tests (test_api_integration.test.js)
Tests real API communication with the V3 backend:
- Health checks and API info
- Entity CRUD operations
- Curation management
- Version control (optimistic locking)
- Error handling (404, 403, 409)

**Key Features:**
- Uses REAL API (not mocks)
- Tests actual MongoDB operations
- Validates request/response schemas
- Automatic cleanup after tests

### 2. API Service Tests (test_apiService.test.js)
Tests the API service layer:
- Authentication (API key validation)
- Entity operations (create, read, update, delete)
- Query parameters and filters
- Pagination
- Version conflict handling
- Error responses

### 3. Integration Tests (test_integration.test.js)
Tests complete workflows:
- Entity lifecycle (create → sync → update → delete)
- Offline-first workflow
- Version conflict resolution
- Error recovery
- Data merging strategies
- Sync queue processing

### 4. DataStore Tests (test_dataStore.test.js)
Tests local IndexedDB storage:
- CRUD operations
- Filtering (by type, status, search)
- Data validation
- Edge cases
- Sync status tracking

### 5. Config Tests (test_config.test.js)
Validates application configuration:
- API endpoint definitions
- Timeout settings
- Feature flags
- URL validation
- External service configuration
- Authentication settings

### 6. Logger Tests (test_logger.test.js)
Tests logging system:
- Log level filtering
- Module-scoped logging
- Debug mode toggle
- Message formatting
- Console method routing
- Performance optimization

### 7. Error Manager Tests (test_errorManager.test.js)
Tests error handling:
- Error classification (network, API, validation)
- User-friendly messages
- Retry strategies
- Error context capture
- Error display
- API error parsing

### 8. Module Wrapper Tests (test_moduleWrapper.test.js)
Tests module pattern:
- Encapsulation
- Public/private API separation
- Dependency injection
- Module lifecycle
- Event system
- State management

## 🔧 Test Utilities

### helpers.js
Provides reusable test utilities:

```javascript
// Environment configuration
import { TEST_API_BASE, TEST_API_KEY } from './helpers.js';

// Create test data
const entity = createTestEntity({ name: 'Test Restaurant' });
const curation = createTestCuration({ curator_name: 'Test Curator' });

// Check API availability
if (await isApiAvailable()) {
  // Run API tests
}

// Cleanup after tests
await cleanupTestEntities();
await cleanupTestCurations();
```

### conftest.js
Global test configuration:
- LocalStorage mock
- Logger mock
- AppConfig mock
- ModuleWrapper mock
- Dexie (IndexedDB) mock

## ✅ Best Practices

### 1. Use Real API When Possible
```javascript
// ✅ GOOD: Test against real API
const response = await fetch(`${API_BASE}/entities`, {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY },
  body: JSON.stringify(entity)
});

// ❌ AVOID: Over-reliance on mocks
fetch.mockResolvedValue({ ok: true });
```

### 2. Clean Up After Tests
```javascript
afterAll(async () => {
  await cleanupTestEntities();
  await cleanupTestCurations();
});
```

### 3. Check API Availability
```javascript
beforeAll(async () => {
  apiAvailable = await isApiAvailable();
  if (!apiAvailable) {
    console.warn('⚠️  API not available - skipping tests');
  }
});

test('should create entity', async () => {
  if (!apiAvailable) return; // Skip if API is down
  // ... test code
});
```

### 4. Use Descriptive Test Names
```javascript
// ✅ GOOD
test('should reject update without version control header', async () => {
  // ...
});

// ❌ AVOID
test('test update', async () => {
  // ...
});
```

### 5. Group Related Tests
```javascript
describe('Entity Operations', () => {
  describe('Create', () => {
    test('should create valid entity', () => { });
    test('should reject invalid entity', () => { });
  });
  
  describe('Update', () => {
    test('should update with version', () => { });
    test('should detect conflicts', () => { });
  });
});
```

## 🔍 Debugging Tests

### Run Specific Test File
```bash
npm test test_apiService
```

### Run Specific Test
```bash
npm test -- -t "should create entity"
```

### Enable Verbose Output
```bash
npm test -- --reporter=verbose
```

### Debug with Chrome DevTools
```bash
npm run test:ui
# Opens browser with interactive debugger
```

## 📈 Coverage Reporting

Coverage is measured using Vitest's built-in coverage tool (v8):

```bash
# Generate coverage report
npm run test:coverage

# Coverage files are generated in:
coverage/
├── index.html          # HTML report (open in browser)
├── coverage-summary.json
└── lcov.info
```

### Coverage Thresholds
- Statements: 70%
- Branches: 70%
- Functions: 70%
- Lines: 70%

## 🚨 Troubleshooting

### API Not Available
```
⚠️  API not available - skipping tests
```
**Solution**: Start the backend API server:
```bash
cd concierge-api-v3
python main.py
```

### API Key Error
```
API_SECRET_KEY not found in .env.test file
```
**Solution**: Create `.env.test` file:
```bash
cp tests/.env.test.example .env.test
# Add API_SECRET_KEY from backend/.env
```

### IndexedDB Errors
```
localStorage error
```
**Solution**: Tests use fake-indexeddb automatically. If errors persist, check conftest.js mocks.

### Network Errors
```
Failed to fetch
```
**Solution**: 
1. Check backend is running on http://localhost:8000
2. Check CORS settings in backend
3. Verify API key is correct

## 🔐 Environment Variables

Required in `.env.test`:
```bash
API_V3_BASE_URL=http://localhost:8000/api/v3
API_SECRET_KEY=<your_api_key_from_backend>
TEST_TIMEOUT=5000
TEST_CLEANUP_ENABLED=true
```

## 📚 Additional Resources

- [Vitest Documentation](https://vitest.dev/)
- [API V3 Documentation](../API-REF/API_DOCUMENTATION_V3.md)
- [Backend API Endpoints](../concierge-api-v3/README.md)

## 🤝 Contributing

When adding new tests:

1. **Follow existing patterns**: Use the same structure as existing test files
2. **Use helpers**: Leverage `helpers.js` for common operations
3. **Test with real API**: Prefer real API calls over mocks when possible
4. **Clean up**: Always clean up test data in `afterAll` or `afterEach`
5. **Document**: Add comments for complex test scenarios
6. **Run all tests**: Ensure `npm test` passes before committing

## 📋 Checklist for New Features

- [ ] Unit tests for new modules
- [ ] Integration tests for workflows
- [ ] API tests for new endpoints
- [ ] Update helpers.js if needed
- [ ] Update this README if structure changes
- [ ] Ensure all tests pass (`npm test`)
- [ ] Check coverage (`npm run test:coverage`)
