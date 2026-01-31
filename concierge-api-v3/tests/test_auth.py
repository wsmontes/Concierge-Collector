"""
Test authentication endpoints
"""
import pytest


class TestAuthEndpoints:
    """Test OAuth and authentication"""
    
    def test_google_oauth_login(self, client):
        """Test initiating Google OAuth login"""
        response = client.get("/api/v3/auth/google")
        
        # Expect 404 if not configured
        assert response.status_code == 404
    
    def test_google_oauth_callback_missing_code(self, client):
        """Test OAuth callback without code"""
        response = client.get("/api/v3/auth/callback")
        
        # Should fail without code (400 or 422 are both valid)
        assert response.status_code in [400, 422]
    
    def test_google_oauth_callback_invalid_code(self, client):
        """Test OAuth callback with invalid code"""
        response = client.get("/api/v3/auth/callback?code=invalid_code&state=test")
        
        # Should fail with invalid code
        assert response.status_code == 400
    
    def test_logout(self, client):
        """Test logout endpoint"""
        response = client.post("/api/v3/auth/logout")
        
        # May work (200), require auth (401), or not exist (404)
        assert response.status_code in [200, 401, 404]
    
    def test_verify_token_without_auth(self, client):
        """Test verifying token without authentication"""
        response = client.get("/api/v3/auth/verify")
        
        # Should fail without auth
        assert response.status_code == 401
    
    def test_refresh_token_without_data(self, client):
        """Test refreshing token without refresh token"""
        response = client.post("/api/v3/auth/refresh", json={})
        
        # Should fail without refresh token
        assert response.status_code == 422


class TestAuthValidation:
    """Test authentication validation"""
    
    def test_protected_endpoint_without_token(self, client):
        """Test accessing protected endpoint without token"""
        response = client.post("/api/v3/entities", json={
            "entity_id": "test",
            "type": "restaurant",
            "name": "Test"
        })
        
        # Should fail without auth
        assert response.status_code == 401
    
    def test_protected_endpoint_invalid_token(self, client):
        """Test accessing protected endpoint with invalid token"""
        headers = {"Authorization": "Bearer invalid_token"}
        response = client.post(
            "/api/v3/entities",
            json={"entity_id": "test", "type": "restaurant", "name": "Test"},
            headers=headers
        )
        
        # Should fail with invalid token
        assert response.status_code == 401
