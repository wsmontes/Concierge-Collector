# 🧪 Collector V3 API Test Suite

## Quick Start

### 1. Start API V3 (in terminal 1)
```bash
cd concierge-api-v3
source venv/bin/activate
python3 main.py
```

### 2. Run Test Suite (in terminal 2)
```bash
./run_collector_tests.sh
```

### 3. Open in Browser
Navigate to: **http://localhost:8000/test_collector_v3.html**

---

## What This Tests

### ✅ 19+ Comprehensive Tests

1. **System Health (3 tests)**
   - API connectivity
   - Health check endpoint
   - Network latency

2. **Entity Operations (6 tests)**
   - Create, Read, Update, Delete
   - List with filters
   - Pagination

3. **Curation Operations (6 tests)**
   - Create, Read, Update, Delete
   - Search functionality
   - Entity-specific curations

4. **Advanced Features (4 tests)**
   - Optimistic locking (ETag)
   - Pagination
   - Error handling
   - Bulk operations

---

## Test Interface

### Features
- 🎯 **One-Click Testing**: Run all tests or individual tests
- 📊 **Real-time Statistics**: Track passed/failed tests
- 🎨 **Color-coded Results**: Green (success), Red (error), Blue (info)
- 📝 **Detailed Logs**: JSON-formatted response data
- 🧹 **Easy Cleanup**: Clear results button

### UI Sections
1. **API Configuration**: Shows connection status and settings
2. **Statistics Dashboard**: Total/Passed/Failed counts
3. **Test Categories**: Organized by functionality
4. **Results Panel**: Scrollable test results with timestamps

---

## API Endpoints Tested

### System
- `GET /health` - Health check
- `GET /info` - API information

### Entities
- `POST /entities` - Create entity
- `GET /entities` - List entities (with filters)
- `GET /entities/{id}` - Get single entity
- `PATCH /entities/{id}` - Update entity (with ETag)
- `DELETE /entities/{id}` - Delete entity

### Curations
- `POST /curations` - Create curation
- `GET /curations/search` - Search curations
- `GET /curations/{id}` - Get single curation
- `PATCH /curations/{id}` - Update curation (with ETag)
- `DELETE /curations/{id}` - Delete curation
- `GET /entities/{id}/curations` - Get entity curations

---

## Expected Results

### ✅ Success Criteria
- All 19+ tests pass
- 100% success rate
- No 500 errors
- Optimistic locking works correctly
- Pagination returns different results
- Error handling catches 404s

### Sample Output
```
Total Tests: 19
Passed: 19
Failed: 0
Success Rate: 100%
```

---

## Test Data

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
    "reviewer": "Test Suite"
  }
}
```

---

## Files Created

1. **test_collector_v3.html** (1000+ lines)
   - Complete test suite UI
   - All test functions
   - Real-time results display

2. **COLLECTOR_V3_TEST_GUIDE.md** (400+ lines)
   - Comprehensive documentation
   - Troubleshooting guide
   - Test scenarios

3. **run_collector_tests.sh**
   - Quick launch script
   - API health check
   - HTTP server setup

---

## Integration with Collector

This test suite validates the same API methods used by:

- **syncManager.js** - Sync operations
- **apiService.js** - All API calls  
- **modules/curatorModule.js** - Curator operations
- **modules/exportImportModule.js** - Import/export

### Key API Methods Tested
```javascript
// From apiService.js
await apiService.getEntities(params)
await apiService.createEntity(data)
await apiService.updateEntity(id, data, etag)
await apiService.deleteEntity(id, etag)
await apiService.searchCurations(params)
await apiService.createCuration(data)
await apiService.getEntityCurations(entityId)
```

---

## Troubleshooting

### API Not Running
```bash
# Check if API is running
curl http://localhost:8001/health

# Start API if needed
cd concierge-api-v3
source venv/bin/activate
python3 main.py
```

### Port 8000 In Use
```bash
# Find process using port 8000
lsof -i :8000

# Kill process if needed
kill -9 <PID>
```

### Tests Failing
1. Clear results and retry
2. Restart API server
3. Check MongoDB connection
4. Review browser console for errors
5. Check API logs in `concierge-api-v3/logs/`

### CORS Errors
If testing against production API, ensure CORS headers are set:
```python
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', '*')
    return response
```

---

## Manual Testing Alternative

If you prefer curl:

```bash
# Health check
curl http://localhost:8001/health

# List entities
curl http://localhost:8001/entities?limit=5

# Create entity
curl -X POST http://localhost:8001/entities \
  -H "Content-Type: application/json" \
  -d '{"type":"restaurant","name":"Test","data":{}}'

# Get entity
curl http://localhost:8001/entities/<id>

# Search curations
curl http://localhost:8001/curations/search?limit=5
```

---

## Next Steps

After successful testing:

1. ✅ Verify all tests pass (19/19)
2. ✅ Test real data sync from Collector
3. ✅ Test import/export workflows
4. ✅ Performance test with large datasets
5. ✅ Load test with concurrent users
6. ✅ Test authentication (when implemented)

---

## Documentation

- **Test Guide:** `COLLECTOR_V3_TEST_GUIDE.md`
- **API Docs:** `API-REF/API_DOCUMENTATION_V3.md`
- **Quick Reference:** `API-REF/API_QUICK_REFERENCE.md`
- **Setup Guide:** `concierge-api-v3/SETUP_SEM_DOCKER.md`

---

## Technology Stack

- **Frontend:** Vanilla JavaScript, HTML5, CSS3
- **API Client:** apiService.js (from Collector)
- **API Server:** FastAPI 0.109.0 + Motor 3.3 (async MongoDB)
- **Database:** MongoDB Atlas
- **Test Runner:** Custom JavaScript test framework

---

**Created:** November 17, 2025  
**Version:** 1.0  
**Status:** ✅ Ready for Testing
