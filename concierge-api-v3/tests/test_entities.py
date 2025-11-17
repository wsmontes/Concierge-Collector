"""
Tests for entity endpoints - Complete CRUD operations
Professional pytest suite with async MongoDB
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_entity(client: AsyncClient, sample_entity_data):
    """Test entity creation"""
    response = await client.post("/entities", json=sample_entity_data)
    
    assert response.status_code == 201
    data = response.json()
    
    assert data["entity_id"] == sample_entity_data["entity_id"]
    assert data["type"] == sample_entity_data["type"]
    assert data["name"] == sample_entity_data["name"]
    assert "createdAt" in data
    assert "updatedAt" in data
    assert data["version"] == 1


@pytest.mark.asyncio
async def test_create_duplicate_entity(client: AsyncClient, sample_entity_data):
    """Test creating duplicate entity fails"""
    # Create first entity
    await client.post("/entities", json=sample_entity_data)
    
    # Try to create duplicate
    response = await client.post("/entities", json=sample_entity_data)
    
    assert response.status_code == 500  # MongoDB duplicate key error


@pytest.mark.asyncio
async def test_get_entity(client: AsyncClient, sample_entity_data):
    """Test retrieving entity by ID"""
    # Create entity
    await client.post("/entities", json=sample_entity_data)
    
    # Get entity
    response = await client.get(f"/entities/{sample_entity_data['entity_id']}")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["entity_id"] == sample_entity_data["entity_id"]
    assert data["name"] == sample_entity_data["name"]


@pytest.mark.asyncio
async def test_get_nonexistent_entity(client: AsyncClient):
    """Test getting non-existent entity returns 404"""
    response = await client.get("/entities/nonexistent_id")
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_update_entity(client: AsyncClient, sample_entity_data):
    """Test updating entity with optimistic locking"""
    # Create entity
    create_response = await client.post("/entities", json=sample_entity_data)
    created = create_response.json()
    
    # Update entity
    update_data = {"name": "Updated Restaurant Name"}
    response = await client.patch(
        f"/entities/{sample_entity_data['entity_id']}",
        json=update_data,
        headers={"If-Match": f'"{created["version"]}"'}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["name"] == "Updated Restaurant Name"
    assert data["version"] == 2
    assert data["updatedAt"] > data["createdAt"]


@pytest.mark.asyncio
async def test_update_without_if_match(client: AsyncClient, sample_entity_data):
    """Test update without If-Match header fails"""
    # Create entity
    await client.post("/entities", json=sample_entity_data)
    
    # Try to update without If-Match
    update_data = {"name": "Updated Name"}
    response = await client.patch(
        f"/entities/{sample_entity_data['entity_id']}",
        json=update_data
    )
    
    assert response.status_code == 428
    assert "If-Match header is required" in response.json()["detail"]


@pytest.mark.asyncio
async def test_update_with_wrong_version(client: AsyncClient, sample_entity_data):
    """Test optimistic locking - wrong version"""
    # Create entity
    await client.post("/entities", json=sample_entity_data)
    
    # Try to update with wrong version
    update_data = {"name": "Updated Name"}
    response = await client.patch(
        f"/entities/{sample_entity_data['entity_id']}",
        json=update_data,
        headers={"If-Match": '"999"'}
    )
    
    assert response.status_code == 409
    assert "conflict" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_entity(client: AsyncClient, sample_entity_data):
    """Test deleting entity"""
    # Create entity
    await client.post("/entities", json=sample_entity_data)
    
    # Delete entity
    response = await client.delete(f"/entities/{sample_entity_data['entity_id']}")
    
    assert response.status_code == 204
    
    # Verify entity is deleted
    get_response = await client.get(f"/entities/{sample_entity_data['entity_id']}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_delete_nonexistent_entity(client: AsyncClient):
    """Test deleting non-existent entity returns 404"""
    response = await client.delete("/entities/nonexistent_id")
    
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_list_entities_empty(client: AsyncClient):
    """Test listing entities when database is empty"""
    response = await client.get("/entities")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["items"] == []
    assert data["total"] == 0
    assert data["limit"] == 50
    assert data["offset"] == 0


@pytest.mark.asyncio
async def test_list_entities(client: AsyncClient):
    """Test listing entities with pagination"""
    # Create multiple entities
    for i in range(5):
        entity_data = {
            "entity_id": f"rest_test_{i:03d}",
            "type": "restaurant",
            "name": f"Test Restaurant {i}"
        }
        await client.post("/entities", json=entity_data)
    
    # List entities
    response = await client.get("/entities?limit=3&offset=0")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 3
    assert data["total"] == 5
    assert data["limit"] == 3
    assert data["offset"] == 0


@pytest.mark.asyncio
async def test_list_entities_with_type_filter(client: AsyncClient):
    """Test filtering entities by type"""
    # Create entities of different types
    await client.post("/entities", json={
        "entity_id": "rest_001",
        "type": "restaurant",
        "name": "Restaurant 1"
    })
    await client.post("/entities", json={
        "entity_id": "hotel_001",
        "type": "hotel",
        "name": "Hotel 1"
    })
    
    # Filter by type
    response = await client.get("/entities?type=restaurant")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 1
    assert data["items"][0]["type"] == "restaurant"


@pytest.mark.asyncio
async def test_list_entities_with_name_filter(client: AsyncClient):
    """Test filtering entities by name (regex)"""
    # Create entities
    await client.post("/entities", json={
        "entity_id": "rest_001",
        "type": "restaurant",
        "name": "French Bistro"
    })
    await client.post("/entities", json={
        "entity_id": "rest_002",
        "type": "restaurant",
        "name": "Italian Trattoria"
    })
    
    # Filter by name
    response = await client.get("/entities?name=french")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 1
    assert "french" in data["items"][0]["name"].lower()
