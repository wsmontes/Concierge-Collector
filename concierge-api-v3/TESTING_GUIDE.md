# Testing Guide - Preventing Future Issues

## Overview
This document explains how to run tests that would have caught the async/await bug before deployment.

## The Bug That Was Missed
The AI orchestrate endpoint was calling an async method without `await`, causing 500 errors. This happened because:
1. Tests were too permissive (accepting 500 as valid response)
2. No integration tests for the transcription workflow
3. No specific tests for async/await issues

## New Test Coverage

### 1. Unit Tests for AI Orchestrate (`test_ai_orchestrate.py`)
Comprehensive tests that specifically check for:
- Async/await issues
- Proper error handling (no 500 errors from code bugs)
- Response structure validation
- Authentication requirements

```bash
pytest tests/test_ai_orchestrate.py -v
```

### 2. Integration Tests (`test_integration_transcription.py`)
End-to-end tests that simulate the exact frontend workflow:
- Convert audio to base64
- Send to API with OAuth token
- Verify response structure
- Test concurrent requests

```bash
pytest tests/test_integration_transcription.py -v
```

### 3. Updated Existing Tests (`test_ai.py`)
Made tests stricter:
- ❌ No longer accepts 500 as valid response
- ✅ Explicit assertions that catch async/await bugs
- ✅ Clear error messages when bugs are detected

## Running Tests

### Run All Tests
```bash
cd concierge-api-v3
pytest tests/ -v
```

### Run Only AI Tests
```bash
pytest tests/test_ai*.py -v
```

### Run with Coverage
```bash
pytest tests/ --cov=app --cov-report=html
open htmlcov/index.html
```

### Run Specific Test
```bash
pytest tests/test_ai_orchestrate.py::TestAIOrchestrate::test_orchestrate_endpoint_is_async -v
```

## Test Assertions That Would Have Caught The Bug

### Before (Permissive)
```python
# ❌ This allowed the bug to slip through
assert response.status_code in [200, 400, 422, 500]
```

### After (Strict)
```python
# ✅ This would have caught the bug
assert response.status_code != 500, \
    f"❌ CRITICAL: 500 error - likely async/await bug!\n{response.text}"
```

## CI/CD Integration

### GitHub Actions (Recommended)
Add to `.github/workflows/test.yml`:
```yaml
name: Run Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with:
          python-version: '3.13'
      - name: Install dependencies
        run: |
          cd concierge-api-v3
          pip install -r requirements.txt
      - name: Run tests
        run: |
          cd concierge-api-v3
          pytest tests/ -v
```

### Pre-commit Hook
Add to `.git/hooks/pre-commit`:
```bash
#!/bin/bash
cd concierge-api-v3
pytest tests/test_ai*.py -v
if [ $? -ne 0 ]; then
    echo "❌ Tests failed! Fix before committing."
    exit 1
fi
```

## Test Requirements

### Environment Variables for Testing
Create `concierge-api-v3/.env.test`:
```bash
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=concierge-test
OPENAI_API_KEY=test_key_for_testing
API_SECRET_KEY=test_secret_key
ENVIRONMENT=testing
```

### Mock Data
Tests use minimal mock data to avoid actual API calls:
- Mock audio: minimal WAV header
- Mock tokens: test JWT tokens
- Mock responses: predefined AI responses

## What Tests Prevent

✅ **Async/await bugs** - Tests explicitly check for 500 errors from code issues
✅ **Authentication bypasses** - Tests verify OAuth is required
✅ **Response structure changes** - Tests validate expected response format
✅ **CORS issues** - Tests check headers are present
✅ **Concurrent request issues** - Tests simulate multiple simultaneous requests

## Running Tests Before Deployment

### Local Testing
```bash
# 1. Set up test environment
cd concierge-api-v3
cp .env .env.backup
cp .env.test .env

# 2. Run tests
pytest tests/ -v

# 3. Restore environment
mv .env.backup .env
```

### Render Deployment Testing
```bash
# Test against production API (after deployment)
cd concierge-api-v3
./test_ai_endpoint.sh production
```

## Coverage Goals

Current test coverage focus:
- ✅ AI orchestrate endpoint: 80%+
- ✅ Authentication flow: 70%+
- 🔄 Entity CRUD: 60%+ (to be improved)
- 🔄 Places API: 50%+ (to be improved)

## Best Practices

1. **Never accept 500 as valid** - Code bugs should fail tests
2. **Test the happy path AND error paths** - Both should handle gracefully
3. **Test async endpoints with async clients** - Catches async/await issues
4. **Run tests before every push** - Catch bugs before deployment
5. **Write tests for every bug fix** - Prevent regression

## Example: Testing Checklist

Before deploying AI changes:
- [ ] Run `pytest tests/test_ai*.py -v`
- [ ] All tests pass without 500 errors
- [ ] New features have corresponding tests
- [ ] Integration test covers the workflow
- [ ] Manual test on staging environment

## Resources

- [FastAPI Testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [Pytest Documentation](https://docs.pytest.org/)
- [AsyncIO Testing](https://docs.python.org/3/library/asyncio-dev.html#asyncio-dev)
