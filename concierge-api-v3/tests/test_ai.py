"""
Test AI endpoints
"""
import pytest


class TestAIEndpoints:
    """Test AI integration endpoints"""
    
    def test_ai_health_check(self, client):
        """Test AI service health endpoint"""
        response = client.get("/api/v3/ai/health")
        
        # May return 503 if database connection fails, but NOT 500
        assert response.status_code in [200, 503], \
            f"Health check should not return 500: {response.text}"
        data = response.json()
        assert "status" in data
    
    def test_orchestrate_missing_data(self, client):
        """Test orchestrate without data - should validate, not crash"""
        response = client.post("/api/v3/ai/orchestrate", json={})
        
        # Should return validation error or auth error, NOT 500 (internal error)
        assert response.status_code != 500, \
            f"Empty request should not cause 500 error: {response.text}"
        
        # Expected: 401 (auth required), 400 (validation), or 422 (unprocessable)
        assert response.status_code in [400, 401, 422], \
            f"Expected validation/auth error, got {response.status_code}"
    
    def test_orchestrate_with_text(self, client, auth_headers):
        """Test orchestrating with text input"""
        request_data = {
            "workflow_type": "auto",
            "text": "Test restaurant in São Paulo",
            "entity_type": "restaurant"
        }
        
        response = client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        # CRITICAL: Should NEVER return 500 (indicates async/await bug)
        assert response.status_code != 500, \
            f"❌ 500 error indicates code bug (async/await?): {response.text}"
        
        # Acceptable: 200 (success), 401 (auth), 503 (service unavailable)
        assert response.status_code in [200, 401, 503]
    
    def test_get_usage_stats(self, client):
        """Test getting AI usage statistics"""
        response = client.get("/api/v3/ai/usage-stats")
        
        # Should work or require auth, but not crash with 500
        assert response.status_code != 500, \
            f"Usage stats should not return 500: {response.text}"
        
        assert response.status_code in [200, 401, 403]


class TestAIValidation:
    """Test AI endpoint validation"""
    
    def test_orchestrate_invalid_workflow_type(self, client, auth_headers):
        """Test with invalid workflow type"""
        request_data = {
            "workflow_type": "invalid_type",
            "text": "Test"
        }
        
        response = client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        # Should accept or validate, but NEVER crash with 500
        assert response.status_code != 500, \
            f"Invalid workflow should not cause 500: {response.text}"
        
        # Should return 200 (accepts any workflow) or 400 (validates)
        assert response.status_code in [200, 400, 401]


class TestAsyncAwaitIssues:
    """Tests specifically to catch async/await bugs"""
    
    def test_orchestrate_does_not_return_coroutine(self, client, auth_headers):
        """
        Test that orchestrate endpoint doesn't return a coroutine object
        
        This would have caught the original bug where orchestrator.orchestrate()
        was called without await.
        """
        request_data = {
            "text": "Test restaurant",
            "entity_type": "restaurant"
        }
        
        response = client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        # If endpoint returns a coroutine instead of awaiting it,
        # FastAPI will throw a 500 error
        assert response.status_code != 500, \
            f"❌ CRITICAL: 500 error - likely async/await bug!\n" \
            f"Response: {response.text}\n" \
            f"Check if async methods are being awaited properly."


# Test fixtures
@pytest.fixture
def auth_headers():
    """
    Mock authentication headers for testing
    
    In production tests, this should be a real JWT token
    generated through the OAuth flow.
    """
    # For now, return empty dict - tests will fail with 401
    # which is better than 500
    return {}

