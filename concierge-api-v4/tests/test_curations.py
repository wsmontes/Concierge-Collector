"""
tests/test_curations.py

Purpose: Test curation endpoints
Responsibilities:
  - Test curation CRUD operations
  - Test curation validation
  - Test entity_id validation
  - Test error cases
Dependencies: pytest, httpx
"""

import pytest


@pytest.mark.asyncio
class TestCurationsCRUD:
    """Test curation CRUD operations"""

    async def test_create_curation_success(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test creating a new curation successfully"""
        # First create an entity
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Create curation for this entity
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        response = await client.post(
            "/api/v4/curations/", 
            json=curation_data,
            headers=auth_headers
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["entity_id"] == entity["entity_id"]
        assert data["concept"] == sample_curation_data["concept"]
        assert data["category"] == sample_curation_data["category"]
        assert "curation_id" in data
        assert "version" in data
        assert data["version"] == 1

    async def test_create_curation_nonexistent_entity(self, client, sample_curation_data, auth_headers):
        """Test creating curation for nonexistent entity"""
        curation_data = {**sample_curation_data, "entity_id": "nonexistent_entity_123"}
        response = await client.post(
            "/api/v4/curations/", 
            json=curation_data,
            headers=auth_headers
        )
        
        assert response.status_code == 404
        data = response.json()
        assert "entity" in data["detail"].lower()

    async def test_create_curation_missing_required_fields(self, client, auth_headers):
        """Test creating curation with missing required fields"""
        invalid_data = {
            "entity_id": "some_entity_id"
            # Missing curator_id, category, concept
        }
        response = await client.post(
            "/api/v4/curations/", 
            json=invalid_data,
            headers=auth_headers
        )
        
        assert response.status_code == 422

    async def test_get_curation_success(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test getting an existing curation"""
        # Create entity and curation
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        curation_response = await client.post(
            "/api/v4/curations/", 
            json=curation_data,
            headers=auth_headers
        )
        curation = curation_response.json()
        
        # Get the curation
        response = await client.get(f"/api/v4/curations/{curation['curation_id']}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["curation_id"] == curation["curation_id"]
        assert data["concept"] == sample_curation_data["concept"]

    async def test_get_nonexistent_curation(self, client):
        """Test getting a nonexistent curation"""
        response = await client.get("/api/v4/curations/nonexistent_curation_123")
        
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data

    async def test_update_curation_success(self, client, sample_entity_data, sample_curation_data, sample_curation_update_data, auth_headers):
        """Test updating a curation successfully"""
        # Create entity and curation
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        curation_response = await client.post(
            "/api/v4/curations/", 
            json=curation_data,
            headers=auth_headers
        )
        curation = curation_response.json()
        
        # Update the curation
        update_data = {**sample_curation_update_data, "version": curation["version"]}
        response = await client.put(
            f"/api/v4/curations/{curation['curation_id']}", 
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["concept"] == sample_curation_update_data["concept"]
        assert data["version"] == curation["version"] + 1

    async def test_update_curation_optimistic_locking(self, client, sample_entity_data, sample_curation_data, sample_curation_update_data, auth_headers):
        """Test optimistic locking with version mismatch"""
        # Create entity and curation
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        curation_response = await client.post(
            "/api/v4/curations/", 
            json=curation_data,
            headers=auth_headers
        )
        curation = curation_response.json()
        
        # Try to update with wrong version
        update_data = {**sample_curation_update_data, "version": 999}
        response = await client.put(
            f"/api/v4/curations/{curation['curation_id']}", 
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 409
        data = response.json()
        assert "version" in data["detail"].lower()

    async def test_delete_curation_soft(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test soft deleting a curation"""
        # Create entity and curation
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        curation_response = await client.post(
            "/api/v4/curations/", 
            json=curation_data,
            headers=auth_headers
        )
        curation = curation_response.json()
        
        # Soft delete the curation
        response = await client.delete(
            f"/api/v4/curations/{curation['curation_id']}?hard_delete=false",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        
        # Verify curation is soft deleted
        get_response = await client.get(f"/api/v4/curations/{curation['curation_id']}")
        assert get_response.status_code == 200
        data = get_response.json()
        assert data.get("is_deleted") is True

    async def test_delete_curation_hard(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test hard deleting a curation"""
        # Create entity and curation
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        curation_response = await client.post(
            "/api/v4/curations/", 
            json=curation_data,
            headers=auth_headers
        )
        curation = curation_response.json()
        
        # Hard delete the curation
        response = await client.delete(
            f"/api/v4/curations/{curation['curation_id']}?hard_delete=true",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        
        # Verify curation is completely removed
        get_response = await client.get(f"/api/v4/curations/{curation['curation_id']}")
        assert get_response.status_code == 404


@pytest.mark.asyncio
class TestCurationsList:
    """Test curation listing and filtering"""

    async def test_list_curations_empty(self, client):
        """Test listing curations when database is empty"""
        response = await client.get("/api/v4/curations/")
        
        assert response.status_code == 200
        data = response.json()
        assert "curations" in data
        assert "total" in data
        assert data["total"] == 0

    async def test_list_curations_with_data(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test listing curations with data"""
        # Create entity
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Create multiple curations
        for i in range(3):
            curation_data = {
                **sample_curation_data, 
                "entity_id": entity["entity_id"],
                "concept": f"Test concept {i}"
            }
            await client.post("/api/v4/curations/", json=curation_data, headers=auth_headers)
        
        # List curations
        response = await client.get("/api/v4/curations/")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 3
        assert len(data["curations"]) >= 3

    async def test_list_curations_filter_by_entity(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test listing curations filtered by entity_id"""
        # Create entity
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Create curations
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        await client.post("/api/v4/curations/", json=curation_data, headers=auth_headers)
        
        # List with entity_id filter
        response = await client.get(f"/api/v4/curations/?entity_id={entity['entity_id']}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        for curation in data["curations"]:
            assert curation["entity_id"] == entity["entity_id"]

    async def test_list_curations_filter_by_category(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test listing curations filtered by category"""
        # Create entity
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Create curations
        curation_data = {**sample_curation_data, "entity_id": entity["entity_id"]}
        await client.post("/api/v4/curations/", json=curation_data, headers=auth_headers)
        
        # List with category filter
        response = await client.get(f"/api/v4/curations/?category={sample_curation_data['category']}")
        
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 1
        for curation in data["curations"]:
            assert curation["category"] == sample_curation_data["category"]

    async def test_list_curations_pagination(self, client, sample_entity_data, sample_curation_data, auth_headers):
        """Test curation pagination"""
        # Create entity
        entity_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = entity_response.json()
        
        # Create multiple curations
        for i in range(5):
            curation_data = {
                **sample_curation_data, 
                "entity_id": entity["entity_id"],
                "concept": f"Test concept {i}"
            }
            await client.post("/api/v4/curations/", json=curation_data, headers=auth_headers)
        
        # Get first page
        response = await client.get("/api/v4/curations/?skip=0&limit=2")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["curations"]) == 2
        assert data["total"] >= 5
        
        # Get second page
        response2 = await client.get("/api/v4/curations/?skip=2&limit=2")
        data2 = response2.json()
        assert len(data2["curations"]) == 2
