"""
Tests for entity endpoints - Complete CRUD operations
Professional pytest suite with async MongoDB
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_entity(client: AsyncClient, sample_entity_data, auth_headers):
    """Test entity creation with authentication"""
    response = await client.post("/api/v3/entities", json=sample_entity_data, headers=auth_headers)
    
    assert response.status_code == 201
    data = response.json()
    
    assert data["entity_id"] == sample_entity_data["entity_id"]
    assert data["type"] == sample_entity_data["type"]
    assert data["name"] == sample_entity_data["name"]
    assert "createdAt" in data
    assert "updatedAt" in data
    assert data["version"] == 1


@pytest.mark.asyncio
async def test_create_entity_without_auth(client: AsyncClient, sample_entity_data):
    """Test entity creation fails without API key"""
    response = await client.post("/api/v3/entities", json=sample_entity_data)
    
    assert response.status_code == 403
    assert "API key" in response.json()["detail"]


@pytest.mark.asyncio
async def test_create_duplicate_entity(client: AsyncClient, sample_entity_data, auth_headers):
    """Test creating duplicate entity does upsert (merge)"""
    # Create first entity
    first_response = await client.post("/api/v3/entities", json=sample_entity_data, headers=auth_headers)
    assert first_response.status_code == 201
    first_data = first_response.json()
    assert first_data["version"] == 1
    
    # Post same entity again with additional data in 'data' field (should merge)
    updated_data = {
        **sample_entity_data,
        "data": {"notes": "Updated notes", "rating": 5}
    }
    second_response = await client.post("/api/v3/entities", json=updated_data, headers=auth_headers)
    
    # Should return 201 with merged data and incremented version
    assert second_response.status_code == 201
    second_data = second_response.json()
    assert second_data["version"] == 2
    assert second_data["data"]["notes"] == "Updated notes"
    assert second_data["name"] == sample_entity_data["name"]  # Original data preserved


@pytest.mark.asyncio
async def test_get_entity(client: AsyncClient, sample_entity_data, auth_headers):
    """Test retrieving entity by ID (no auth required for GET)"""
    # Create entity
    await client.post("/api/v3/entities", json=sample_entity_data, headers=auth_headers)
    
    # Get entity (no auth required)
    response = await client.get(f"/api/v3/entities/{sample_entity_data['entity_id']}")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["entity_id"] == sample_entity_data["entity_id"]
    assert data["name"] == sample_entity_data["name"]


@pytest.mark.asyncio
async def test_get_nonexistent_entity(client: AsyncClient):
    """Test getting non-existent entity returns 404"""
    response = await client.get("/api/v3/entities/nonexistent_id")
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_update_entity(client: AsyncClient, sample_entity_data, auth_headers):
    """Test updating entity with optimistic locking"""
    # Create entity
    create_response = await client.post("/api/v3/entities", json=sample_entity_data, headers=auth_headers)
    created = create_response.json()
    
    # Update entity
    update_data = {"name": "Updated Restaurant Name"}
    response = await client.patch(
        f"/api/v3/entities/{sample_entity_data['entity_id']}",
        json=update_data,
        headers={**auth_headers, "If-Match": f'"{created["version"]}"'}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["name"] == "Updated Restaurant Name"
    assert data["version"] == 2
    assert data["updatedAt"] > data["createdAt"]


@pytest.mark.asyncio
async def test_update_without_if_match(client: AsyncClient, sample_entity_data, auth_headers):
    """Test update without If-Match header fails"""
    # Create entity
    await client.post("/api/v3/entities", json=sample_entity_data, headers=auth_headers)
    
    # Try to update without If-Match
    update_data = {"name": "Updated Name"}
    response = await client.patch(
        f"/api/v3/entities/{sample_entity_data['entity_id']}",
        json=update_data,
        headers=auth_headers
    )
    
    assert response.status_code == 428
    assert "If-Match header is required" in response.json()["detail"]


@pytest.mark.asyncio
async def test_update_with_wrong_version(client: AsyncClient, sample_entity_data, auth_headers):
    """Test optimistic locking - wrong version"""
    # Create entity
    await client.post("/api/v3/entities", json=sample_entity_data, headers=auth_headers)
    
    # Try to update with wrong version
    update_data = {"name": "Updated Name"}
    response = await client.patch(
        f"/api/v3/entities/{sample_entity_data['entity_id']}",
        json=update_data,
        headers={**auth_headers, "If-Match": '"999"'}
    )
    
    assert response.status_code == 409
    assert "conflict" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_entity(client: AsyncClient, sample_entity_data, auth_headers):
    """Test deleting entity"""
    # Create entity
    await client.post("/api/v3/entities", json=sample_entity_data, headers=auth_headers)
    
    # Delete entity
    response = await client.delete(f"/api/v3/entities/{sample_entity_data['entity_id']}", headers=auth_headers)
    
    assert response.status_code == 204
    
    # Verify entity is deleted
    get_response = await client.get(f"/api/v3/entities/{sample_entity_data['entity_id']}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_entity(client: AsyncClient, auth_headers):
    """Test deleting non-existent entity returns 404"""
    response = await client.delete("/api/v3/entities/nonexistent_id", headers=auth_headers)
    
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_entities_empty(client: AsyncClient):
    """Test listing entities when database is empty"""
    response = await client.get("/api/v3/entities")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["items"] == []
    assert data["total"] == 0
    assert data["limit"] == 50
    assert data["offset"] == 0


@pytest.mark.asyncio
async def test_list_entities(client: AsyncClient, auth_headers):
    """Test listing entities with pagination"""
    # Create multiple entities
    for i in range(5):
        entity_data = {
            "entity_id": f"rest_test_{i:03d}",
            "type": "restaurant",
            "name": f"Test Restaurant {i}"
        }
        await client.post("/api/v3/entities", json=entity_data, headers=auth_headers)
    
    # List entities (no auth required for GET)
    response = await client.get("/api/v3/entities?limit=3&offset=0")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 3
    assert data["total"] == 5
    assert data["limit"] == 3
    assert data["offset"] == 0


@pytest.mark.asyncio
async def test_list_entities_with_type_filter(client: AsyncClient, auth_headers):
    """Test filtering entities by type"""
    # Create entities of different types
    await client.post("/api/v3/entities", json={
        "entity_id": "rest_001",
        "type": "restaurant",
        "name": "Restaurant 1"
    }, headers=auth_headers)
    await client.post("/api/v3/entities", json={
        "entity_id": "hotel_001",
        "type": "hotel",
        "name": "Hotel 1"
    }, headers=auth_headers)
    
    # Filter by type (no auth required for GET)
    response = await client.get("/api/v3/entities?type=restaurant")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 1
    assert data["items"][0]["type"] == "restaurant"


@pytest.mark.asyncio
async def test_list_entities_with_name_filter(client: AsyncClient, auth_headers):
    """Test filtering entities by name (regex)"""
    # Create entities
    await client.post("/api/v3/entities", json={
        "entity_id": "rest_001",
        "type": "restaurant",
        "name": "French Bistro"
    }, headers=auth_headers)
    await client.post("/api/v3/entities", json={
        "entity_id": "rest_002",
        "type": "restaurant",
        "name": "Italian Trattoria"
    }, headers=auth_headers)
    
    # Filter by name (no auth required for GET)
    response = await client.get("/api/v3/entities?name=french")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 1
    assert "french" in data["items"][0]["name"].lower()
