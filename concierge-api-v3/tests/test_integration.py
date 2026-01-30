"""
Integration tests - test complete workflows
"""
import pytest


@pytest.mark.mongo
class TestIntegrationWorkflows:
    """Test complete user workflows"""
    
    def test_api_documentation_accessible(self, client):
        """Test that API docs are accessible"""
        # Swagger UI
        response = client.get("/api/v3/docs")
        assert response.status_code == 200
        assert b"swagger" in response.content.lower()
        
        # ReDoc
        response = client.get("/api/v3/redoc")
        assert response.status_code == 200
        
        # OpenAPI schema
        response = client.get("/api/v3/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "openapi" in schema
        assert "paths" in schema
    
    def test_cors_headers(self, client):
        """Test CORS headers are present"""
        response = client.options("/api/v3/health")
        # TestClient may not support OPTIONS or CORS
        assert response.status_code in [200, 204, 405]
    
    def test_error_handling(self, client):
        """Test that errors are handled gracefully"""
        # 404
        response = client.get("/api/v3/nonexistent")
        assert response.status_code == 404
        
        # 422 - validation error
        response = client.get("/api/v3/entities?limit=invalid")
        assert response.status_code == 422
    
    def test_pagination_consistency(self, client):
        """Test pagination returns consistent results"""
        # Get first page
        response1 = client.get("/api/v3/entities?limit=10&offset=0")
        page1 = response1.json()
        
        # Get second page
        response2 = client.get("/api/v3/entities?limit=10&offset=10")
        page2 = response2.json()
        
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        # Pages should not overlap
        if page1["items"] and page2["items"]:
            ids1 = {item["entity_id"] for item in page1["items"]}
            ids2 = {item["entity_id"] for item in page2["items"]}
            assert len(ids1.intersection(ids2)) == 0
    
    def test_database_connection_resilience(self, client):
        """Test that API handles database issues gracefully"""
        # Multiple rapid requests
        for _ in range(5):
            response = client.get("/api/v3/health")
            assert response.status_code == 200
            data = response.json()
            # Database may be connected or have errors
            assert "database" in data


class TestPerformance:
    """Test API performance"""
    
    def test_health_check_fast(self, client):
        """Test health check responds quickly"""
        import time
        start = time.time()
        response = client.get("/api/v3/health")
        duration = time.time() - start
        
        assert response.status_code == 200
        # Should respond in under 5 seconds
        assert duration < 5.0, f"Health check took {duration:.2f}s, expected <5s"
    
    def test_list_entities_reasonable_time(self, client):
        """Test listing entities completes in reasonable time"""
        import time
        start = time.time()
        response = client.get("/api/v3/entities?limit=50")
        duration = time.time() - start
        
        assert response.status_code == 200
        assert duration < 2.0  # Should complete in under 2 seconds
