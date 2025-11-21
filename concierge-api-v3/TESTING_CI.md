# CI/CD Testing Configuration

This document explains the pytest markers and CI configuration for GitHub Actions.

## Pytest Markers

Tests are categorized using pytest markers to allow selective test execution:

### Available Markers

- **`@pytest.mark.integration`** - Integration tests that hit external APIs
  - Tests requiring live Google Places API
  - End-to-end workflow tests
  - Can be skipped with: `pytest -m "not integration"`

- **`@pytest.mark.external_api`** - Tests requiring external API access
  - Google Places API tests
  - Any test that makes HTTP calls to external services
  - Can be skipped with: `pytest -m "not external_api"`

- **`@pytest.mark.mongo`** - Tests requiring MongoDB connection
  - Entity CRUD operations
  - Curation operations
  - Concepts operations
  - Can be skipped with: `pytest -m "not mongo"`

- **`@pytest.mark.openai`** - Tests requiring OpenAI API access
  - AI orchestration tests
  - Transcription workflow tests
  - Can be skipped with: `pytest -m "not openai"`

- **`@pytest.mark.slow`** - Tests that take more than 5 seconds
  - Can be skipped with: `pytest -m "not slow"`

## Test File Categories

### Unit Tests (No external dependencies)
- `test_auth.py` - Authentication endpoint tests
- `test_system.py` - Health check and info endpoints

### Tests Requiring MongoDB
- `test_entities.py` - Entity CRUD operations
- `test_curations.py` - Curation operations
- `test_concepts.py` - Concepts operations
- `test_integration.py` - Integration workflows

### Tests Requiring External APIs
- `test_places.py` - Google Places API integration
- `test_places_fields.py` - Places API field validation (marked with `@pytest.mark.integration`)

### Tests Requiring OpenAI API
- `test_ai.py` - AI endpoints
- `test_ai_orchestrate.py` - AI orchestration workflows
- `test_integration_transcription.py` - Transcription integration tests

## Running Tests Locally

### Run all tests:
```bash
pytest tests/ -v
```

### Run only unit tests (no external dependencies):
```bash
pytest tests/ -v -m "not integration and not external_api and not mongo and not openai"
```

### Run only MongoDB tests:
```bash
pytest tests/ -v -m "mongo"
```

### Run only tests that don't need MongoDB:
```bash
pytest tests/ -v -m "not mongo"
```

### Run only integration tests:
```bash
pytest tests/ -v -m "integration"
```

### Skip slow tests:
```bash
pytest tests/ -v -m "not slow"
```

## GitHub Actions CI Configuration

The GitHub Actions workflow (`.github/workflows/test-backend.yml`) automatically:

1. **Skips external dependency tests** - Only runs tests that don't require:
   - MongoDB connection
   - Google Places API
   - OpenAI API
   - External integration tests

2. **Test command used**:
   ```bash
   pytest tests/ -v -m "not integration and not external_api and not mongo and not openai"
   ```

3. **Why we skip these tests in CI**:
   - **MongoDB**: CI environment may not have MongoDB configured
   - **External APIs**: Rate limits, costs, and API keys not available in CI
   - **Integration tests**: Require live services and proper configuration
   - **OpenAI tests**: Require API keys and incur usage costs

## Adding New Tests

When adding new tests:

1. **No external dependencies** → No marker needed
   ```python
   def test_my_unit_test(client):
       # Pure unit test, no marker needed
       pass
   ```

2. **Requires MongoDB** → Add `@pytest.mark.mongo`
   ```python
   @pytest.mark.mongo
   def test_my_database_test(client):
       pass
   ```

3. **Requires external API** → Add `@pytest.mark.external_api`
   ```python
   @pytest.mark.external_api
   def test_my_api_test(client):
       pass
   ```

4. **Requires OpenAI** → Add `@pytest.mark.openai`
   ```python
   @pytest.mark.openai
   def test_my_ai_test(client):
       pass
   ```

5. **Integration test** → Add `@pytest.mark.integration`
   ```python
   @pytest.mark.integration
   def test_my_workflow(client):
       pass
   ```

6. **Multiple markers** → Stack or use pytestmark
   ```python
   # Stack markers
   @pytest.mark.integration
   @pytest.mark.external_api
   def test_google_places_integration():
       pass
   
   # Or mark entire module
   pytestmark = [pytest.mark.integration, pytest.mark.external_api]
   ```

## Coverage

Coverage is collected only for unit tests in CI to ensure accurate metrics:

```bash
pytest tests/ -m "not integration and not external_api and not mongo and not openai" \
  --cov=app --cov-report=xml --cov-report=term
```

## Troubleshooting

### "Unknown marker" error
If you get unknown marker warnings, make sure all markers are defined in `pytest.ini`:

```ini
[pytest]
markers =
    integration: Integration tests
    external_api: Tests requiring external APIs
    mongo: Tests requiring MongoDB
    openai: Tests requiring OpenAI API
    slow: Slow tests (>5s)
```

### Tests failing in CI but passing locally
1. Check if test requires external resources
2. Add appropriate marker
3. Verify CI configuration skips that marker

### Need to run integration tests in CI
Create a separate workflow file for integration tests that:
- Runs on schedule or manual trigger
- Has proper secrets configured
- Includes MongoDB setup
- Has API keys available
