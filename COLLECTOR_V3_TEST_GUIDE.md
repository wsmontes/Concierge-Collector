# Collector V3 API Test Suite - Guide

## 📋 Overview

Comprehensive test suite for validating the Concierge Collector integration with the MongoDB-based Entity-Curation API V3.

**Test File:** `test_collector_v3.html`

## 🎯 Purpose

This test suite validates:
- API connectivity and health
- Entity CRUD operations
- Curation CRUD operations
- Optimistic locking with ETags
- Pagination and filtering
- Error handling
- Bulk operations

## 🚀 Quick Start

### 1. Start the API V3 Server

```bash
cd concierge-api-v3
source venv/bin/activate
python3 main.py
```

The API should be running on `http://localhost:8001`

### 2. Open the Test Suite

Open `test_collector_v3.html` in your browser or use VS Code Live Server:

```bash
# Using Python's built-in server
python3 -m http.server 8000

# Then open http://localhost:8000/test_collector_v3.html
```

### 3. Run Tests

- Click **"🚀 Run All Tests"** to execute the complete test suite
- Or click individual test buttons to run specific tests
- Results appear in real-time with color-coded status

## 📊 Test Categories

### 🏥 System Health Tests (3 tests)

| Test | Description | Validates |
|------|-------------|-----------|
| Health Check | GET `/health` | API is running |
| API Info | GET `/info` | API metadata |
| Network Test | Latency measurement | Connection speed |

### 📦 Entity CRUD Tests (6 tests)

| Test | Description | HTTP Method | Endpoint |
|------|-------------|-------------|----------|
| Create Entity | Creates test restaurant | POST | `/entities` |
| List Entities | Fetches entity list | GET | `/entities` |
| Get by ID | Fetches single entity | GET | `/entities/{id}` |
| Update Entity | Updates with ETag | PATCH | `/entities/{id}` |
| Delete Entity | Removes entity | DELETE | `/entities/{id}` |
| Filter Entities | Tests query params | GET | `/entities?type=X` |

### ✨ Curation CRUD Tests (6 tests)

| Test | Description | HTTP Method | Endpoint |
|------|-------------|-------------|----------|
| Create Curation | Creates test review | POST | `/curations` |
| Search Curations | Searches curations | GET | `/curations/search` |
| Get by ID | Fetches single curation | GET | `/curations/{id}` |
| Update Curation | Updates with ETag | PATCH | `/curations/{id}` |
| Delete Curation | Removes curation | DELETE | `/curations/{id}` |
| Entity Curations | Gets all for entity | GET | `/entities/{id}/curations` |

### 🔬 Advanced Tests (4 tests)

| Test | Description | Validates |
|------|-------------|-----------|
| Optimistic Locking | ETag validation | Concurrent update protection |
| Pagination | Offset/limit params | Paginated results |
| Error Handling | 404 responses | Error messages |
| Bulk Operations | Multiple creates | Batch processing |

## 📈 Test Results

### Success Indicators
- ✅ Green results = Test passed
- ❌ Red results = Test failed  
- ℹ️ Blue results = Info/progress

### Statistics Dashboard
- **Total Tests:** Count of all executed tests
- **Passed:** Successfully completed tests
- **Failed:** Tests with errors

### Result Details
Each result shows:
- Status icon (✅/❌/ℹ️)
- Test name
- Timestamp
- Response data (JSON formatted)

## 🔧 Configuration

The test suite automatically detects configuration from `scripts/config.js`:

```javascript
backend: {
    baseUrl: 'http://localhost:8001',
    timeout: 30000,
    retryAttempts: 3
}
```

### Displayed in UI:
- **Base URL:** API endpoint
- **Status:** Connection state
- **Auth Token:** JWT status (if authenticated)

## 🧪 Test Scenarios

### Scenario 1: Basic CRUD Flow
```
1. Create Entity → 2. Get Entity → 3. Update Entity → 4. Delete Entity
```

### Scenario 2: Entity with Curations
```
1. Create Entity
2. Create Curation for Entity
3. Get Entity Curations
4. Update Curation
5. Delete Curation
6. Delete Entity
```

### Scenario 3: Optimistic Locking
```
1. Create Entity
2. Get Entity (with ETag)
3. Try Update with wrong ETag (should fail)
4. Update with correct ETag (should succeed)
```

### Scenario 4: Pagination
```
1. Create multiple entities
2. Get page 1 (limit=5, offset=0)
3. Get page 2 (limit=5, offset=5)
4. Verify different results
```

## 📝 Test Data Structure

### Entity Example
```json
{
  "type": "restaurant",
  "name": "Test Restaurant 1234567890",
  "data": {
    "description": "Test entity created by test suite",
    "city": "Test City",
    "country": "Test Country"
  }
}
```

### Curation Example
```json
{
  "entity_id": "507f1f77bcf86cd799439011",
  "category": "review",
  "data": {
    "rating": 5,
    "review": "Excellent test restaurant!",
    "reviewer": "Test Suite",
    "date": "2025-11-17T10:00:00.000Z"
  }
}
```

## 🐛 Troubleshooting

### API Not Connected
**Problem:** Status shows "❌ Failed"

**Solutions:**
1. Verify API is running: `curl http://localhost:8001/health`
2. Check port 8001 is not in use: `lsof -i :8001`
3. Review API logs for errors
4. Verify MongoDB connection in API

### Tests Failing
**Problem:** Multiple test failures

**Solutions:**
1. Clear test data: Click "🗑️ Clear Results"
2. Restart API server
3. Check MongoDB Atlas connection
4. Verify auth token if required
5. Check browser console for errors

### Optimistic Locking Failures
**Problem:** Update tests failing with 409 Conflict

**Solutions:**
1. Entity may have been modified by another process
2. Ensure you're using latest ETag
3. Re-fetch entity before update
4. Check `_version` field matches

### Network Timeout
**Problem:** Tests timing out

**Solutions:**
1. Increase timeout in `config.js`
2. Check network connectivity
3. Verify API performance
4. Check MongoDB query performance

## 🔒 Authentication (Future)

Currently tests run without authentication. When auth is required:

1. **Login:**
   ```javascript
   await apiService.login('username', 'password');
   ```

2. **Token Storage:**
   Token automatically stored in localStorage

3. **Authenticated Requests:**
   All requests include `Authorization: Bearer <token>` header

## 📦 Cleanup

The test suite tracks created resources and attempts cleanup:

- **Created Entities:** Stored in `createdEntities[]`
- **Created Curations:** Stored in `createdCurations[]`
- **Auto-cleanup:** Delete tests remove test data

### Manual Cleanup (if needed)

```bash
# Via MongoDB shell
mongosh "mongodb+srv://concierge-collector.7bwiisy.mongodb.net/" \
  --username wmontes_db_user

use concierge_v3
db.entities.deleteMany({ name: /^Test Restaurant/ })
db.curations.deleteMany({ "data.reviewer": "Test Suite" })
```

## 🎨 UI Features

### Color Coding
- **Purple gradient:** Headers and primary buttons
- **Pink gradient:** Run All Tests button
- **Orange gradient:** Clear Results button
- **Green:** Success messages
- **Red:** Error messages
- **Blue:** Info messages

### Responsive Design
- Grid layout adapts to screen size
- Mobile-friendly test buttons
- Scrollable results panel
- Auto-scroll to latest results

### Real-time Updates
- Statistics update immediately
- Results appear as tests complete
- Latest results at top
- Timestamps for each test

## 📚 Related Documentation

- **API V3 Documentation:** `API-REF/API_DOCUMENTATION_V3.md`
- **Quick Reference:** `API-REF/API_QUICK_REFERENCE.md`
- **OpenAPI Spec:** `API-REF/openapi.yaml`
- **Setup Guide:** `concierge-api-v3/SETUP_SEM_DOCKER.md`
- **Testing Guide:** `concierge-api-v3/TESTING_GUIDE.md`

## 🔄 Integration with Collector

This test suite validates the same API methods used by:

- **syncManager.js** - Sync operations
- **apiService.js** - All API calls
- **modules/curatorModule.js** - Curator operations
- **modules/exportImportModule.js** - Import/export

## ✅ Success Criteria

A successful test run should show:

- ✅ All system health tests pass (3/3)
- ✅ All entity CRUD tests pass (6/6)
- ✅ All curation CRUD tests pass (6/6)
- ✅ All advanced tests pass (4/4)
- ✅ Total: 19+ tests passed
- ✅ Success rate: 100%

## 🚨 Known Issues

### Issue 1: CORS in Production
When testing against production API, CORS may block requests.

**Solution:** API must include CORS headers:
```python
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response
```

### Issue 2: Rate Limiting
Bulk operations may hit rate limits.

**Solution:** Add delays between requests or increase rate limit.

## 🎯 Next Steps

After successful testing:

1. ✅ Confirm all tests pass
2. ✅ Test with real data from Collector
3. ✅ Test sync operations (uploadRestaurantToServer)
4. ✅ Test import/export workflows
5. ✅ Performance testing with large datasets
6. ✅ Load testing with concurrent users

## 📞 Support

For issues or questions:
1. Check API logs: `concierge-api-v3/logs/`
2. Check browser console for errors
3. Review test results details
4. Check MongoDB Atlas metrics
5. Verify network connectivity

---

**Last Updated:** November 17, 2025  
**Test Suite Version:** 1.0  
**API Version:** V3 (MongoDB)
