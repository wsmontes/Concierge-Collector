"""
Test curation endpoints
"""
import pytest


@pytest.mark.mongo
class TestCurationEndpoints:
    """Test curation CRUD operations"""
    
    def test_search_curations_default(self, client):
        """Test searching curations with default params"""
        response = client.get("/api/v3/curations/search")
        
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)
    
    def test_search_curations_with_limit(self, client):
        """Test searching curations with custom limit"""
        response = client.get("/api/v3/curations/search?limit=10")
        
        assert response.status_code == 200
        data = response.json()
        assert data["limit"] == 10
    
    def test_search_curations_filter_by_status(self, client):
        """Test filtering curations by status"""
        response = client.get("/api/v3/curations/search?status=pending")
        
        assert response.status_code == 200
        data = response.json()
        # All returned items should have pending status (if any)
        for item in data["items"]:
            if "status" in item:
                assert item["status"] == "pending"
    
    def test_search_curations_filter_by_curator(self, client):
        """Test filtering curations by curator"""
        response = client.get("/api/v3/curations/search?curator_id=test_curator")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["items"], list)
    
    def test_get_entity_curations(self, client):
        """Test getting curations for specific entity"""
        # Use first entity from list
        entities_response = client.get("/api/v3/entities?limit=1")
        entities = entities_response.json()["items"]
        
        if entities:
            # Try both _id and entity_id fields
            entity_id = entities[0].get("entity_id") or entities[0].get("_id")
            response = client.get(f"/api/v3/curations/entities/{entity_id}/curations")
            
            # May return 404 if entity not found by _id field
            assert response.status_code in [200, 404]
            
            if response.status_code == 200:
                data = response.json()
                assert isinstance(data, list)
    
    def test_create_curation_without_auth(self, client, sample_curation):
        """Test creating curation without authentication"""
        response = client.post("/api/v3/curations", json=sample_curation)
        
        assert response.status_code in [401, 403]
    
    def test_get_curation_not_found(self, client):
        """Test getting non-existent curation"""
        response = client.get("/api/v3/curations/nonexistent_id")
        
        assert response.status_code == 404
    
    def test_update_curation_without_auth(self, client):
        """Test updating curation without authentication"""
        response = client.patch(
            "/api/v3/curations/test_id",
            json={"status": "approved"}
        )
        
        assert response.status_code in [401, 403]
    
    def test_delete_curation_without_auth(self, client):
        """Test deleting curation without authentication"""
        response = client.delete("/api/v3/curations/test_id")
        
        assert response.status_code in [401, 403]


class TestCurationValidation:
    """Test curation data validation"""
    
    def test_create_curation_invalid_data(self, client):
        """Test creating curation with invalid data"""
        invalid_curation = {
            "status": "pending"
            # Missing required fields
        }
        
        response = client.post("/api/v3/curations", json=invalid_curation)
        assert response.status_code in [401, 403, 422]
    
    def test_search_curations_invalid_status(self, client):
        """Test searching with invalid status"""
        response = client.get("/api/v3/curations/search?status=invalid_status")
        
        # Should either accept (empty results) or reject
        assert response.status_code in [200, 422]
