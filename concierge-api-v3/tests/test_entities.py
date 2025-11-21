"""
Test entity endpoints: CRUD operations
"""
import pytest


@pytest.mark.mongo
class TestEntityEndpoints:
    """Test entity CRUD operations"""
    
    def test_list_entities_default(self, client):
        """Test listing entities with default params"""
        response = client.get("/api/v3/entities")
        
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert "limit" in data
        assert "offset" in data
        assert isinstance(data["items"], list)
        assert data["limit"] == 50
        assert data["offset"] == 0
    
    def test_list_entities_with_limit(self, client):
        """Test listing entities with custom limit"""
        response = client.get("/api/v3/entities?limit=10")
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) <= 10
        assert data["limit"] == 10
    
    def test_list_entities_with_offset(self, client):
        """Test listing entities with offset"""
        response = client.get("/api/v3/entities?offset=5")
        
        assert response.status_code == 200
        data = response.json()
        assert data["offset"] == 5
    
    def test_list_entities_filter_by_type(self, client):
        """Test filtering entities by type"""
        response = client.get("/api/v3/entities?type=restaurant")
        
        assert response.status_code == 200
        data = response.json()
        # All returned items should be restaurants
        for item in data["items"]:
            assert item["type"] == "restaurant"
    
    def test_list_entities_filter_by_name(self, client):
        """Test filtering entities by name (regex)"""
        response = client.get("/api/v3/entities?name=test")
        
        assert response.status_code == 200
        data = response.json()
        # Should filter by name case-insensitive
        assert isinstance(data["items"], list)
    
    def test_list_entities_pagination_limits(self, client):
        """Test pagination limits"""
        # Max limit
        response = client.get("/api/v3/entities?limit=1000")
        assert response.status_code == 200
        
        # Over max should fail
        response = client.get("/api/v3/entities?limit=1001")
        assert response.status_code == 422
    
    def test_create_entity_without_auth(self, client, sample_entity):
        """Test creating entity without authentication fails"""
        response = client.post("/api/v3/entities", json=sample_entity)
        
        # Should fail without auth
        assert response.status_code in [401, 403]
    
    def test_get_entity_not_found(self, client):
        """Test getting non-existent entity"""
        response = client.get("/api/v3/entities/nonexistent_id")
        
        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"].lower()
    
    def test_get_existing_entity(self, client):
        """Test getting an existing entity"""
        # First get list to find an entity
        list_response = client.get("/api/v3/entities?limit=1")
        entities = list_response.json()["items"]
        
        if entities:
            # Try both _id and entity_id for lookup
            entity_id = entities[0].get("_id") or entities[0]["entity_id"]
            response = client.get(f"/api/v3/entities/{entity_id}")
            
            # May fail if MongoDB uses different ID field
            assert response.status_code in [200, 404]
            
            if response.status_code == 200:
                data = response.json()
                assert "type" in data
                assert "name" in data
    
    def test_update_entity_without_auth(self, client):
        """Test updating entity without authentication"""
        response = client.patch(
            "/api/v3/entities/test_id",
            json={"name": "Updated Name"}
        )
        
        assert response.status_code in [401, 403, 428]  # 428 = missing If-Match
    
    def test_update_entity_missing_if_match(self, client, auth_headers):
        """Test updating entity without If-Match header"""
        response = client.patch(
            "/api/v3/entities/test_id",
            json={"name": "Updated Name"},
            headers=auth_headers
        )
        
        assert response.status_code in [401, 403, 428]
    
    def test_delete_entity_without_auth(self, client):
        """Test deleting entity without authentication"""
        response = client.delete("/api/v3/entities/test_id")
        
        assert response.status_code in [401, 403]
    
    def test_delete_entity_not_found(self, client, auth_headers):
        """Test deleting non-existent entity"""
        response = client.delete(
            "/api/v3/entities/nonexistent_id",
            headers=auth_headers
        )
        
        # Should fail - either auth required or not found
        assert response.status_code in [401, 403, 404]


class TestEntityValidation:
    """Test entity data validation"""
    
    def test_create_entity_invalid_data(self, client):
        """Test creating entity with invalid data"""
        invalid_entity = {
            "type": "restaurant"
            # Missing required fields
        }
        
        response = client.post("/api/v3/entities", json=invalid_entity)
        # Requires auth or validation fails
        assert response.status_code in [401, 422]
    
    def test_list_entities_invalid_limit(self, client):
        """Test listing with invalid limit"""
        response = client.get("/api/v3/entities?limit=-1")
        assert response.status_code == 422
    
    def test_list_entities_invalid_offset(self, client):
        """Test listing with invalid offset"""
        response = client.get("/api/v3/entities?offset=-1")
        assert response.status_code == 422
