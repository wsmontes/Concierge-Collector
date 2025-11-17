"""
Pytest configuration and fixtures
Provides test client, database, and common test data
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import asyncio

from main import app
from app.core.config import settings


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for the test session"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def test_db():
    """Create test database connection"""
    # Use a test database
    test_db_name = f"{settings.mongodb_db_name}_test"
    client = AsyncIOMotorClient(settings.mongodb_url)
    db = client[test_db_name]
    
    yield db
    
    # Cleanup - drop all collections
    for collection_name in await db.list_collection_names():
        await db[collection_name].drop()
    
    client.close()


@pytest_asyncio.fixture
async def client(test_db):
    """Create test HTTP client"""
    # Override database dependency
    from app.core.database import get_database
    
    async def override_get_database():
        return test_db
    
    app.dependency_overrides[get_database] = override_get_database
    
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac
    
    app.dependency_overrides.clear()


@pytest.fixture
def sample_entity_data():
    """Sample entity data for tests"""
    return {
        "entity_id": "rest_test_001",
        "type": "restaurant",
        "name": "Test Restaurant",
        "location": {
            "city": "São Paulo",
            "country": "Brazil"
        }
    }


@pytest.fixture
def sample_curation_data():
    """Sample curation data for tests"""
    return {
        "curation_id": "cur_test_001",
        "entity_id": "rest_test_001",
        "curator": {
            "id": "curator_test",
            "name": "Test Curator"
        },
        "categories": {
            "primary": ["Fine Dining"],
            "secondary": ["French"]
        },
        "notes": {
            "public": "Excellent restaurant",
            "private": "Test notes"
        }
    }
