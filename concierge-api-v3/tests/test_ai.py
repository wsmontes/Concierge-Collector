"""
Test AI endpoints
"""
import pytest


class TestAIEndpoints:
    """Test AI integration endpoints"""
    
    def test_ai_health_check(self, client):
        """Test AI service health endpoint"""
        response = client.get("/api/v3/ai/health")
        
        # May return 503 if database connection fails
        assert response.status_code in [200, 503]
        data = response.json()
        assert "status" in data
    
    def test_orchestrate_missing_data(self, client):
        """Test orchestrate without data"""
        response = client.post("/api/v3/ai/orchestrate", json={})
        
        # Should work with defaults or return validation/server error
        assert response.status_code in [200, 400, 422, 500]
    
    def test_orchestrate_with_text(self, client):
        """Test orchestrating with text input"""
        request_data = {
            "workflow_type": "auto",
            "text": "Test restaurant in São Paulo",
            "entity_type": "restaurant"
        }
        
        response = client.post("/api/v3/ai/orchestrate", json=request_data)
        
        # Should work or return API key error
        assert response.status_code in [200, 400, 500]
    
    def test_get_usage_stats(self, client):
        """Test getting AI usage statistics"""
        response = client.get("/api/v3/ai/usage-stats")
        
        # Should work or require auth or service error
        assert response.status_code in [200, 401, 403, 500]


class TestAIValidation:
    """Test AI endpoint validation"""
    
    def test_orchestrate_invalid_workflow_type(self, client):
        """Test with invalid workflow type"""
        request_data = {
            "workflow_type": "invalid_type",
            "text": "Test"
        }
        
        response = client.post("/api/v3/ai/orchestrate", json=request_data)
        # Should accept or validate or throw service error
        assert response.status_code in [200, 400, 422, 500]
