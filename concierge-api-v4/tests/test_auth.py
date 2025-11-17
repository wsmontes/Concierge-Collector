"""
tests/test_auth.py

Purpose: Test authentication and authorization
Responsibilities:
  - Test JWT token generation
  - Test token validation
  - Test protected endpoint access
  - Test invalid tokens
Dependencies: pytest, httpx
"""

import pytest
from datetime import timedelta
from app.core.security import create_access_token, verify_token


class TestAuthentication:
    """Test authentication flows"""

    def test_create_access_token(self):
        """Test JWT token creation"""
        data = {"sub": "test_user_123", "email": "test@example.com"}
        token = create_access_token(data)
        
        assert token is not None
        assert isinstance(token, str)
        assert len(token) > 0

    def test_verify_valid_token(self):
        """Test verification of valid token"""
        data = {"sub": "test_user_123", "email": "test@example.com"}
        token = create_access_token(data)
        
        payload = verify_token(token)
        
        assert payload is not None
        assert payload.get("sub") == "test_user_123"
        assert payload.get("email") == "test@example.com"

    def test_verify_invalid_token(self):
        """Test verification of invalid token"""
        invalid_token = "invalid.token.here"
        
        payload = verify_token(invalid_token)
        
        assert payload is None

    def test_verify_expired_token(self):
        """Test verification of expired token"""
        data = {"sub": "test_user_123"}
        # Create token that expires immediately
        token = create_access_token(data, expires_delta=timedelta(seconds=-1))
        
        payload = verify_token(token)
        
        assert payload is None


@pytest.mark.asyncio
class TestProtectedEndpoints:
    """Test protected endpoint access"""

    async def test_create_entity_without_auth(self, client, sample_entity_data):
        """Test creating entity without authentication"""
        response = await client.post("/api/v4/entities/", json=sample_entity_data)
        
        assert response.status_code == 403

    async def test_create_entity_with_auth(self, client, sample_entity_data, auth_headers):
        """Test creating entity with valid authentication"""
        response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == sample_entity_data["name"]
        assert "entity_id" in data

    async def test_create_entity_with_invalid_token(self, client, sample_entity_data):
        """Test creating entity with invalid token"""
        headers = {"Authorization": "Bearer invalid_token"}
        response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=headers
        )
        
        assert response.status_code == 401

    async def test_update_entity_without_auth(self, client, sample_entity_data, sample_entity_update_data, auth_headers):
        """Test updating entity without authentication"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = create_response.json()
        
        # Try to update without auth
        update_data = {**sample_entity_update_data, "version": entity["version"]}
        response = await client.put(
            f"/api/v4/entities/{entity['entity_id']}", 
            json=update_data
        )
        
        assert response.status_code == 403

    async def test_update_entity_with_auth(self, client, sample_entity_data, sample_entity_update_data, auth_headers):
        """Test updating entity with valid authentication"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = create_response.json()
        
        # Update with auth
        update_data = {**sample_entity_update_data, "version": entity["version"]}
        response = await client.put(
            f"/api/v4/entities/{entity['entity_id']}", 
            json=update_data,
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == sample_entity_update_data["name"]
        assert data["version"] == entity["version"] + 1

    async def test_delete_entity_without_auth(self, client, sample_entity_data, auth_headers):
        """Test deleting entity without authentication"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = create_response.json()
        
        # Try to delete without auth
        response = await client.delete(f"/api/v4/entities/{entity['entity_id']}")
        
        assert response.status_code == 403

    async def test_delete_entity_with_auth(self, client, sample_entity_data, auth_headers):
        """Test deleting entity with valid authentication"""
        # First create an entity
        create_response = await client.post(
            "/api/v4/entities/", 
            json=sample_entity_data,
            headers=auth_headers
        )
        entity = create_response.json()
        
        # Delete with auth
        response = await client.delete(
            f"/api/v4/entities/{entity['entity_id']}",
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Entity deleted successfully"
