"""
Tests for system endpoints (health, info)
Professional pytest suite for FastAPI
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Test health check endpoint"""
    response = await client.get("/api/v3/health")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert data["database"] == "connected"


@pytest.mark.asyncio
async def test_api_info(client: AsyncClient):
    """Test API info endpoint"""
    response = await client.get("/api/v3/info")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["name"] == "Concierge Collector API"
    assert data["version"] == "3.0.0"
    assert "description" in data
