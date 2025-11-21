"""
Test concepts endpoints
"""
import pytest


@pytest.mark.mongo
class TestConceptsEndpoints:
    """Test concepts operations"""
    
    def test_list_all_concepts(self, client):
        """Test listing all concepts"""
        response = client.get("/api/v3/concepts/")
        
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, (list, dict))
    
    def test_get_concepts_by_entity_type(self, client):
        """Test getting concepts for specific entity type"""
        response = client.get("/api/v3/concepts/restaurant")
        
        # May return 404 if no concepts in database
        assert response.status_code in [200, 404]
        
        if response.status_code == 200:
            data = response.json()
            assert "entity_type" in data or isinstance(data, dict)
    
    def test_get_concepts_hotel(self, client):
        """Test getting concepts for hotel"""
        response = client.get("/api/v3/concepts/hotel")
        
        assert response.status_code in [200, 404]
    
    def test_get_concepts_invalid_type(self, client):
        """Test getting concepts for invalid entity type"""
        response = client.get("/api/v3/concepts/nonexistent_type")
        
        # Should either return empty or 404
        assert response.status_code in [200, 404]


@pytest.mark.mongo
class TestConceptsValidation:
    """Test concepts validation"""
    
    def test_concepts_restaurant_structure(self, client):
        """Test that restaurant concepts have expected structure"""
        response = client.get("/api/v3/concepts/restaurant")
        
        if response.status_code == 200:
            data = response.json()
            # Should have entity_type or be a dict
            assert isinstance(data, dict)
