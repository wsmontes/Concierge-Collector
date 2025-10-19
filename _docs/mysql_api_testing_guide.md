# MySQL API Testing Guide

## Overview

This document provides instructions for testing the new MySQL-based Concierge Entities API before migrating the Collector application to use it.

## Test Files

### 1. `scripts/mysqlApiTester.js`
- **Purpose**: Core testing module that performs comprehensive API validation
- **Dependencies**: ModuleWrapper pattern
- **Key Features**:
  - Tests all API endpoints (health, info, entities, curators, import)
  - Performs full CRUD operations
  - Validates response formats
  - Generates detailed test reports
  - Provides migration readiness assessment

### 2. `test-mysql-api.html`
- **Purpose**: User-friendly web interface for running tests
- **Features**:
  - Environment selection (production/development)
  - Real-time console output
  - Visual statistics dashboard
  - Migration readiness assessment
  - Export test results as JSON

## How to Run Tests

### Method 1: Using the Web Interface (Recommended)

1. Open `test-mysql-api.html` in your browser
2. Select the environment (Production or Development)
3. Click "Run All Tests"
4. View results in the console and statistics panel
5. Export results if needed

### Method 2: Using Browser Console

```javascript
// Create tester instance
const tester = new window.MySQLApiTester();

// Set environment (optional)
tester.setEnvironment('production'); // or 'development'

// Run all tests
const results = await tester.runAllTests();

// Export results
tester.exportResults();
```

## Test Coverage

### Health & Info Tests
- ✅ API health check
- ✅ Database connectivity
- ✅ API information and endpoints

### Entity CRUD Tests
- ✅ Get entities with filters and pagination
- ✅ Create new entity
- ✅ Get specific entity by ID
- ✅ Update existing entity
- ✅ Search entities by name
- ✅ Delete entity

### Curator Tests
- ✅ Get all curators

### Import Tests
- ✅ Import Concierge V2 format entities

## Test Results Interpretation

### Success Criteria
- **100% Pass Rate**: API is fully functional and ready for migration
- **80-99% Pass Rate**: Most features work, minor issues to address
- **< 80% Pass Rate**: Significant issues, not ready for migration

### Migration Readiness Levels

#### ✅ READY FOR MIGRATION
- All tests passed
- API is fully functional
- Safe to proceed with migration

#### ⚠️ MIGRATION WITH CAUTION
- Most tests passed (≥80%)
- Some issues detected
- Review and fix critical issues before migrating

#### ❌ NOT READY FOR MIGRATION
- Multiple test failures (< 80% pass rate)
- Fix API issues before attempting migration

## API Endpoints Tested

### Production
```
Base URL: https://wsmontes.pythonanywhere.com/mysql-api
Note: Uses /mysql-api/ prefix due to integration with existing Concierge Analyzer app
```

### Development
```
Base URL: http://localhost:5001/api
```

### Endpoints
- `GET /health` - Health check
- `GET /info` - API information
- `GET /entities` - Get entities with filters
- `GET /entities/{id}` - Get specific entity
- `POST /entities` - Create entity
- `PUT /entities/{id}` - Update entity
- `DELETE /entities/{id}` - Delete entity
- `GET /curators` - Get curators
- `POST /import/concierge-v2` - Import Concierge V2 format

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to API
**Solutions**:
1. Check if API server is running
2. Verify the correct base URL is configured
3. Check CORS settings if using development environment
4. Ensure network connectivity

### Test Failures

**Problem**: Tests are failing
**Solutions**:
1. Check the console output for specific error messages
2. Verify database is properly configured
3. Ensure all required database tables exist
4. Check API server logs for errors

### Import Issues

**Problem**: Concierge V2 import fails
**Solutions**:
1. Verify JSON format matches Concierge V2 schema
2. Check entity data structure
3. Ensure metadata array is properly formatted
4. Validate location data (latitude/longitude)

## Test Data Cleanup

The tester automatically cleans up test entities created during testing. Test entities are identified by:
- Name containing "Test Restaurant - API Tester"
- Name containing "API Test Import Restaurant"
- `test: true` flag in entity_data

If cleanup fails, you can manually delete test entities using:
```javascript
// Get entity ID from test results
const entityId = 123;

// Delete manually
await fetch(`${tester.baseUrl}/entities/${entityId}`, {
    method: 'DELETE'
});
```

## Integration with Collector

Once tests pass successfully:

1. **Update API Configuration**
   - Add MySQL API endpoint to configuration
   - Configure authentication if required

2. **Migrate Data Storage**
   - Export current data from Collector
   - Import to MySQL API using `/import/concierge-v2` endpoint

3. **Update Sync Service**
   - Modify syncService.js to use new API
   - Update CRUD operations to use API endpoints

4. **Test Integration**
   - Test all Collector features with new API
   - Verify data sync works correctly
   - Validate search and filter functionality

## Expected Test Output

### Successful Test Run Example
```
🚀 Starting MySQL API Test Suite
Testing API: https://wsmontes.pythonanywhere.com/api
============================================================

🔍 Testing: Health Check Endpoint
   ✅ HTTP status is OK (200)
   ✅ API status is healthy
   ✅ Database is healthy
   ✅ Timestamp is present
   ✨ Health Check Endpoint: PASSED

[... more tests ...]

============================================================
📊 TEST SUMMARY
============================================================
Total Tests: 10
Passed: 10 ✅
Failed: 0 ❌
Pass Rate: 100.0%
Duration: 2.45s

============================================================
✅ MIGRATION READY: All tests passed!
🚀 The API is fully functional and ready for production use.
============================================================
```

## Next Steps After Successful Testing

1. ✅ Review test results and ensure 100% pass rate
2. ✅ Verify migration readiness assessment
3. ✅ Export and save test results for documentation
4. ✅ Plan data migration from current storage to MySQL API
5. ✅ Update Collector application to use new API
6. ✅ Perform integration testing
7. ✅ Deploy to production

## Support

For issues or questions:
1. Check API documentation in `MySQL - NEW API - README.md`
2. Review test console output for specific errors
3. Check API server logs for backend issues
4. Verify database schema matches requirements

---

**Note**: Always test in development environment first before running production tests.
