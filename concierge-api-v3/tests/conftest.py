"""
Test configuration and fixtures
"""
import pytest
from fastapi.testclient import TestClient
from pymongo import MongoClient
from datetime import datetime, timezone

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


@pytest.fixture
def auth_headers():
    """Mock auth headers - in real tests you'd get a valid JWT"""
    # For now, return empty dict since we need proper OAuth
    # In production, generate a real JWT token here
    return {}
