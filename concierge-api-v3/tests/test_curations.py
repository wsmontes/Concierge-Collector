"""
Tests for curation endpoints - Complete CRUD operations
Professional pytest suite with async MongoDB
"""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_curation(client: AsyncClient, sample_entity_data, sample_curation_data):
    """Test curation creation"""
    # Create entity first
    await client.post("/entities", json=sample_entity_data)
    
    # Create curation
    response = await client.post("/curations", json=sample_curation_data)
    
    assert response.status_code == 201
    data = response.json()
    
    assert data["curation_id"] == sample_curation_data["curation_id"]
    assert data["entity_id"] == sample_curation_data["entity_id"]
    assert data["curator"]["id"] == sample_curation_data["curator"]["id"]
    assert "createdAt" in data
    assert "updatedAt" in data
    assert data["version"] == 1


@pytest.mark.asyncio
async def test_create_curation_without_entity(client: AsyncClient, sample_curation_data):
    """Test creating curation without entity fails"""
    response = await client.post("/curations", json=sample_curation_data)
    
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_get_curation(client: AsyncClient, sample_entity_data, sample_curation_data):
    """Test retrieving curation by ID"""
    # Create entity and curation
    await client.post("/entities", json=sample_entity_data)
    await client.post("/curations", json=sample_curation_data)
    
    # Get curation
    response = await client.get(f"/curations/{sample_curation_data['curation_id']}")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["curation_id"] == sample_curation_data["curation_id"]
    assert data["entity_id"] == sample_curation_data["entity_id"]


@pytest.mark.asyncio
async def test_get_nonexistent_curation(client: AsyncClient):
    """Test getting non-existent curation returns 404"""
    response = await client.get("/curations/nonexistent_id")
    
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_update_curation(client: AsyncClient, sample_entity_data, sample_curation_data):
    """Test updating curation with optimistic locking"""
    # Create entity and curation
    await client.post("/entities", json=sample_entity_data)
    create_response = await client.post("/curations", json=sample_curation_data)
    created = create_response.json()
    
    # Update curation
    update_data = {
        "notes": {
            "public": "Updated public notes",
            "private": "Updated private notes"
        }
    }
    response = await client.patch(
        f"/curations/{sample_curation_data['curation_id']}",
        json=update_data,
        headers={"If-Match": f'"{created["version"]}"'}
    )
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["notes"]["public"] == "Updated public notes"
    assert data["version"] == 2


@pytest.mark.asyncio
async def test_update_curation_without_if_match(client: AsyncClient, sample_entity_data, sample_curation_data):
    """Test update without If-Match header fails"""
    # Create entity and curation
    await client.post("/entities", json=sample_entity_data)
    await client.post("/curations", json=sample_curation_data)
    
    # Try to update without If-Match
    update_data = {"notes": {"public": "Updated"}}
    response = await client.patch(
        f"/curations/{sample_curation_data['curation_id']}",
        json=update_data
    )
    
    assert response.status_code == 428


@pytest.mark.asyncio
async def test_delete_curation(client: AsyncClient, sample_entity_data, sample_curation_data):
    """Test deleting curation"""
    # Create entity and curation
    await client.post("/entities", json=sample_entity_data)
    await client.post("/curations", json=sample_curation_data)
    
    # Delete curation
    response = await client.delete(f"/curations/{sample_curation_data['curation_id']}")
    
    assert response.status_code == 204
    
    # Verify curation is deleted
    get_response = await client.get(f"/curations/{sample_curation_data['curation_id']}")
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_search_curations_empty(client: AsyncClient):
    """Test searching curations when database is empty"""
    response = await client.get("/curations/search")
    
    assert response.status_code == 200
    data = response.json()
    
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.asyncio
async def test_search_curations_by_entity(client: AsyncClient, sample_entity_data):
    """Test searching curations by entity_id"""
    # Create entity
    await client.post("/entities", json=sample_entity_data)
    
    # Create multiple curations
    for i in range(3):
        curation_data = {
            "curation_id": f"cur_test_{i:03d}",
            "entity_id": sample_entity_data["entity_id"],
            "curator": {
                "id": f"curator_{i}",
                "name": f"Curator {i}"
            }
        }
        await client.post("/curations", json=curation_data)
    
    # Search by entity_id
    response = await client.get(f"/curations/search?entity_id={sample_entity_data['entity_id']}")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 3
    assert data["total"] == 3


@pytest.mark.asyncio
async def test_search_curations_by_curator(client: AsyncClient, sample_entity_data):
    """Test searching curations by curator_id"""
    # Create entity
    await client.post("/entities", json=sample_entity_data)
    
    # Create curations with different curators
    curator_id = "curator_test"
    for i in range(2):
        curation_data = {
            "curation_id": f"cur_test_{i:03d}",
            "entity_id": sample_entity_data["entity_id"],
            "curator": {
                "id": curator_id if i == 0 else "other_curator",
                "name": f"Curator {i}"
            }
        }
        await client.post("/curations", json=curation_data)
    
    # Search by curator_id
    response = await client.get(f"/curations/search?curator_id={curator_id}")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data["items"]) == 1
    assert data["items"][0]["curator"]["id"] == curator_id


@pytest.mark.asyncio
async def test_get_entity_curations(client: AsyncClient, sample_entity_data):
    """Test getting all curations for an entity"""
    # Create entity
    await client.post("/entities", json=sample_entity_data)
    
    # Create multiple curations
    for i in range(3):
        curation_data = {
            "curation_id": f"cur_test_{i:03d}",
            "entity_id": sample_entity_data["entity_id"],
            "curator": {
                "id": f"curator_{i}",
                "name": f"Curator {i}"
            }
        }
        await client.post("/curations", json=curation_data)
    
    # Get entity curations
    response = await client.get(f"/curations/entities/{sample_entity_data['entity_id']}/curations")
    
    assert response.status_code == 200
    data = response.json()
    
    assert len(data) == 3
    assert all(c["entity_id"] == sample_entity_data["entity_id"] for c in data)


@pytest.mark.asyncio
async def test_get_entity_curations_nonexistent_entity(client: AsyncClient):
    """Test getting curations for non-existent entity returns 404"""
    response = await client.get("/curations/entities/nonexistent_id/curations")
    
    assert response.status_code == 404
