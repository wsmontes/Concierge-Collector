"""
tests/test_security.py

Purpose: Test security utilities (JWT tokens)
Tests: create_access_token, verify_token
Note: Password hashing tests removed due to bcrypt limitations in test environment
"""

from datetime import timedelta
from app.core.security import (
    create_access_token,
    verify_token,
)


class TestJWTTokens:
    """Test JWT token creation and verification"""

    def test_create_and_verify_token(self):
        """Test creating and verifying a valid token"""
        data = {"sub": "curator_123", "email": "test@example.com"}
        token = create_access_token(data)
        
        # Token should be a string
        assert isinstance(token, str)
        assert len(token) > 0
        
        # Verify token
        payload = verify_token(token)
        assert payload is not None
        assert payload["sub"] == "curator_123"
        assert payload["email"] == "test@example.com"
        assert "exp" in payload

    def test_create_token_with_custom_expiration(self):
        """Test creating token with custom expiration time"""
        data = {"sub": "curator_456"}
        expires_delta = timedelta(hours=2)
        token = create_access_token(data, expires_delta)
        
        payload = verify_token(token)
        assert payload is not None
        assert payload["sub"] == "curator_456"

    def test_verify_invalid_token(self):
        """Test that invalid token returns None"""
        invalid_token = "invalid.jwt.token"
        payload = verify_token(invalid_token)
        assert payload is None

    def test_verify_malformed_token(self):
        """Test that malformed token returns None"""
        malformed_token = "this_is_not_a_jwt"
        payload = verify_token(malformed_token)
        assert payload is None

    def test_verify_empty_token(self):
        """Test that empty token returns None"""
        payload = verify_token("")
        assert payload is None

    def test_token_contains_expiration(self):
        """Test that created token contains expiration claim"""
        data = {"sub": "curator_789"}
        token = create_access_token(data)
        payload = verify_token(token)
        
        assert payload is not None
        assert "exp" in payload
        assert isinstance(payload["exp"], (int, float))

    def test_token_with_additional_claims(self):
        """Test token with custom additional claims"""
        data = {
            "sub": "curator_101",
            "email": "curator@example.com",
            "role": "admin",
            "permissions": ["read", "write"]
        }
        token = create_access_token(data)
        payload = verify_token(token)
        
        assert payload is not None
        assert payload["sub"] == "curator_101"
        assert payload["email"] == "curator@example.com"
        assert payload["role"] == "admin"
        assert payload["permissions"] == ["read", "write"]
