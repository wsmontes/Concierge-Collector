"""
tests/conftest.py

Purpose: Pytest configuration and fixtures
Responsibilities:
  - Setup test database
  - Provide test client
  - Cleanup after tests
  - Provide sample data fixtures
Dependencies: pytest, httpx, motor
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
from contextlib import asynccontextmanager

from app import database
from app.core.config import settings
from app.core.security import create_access_token

# Import FastAPI and rebuild app without lifespan for testing
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import entities, curations, sync


# Create a test app without lifespan events
@asynccontextmanager
async def test_lifespan(app: FastAPI):
    """Empty lifespan for tests - database is managed by fixtures"""
    yield


def create_test_app():
    """Create FastAPI app instance for testing"""
    app = FastAPI(
        title="Concierge Collector API V4 (Test)",
        version="4.0.0",
        description="Test instance of the Concierge Collector API",
        lifespan=test_lifespan
    )

    # CORS configuration
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    app.include_router(entities.router, prefix="/api/v4", tags=["entities"])
    app.include_router(curations.router, prefix="/api/v4", tags=["curations"])
    app.include_router(sync.router, prefix="/api/v4", tags=["sync"])

    # Health check endpoint
    @app.get("/health")
    async def health_check():
        return {
            "status": "healthy",
            "version": "4.0.0",
            "database": "connected"
        }

    # Root endpoint
    @app.get("/")
    async def root():
        return {
            "name": "Concierge Collector API V4",
            "version": "4.0.0",
            "status": "running"
        }

    return app


@pytest_asyncio.fixture(scope="function")
async def test_db():
    """
    Fixture to provide a test database
    Uses a separate database name for testing
    Each test gets a fresh database
    """
    # Override database name for tests
    test_db_name = f"{settings.mongodb_db_name}_test"
    
    # Connect to test database
    client = AsyncIOMotorClient(settings.mongodb_url)
    test_database = client[test_db_name]
    
    # Override the database in the app
    database._database = test_database
    
    # Create indexes
    await database.create_indexes()
    
    yield test_database
    
    # Cleanup: drop test database
    await client.drop_database(test_db_name)
    client.close()


@pytest_asyncio.fixture(scope="function")
async def client(test_db):
    """
    Fixture to provide an async test client
    """
    app = create_test_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
def auth_token():
    """Generate a test JWT token"""
    return create_access_token(
        data={"sub": "test_curator_123", "email": "test@example.com"}
    )


@pytest.fixture
def auth_headers(auth_token):
    """Headers with authentication token"""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def sample_entity_data():
    """Sample entity data for testing"""
    return {
        "type": "restaurant",
        "name": "Test Restaurant",
        "status": "active",
        "location": {
            "address": "123 Test St",
            "city": "Test City",
            "state": "Test State",
            "country": "Test Country",
            "postal_code": "12345",
        },
        "contact": {
            "phone": "+1234567890",
            "email": "restaurant@test.com",
            "website": "https://test.com"
        },
        "tags": ["test", "restaurant"],
        "created_by": "test_curator_123",
    }


@pytest.fixture
def sample_entity_update_data():
    """Sample entity update data"""
    return {
        "name": "Updated Restaurant Name",
        "status": "active",
        "tags": ["updated", "test"],
    }


@pytest.fixture
def sample_curation_data():
    """Sample curation data for testing"""
    return {
        "entity_id": "entity_test_123",
        "curator_id": "test_curator_123",
        "category": "ambiance",
        "concept": "Beautiful restaurant with amazing decor and lighting",
        "notes": "Perfect for romantic dinners",
        "tags": ["romantic", "elegant"],
    }


@pytest.fixture
def sample_curation_update_data():
    """Sample curation update data"""
    return {
        "concept": "Updated concept with more details",
        "notes": "Updated notes",
        "tags": ["updated", "test"],
    }


@pytest.fixture
def sample_sync_pull_request():
    """Sample sync pull request"""
    return {
        "curator_id": "test_curator_123",
        "last_sync_timestamp": None,
    }


@pytest.fixture
def sample_sync_push_request(sample_entity_data, sample_curation_data):
    """Sample sync push request"""
    return {
        "curator_id": "test_curator_123",
        "entities": [sample_entity_data],
        "curations": [sample_curation_data],
        "deleted_entity_ids": [],
        "deleted_curation_ids": [],
    }


@pytest.fixture
def sample_concierge_embedding():
    """Sample Concierge embedding data"""
    return {
        "entity_id": "entity_test_123",
        "embeddings": [0.1, 0.2, 0.3, 0.4, 0.5] * 10,  # 50 dimensions
        "analysis": {
            "sentiment": "positive",
            "categories": ["fine-dining", "italian"],
            "price_range": "$$$",
        },
        "generated_at": datetime.utcnow().isoformat(),
    }
