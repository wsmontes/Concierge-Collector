"""
Test configuration and fixtures
"""
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from pymongo import MongoClient
from datetime import datetime, timezone
import os
from pathlib import Path

# Load .env file before importing app
from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

from main import app
from app.core.config import settings


@pytest.fixture(scope="session")
def test_db():
    """Get test database - uses same DB but test collections"""
    client = MongoClient(settings.mongodb_url)
    db = client[settings.mongodb_db_name]
    yield db
    client.close()


@pytest.fixture(scope="session")
def client():
    """FastAPI test client"""
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="function")
def clean_test_entities(test_db):
    """Clean test entities before and after each test"""
    # Clean before
    test_db.entities.delete_many({"_id": {"$regex": "^test_"}})
    yield
    # Clean after
    test_db.entities.delete_many({"_id": {"$regex": "^test_"}})


@pytest.fixture(scope="function")
def clean_test_curations(test_db):
    """Clean test curations before and after each test"""
    # Clean before
    test_db.curations.delete_many({"entity_id": {"$regex": "^test_"}})
    yield
    # Clean after
    test_db.curations.delete_many({"entity_id": {"$regex": "^test_"}})


@pytest.fixture
def test_google_api_key():
    """Get Google Places API key from settings for integration tests"""
    return settings.google_places_api_key if hasattr(settings, 'google_places_api_key') else None


@pytest.fixture
def test_place_id():
    """Provide a known valid place ID for testing"""
    # Using a well-known place: Google's Sydney office
    return "ChIJN1t_tDeuEmsRUsoyG83frY4"


def pytest_addoption(parser):
    """Add custom command line options"""
    parser.addoption(
        "--run-integration",
        action="store_true",
        default=False,
        help="Run integration tests that hit external APIs"
    )


@pytest.fixture
def sample_entity():
    """Sample entity data for testing"""
    return {
        "entity_id": "test_restaurant_001",
        "type": "restaurant",
        "name": "Test Restaurant",
        "data": {
            "address": "123 Test St",
            "cuisine": "Italian"
        }
    }


@pytest.fixture
def sample_curation():
    """Sample curation data for testing"""
    return {
        "entity_id": "test_restaurant_001",
        "status": "pending",
        "curator": {
            "id": "test_curator",
            "name": "Test Curator"
        },
        "data": {
            "notes": "Test notes"
        }
    }


@pytest.fixture(scope="session", autouse=True)
def enable_test_mode():
    """Enable test mode to bypass auth validation during tests"""
    import os
    os.environ["TESTING"] = "true"
    yield
    if "TESTING" in os.environ:
        del os.environ["TESTING"]


@pytest_asyncio.fixture(scope="function")
async def async_client():
    """Async test client for testing async endpoints"""
    from httpx import ASGITransport, AsyncClient
    from app.core.database import connect_to_mongo, _client
    
    # Ensure MongoDB is connected for async tests
    if _client is None:
        connect_to_mongo()
    
    # Use ASGITransport to mount the FastAPI app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test"
    ) as ac:
        yield ac


@pytest.fixture
def auth_headers():
    """Mock auth headers - in test mode, auth is bypassed"""
    # In test mode (TESTING=true), auth is bypassed automatically
    # Still return proper format for consistency
    return {"Authorization": "Bearer test_token_bypass"}


@pytest.fixture
def auth_token():
    """JWT token string for tests that expect just the token"""
    return "test_token_bypass"
