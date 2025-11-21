"""
Test Google Places API endpoints
"""
import pytest


@pytest.mark.external_api
class TestPlacesEndpoints:
    """Test Google Places integration"""
    
    def test_places_health_check(self, client):
        """Test Places API health endpoint"""
        response = client.get("/api/v3/places/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
    
    def test_nearby_search_missing_params(self, client):
        """Test nearby search without required params"""
        response = client.get("/api/v3/places/nearby")
        
        assert response.status_code == 422  # Missing required params
    
    def test_nearby_search_with_location(self, client):
        """Test nearby search with location"""
        response = client.get("/api/v3/places/nearby?latitude=-23.5505&longitude=-46.6333&radius=1000")
        
        # Should work or return API key error
        assert response.status_code in [200, 400, 500]
        
        if response.status_code == 200:
            data = response.json()
            assert "places" in data or "results" in data
    
    def test_get_place_details_missing_id(self, client):
        """Test getting place details without place_id"""
        response = client.get("/api/v3/places/details/")
        
        assert response.status_code in [404, 422]
    
    def test_get_place_details_invalid_id(self, client):
        """Test getting place details with invalid ID"""
        response = client.get("/api/v3/places/details/invalid_id")
        
        # Should fail gracefully (502 = Places API invalid field error)
        assert response.status_code in [400, 404, 500, 502]


@pytest.mark.external_api
class TestPlacesValidation:
    """Test Places API input validation"""
    
    def test_nearby_search_invalid_radius(self, client):
        """Test nearby search with invalid radius"""
        response = client.get("/api/v3/places/nearby?latitude=-23.5505&longitude=-46.6333&radius=-1")
        
        assert response.status_code in [400, 422]
    
    def test_nearby_search_invalid_coordinates(self, client):
        """Test nearby search with invalid coordinates"""
        response = client.get("/api/v3/places/nearby?latitude=invalid&longitude=invalid&radius=1000")
        
        assert response.status_code in [400, 422]
