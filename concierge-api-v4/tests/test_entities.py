"""
tests/test_entities.py

Purpose: Test entity endpoints
Responsibilities:
  - Test entity CRUD operations
  - Test entity validation
  - Test error cases
  - Test filtering and pagination
  - Test optimistic locking
Dependencies: pytest, httpx
"""

import pytest


@pytest.mark.asyncio
class TestEntitiesBasic:
    """Test basic entity operations"""

    async def test_health_check(self, client):
        """Test health check endpoint"""
        response = await client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    async def test_root_endpoint(self, client):
        """Test root endpoint"""
        response = await client.get("/")
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Concierge Collector API V4"
        assert "version" in data


@pytest.mark.asyncio
class TestEntitiesCRUD:
    """Test entity CRUD operations"""

    async def test_create_entity_success(self, client, sample_entity_data, auth_headers):
        """Test creating a new entity successfully"""
        response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == sample_entity_data["name"]
        assert data["type"] == sample_entity_data["type"]
        assert data["status"] == sample_entity_data["status"]
        assert "entity_id" in data
        assert "version" in data
        assert data["version"] == 1
        assert "created_at" in data
        assert "updated_at" in data

    async def test_create_entity_missing_required_fields(self, client, auth_headers):
        """Test creating entity with missing required fields"""
        invalid_data = {
            "type": "restaurant"
            # Missing name and status
        }
        response = await client.post(
            "/api/v4/entities/", 
            json=invalid_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_create_entity_invalid_type(self, client, sample_entity_data, auth_headers):
        """Test creating entity with invalid type"""
        invalid_data = {**sample_entity_data, "type": "invalid_type"}
        response = await client.post(
            "/api/v4/entities/", 
            json=invalid_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_get_entity_success(self, client, sample_entity_data, auth_headers):
        """Test getting an existing entity"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        created_entity = create_response.json()
        
        # Get the entity
        response = await client.get(f"/api/v4/entities/{created_entity['entity_id']}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["entity_id"] == created_entity["entity_id"]
        assert data["name"] == sample_entity_data["name"]

    async def test_get_nonexistent_entity(self, client):
        """Test getting a nonexistent entity"""
        response = await client.get("/api/v4/entities/nonexistent_id_12345")
        
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data

    async def test_update_entity_success(self, client, sample_entity_data, sample_entity_update_data, auth_headers):
        """Test updating an entity successfully"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        created_entity = create_response.json()
        
        # Update the entity
        update_data = {**sample_entity_update_data, "version": created_entity["version"]}
        response = await client.put(
            f"/api/v4/entities/{created_entity['entity_id']}", 
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == sample_entity_update_data["name"]
        assert data["version"] == created_entity["version"] + 1
        assert data["entity_id"] == created_entity["entity_id"]

    async def test_update_entity_optimistic_locking(self, client, sample_entity_data, sample_entity_update_data, auth_headers):
        """Test optimistic locking with version mismatch"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        created_entity = create_response.json()
        
        # Try to update with wrong version
        update_data = {**sample_entity_update_data, "version": 999}
        response = await client.put(
            f"/api/v4/entities/{created_entity['entity_id']}", 
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 409
        data = response.json()
        assert "version" in data["detail"].lower()

    async def test_update_nonexistent_entity(self, client, sample_entity_update_data, auth_headers):
        """Test updating a nonexistent entity"""
        update_data = {**sample_entity_update_data, "version": 1}
        response = await client.put(
            "/api/v4/entities/nonexistent_id_12345", 
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 404

    async def test_delete_entity_soft(self, client, sample_entity_data, auth_headers):
        """Test soft deleting an entity"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        created_entity = create_response.json()
        
        # Soft delete the entity
        response = await client.delete(
            f"/api/v4/entities/{created_entity['entity_id']}?hard_delete=false",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Entity deleted successfully"
        
        # Verify entity is soft deleted (status should be deleted)
        get_response = await client.get(f"/api/v4/entities/{created_entity['entity_id']}")
        assert get_response.status_code == 200
        entity = get_response.json()
        assert entity["status"] == "deleted"

    async def test_delete_entity_hard(self, client, sample_entity_data, auth_headers):
        """Test hard deleting an entity"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        created_entity = create_response.json()
        
        # Hard delete the entity
        response = await client.delete(
            f"/api/v4/entities/{created_entity['entity_id']}?hard_delete=true",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        
        # Verify entity is completely removed
        get_response = await client.get(f"/api/v4/entities/{created_entity['entity_id']}")
        assert get_response.status_code == 404

    async def test_delete_nonexistent_entity(self, client, auth_headers):
        """Test deleting a nonexistent entity"""
        response = await client.delete(
            "/api/v4/entities/nonexistent_id_12345",
            headers=auth_headers
        )
        
        assert response.status_code == 404


@pytest.mark.asyncio
class TestEntitiesList:
    """Test entity listing and filtering"""

    async def test_list_entities_empty(self, client):
        """Test listing entities when database is empty"""
        response = await client.get("/api/v4/entities/")
        
        assert response.status_code == 200
        data = response.json()
        assert "entities" in data
        assert "total" in data
        assert data["total"] == 0
        assert len(data["entities"]) == 0

    async def test_list_entities_with_data(self, client, sample_entity_data, auth_headers):
        """Test listing entities with data"""
        # Create multiple entities
        for i in range(3):
            entity_data = {**sample_entity_data, "name": f"Test Restaurant {i}"}
            await client.post("/api/v4/entities/", json=entity_data, headers=auth_headers)
        
        # List entities
        response = await client.get("/api/v4/entities/")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 3
        assert len(data["entities"]) >= 3

    async def test_list_entities_filter_by_type(self, client, sample_entity_data, auth_headers):
        """Test listing entities filtered by type"""
        # Create entities
        await client.post("/api/v4/entities/", json=sample_entity_data, headers=auth_headers)
        
        # List with type filter
        response = await client.get("/api/v4/entities/?type=restaurant")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        for entity in data["entities"]:
            assert entity["type"] == "restaurant"

    async def test_list_entities_filter_by_status(self, client, sample_entity_data, auth_headers):
        """Test listing entities filtered by status"""
        # Create entities
        await client.post("/api/v4/entities/", json=sample_entity_data, headers=auth_headers)
        
        # List with status filter
        response = await client.get("/api/v4/entities/?status=active")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        for entity in data["entities"]:
            assert entity["status"] == "active"

    async def test_list_entities_filter_by_city(self, client, sample_entity_data, auth_headers):
        """Test listing entities filtered by city"""
        # Create entities
        await client.post("/api/v4/entities/", json=sample_entity_data, headers=auth_headers)
        
        # List with city filter
        response = await client.get(f"/api/v4/entities/?city={sample_entity_data['location']['city']}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1

    async def test_list_entities_pagination(self, client, sample_entity_data, auth_headers):
        """Test entity pagination"""
        # Create multiple entities
        for i in range(5):
            entity_data = {**sample_entity_data, "name": f"Test Restaurant {i}"}
            await client.post("/api/v4/entities/", json=entity_data, headers=auth_headers)
        
        # Get first page
        response = await client.get("/api/v4/entities/?skip=0&limit=2")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["entities"]) == 2
        assert data["total"] >= 5
        
        # Get second page
        response2 = await client.get("/api/v4/entities/?skip=2&limit=2")
        data2 = response2.json()
        assert len(data2["entities"]) == 2
        
        # Verify different entities
        assert data["entities"][0]["entity_id"] != data2["entities"][0]["entity_id"]
