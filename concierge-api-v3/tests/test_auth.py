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
        
        # Current API returns explicit bad request for missing parameters
        assert response.status_code in [400, 422]
    
    def test_google_oauth_callback_invalid_code(self, client):
        """Test OAuth callback with invalid code"""
        response = client.get("/api/v3/auth/callback?code=invalid_code&state=test")
        
        # Should fail with invalid code
        assert response.status_code == 400
    
    def test_logout(self, client):
        """Test logout endpoint"""
        response = client.post("/api/v3/auth/logout")
        
        # Depending on auth policy, logout may require a token
        assert response.status_code in [200, 401]
    
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


import os
from unittest.mock import patch


def test_testing_bypass_only_works_in_development():
    """TESTING=true só deve bypassar auth quando ENVIRONMENT=development."""
    from app.core.security import verify_access_token
    from app.core.config import settings

    # Salva valores originais
    orig_testing = os.environ.get("TESTING")
    orig_env = settings.environment

    try:
        os.environ["TESTING"] = "true"

        # Caso 1: development deve permitir bypass
        with patch.object(settings, "environment", "development"):
            # Não deve lançar exceção
            import asyncio
            result = asyncio.run(verify_access_token(credentials=None))
            assert result["sub"] == "test@example.com"

        # Caso 2: production NÃO deve permitir bypass
        with patch.object(settings, "environment", "production"):
            from fastapi import HTTPException
            try:
                asyncio.run(verify_access_token(credentials=None))
                assert False, "Deveria ter lançado HTTPException 401"
            except HTTPException as e:
                assert e.status_code == 401
    finally:
        if orig_testing is not None:
            os.environ["TESTING"] = orig_testing
        else:
            os.environ.pop("TESTING", None)


def test_oauth_init_rejects_untrusted_callback_url(client):
    """callback_url deve ser validado contra allowlist de origens confiáveis."""

    # URL maliciosa deve ser rejeitada ou ignorada (usar default)
    response = client.get(
        "/api/v3/auth/google?callback_url=https://evil.com/steal",
        follow_redirects=False,
    )

    # Deve rejeitar com 400 (não redirecionar silenciosamente)
    assert response.status_code == 400
    data = response.json()
    assert "Untrusted callback URL" in data.get("detail", "")


def test_oauth_init_accepts_trusted_callback_url():
    """callback_url de origens confiáveis deve ser aceito."""
    from fastapi.testclient import TestClient
    from main import app
    from app.core.config import settings
    from urllib.parse import urlparse, parse_qs
    from jose import jwt

    client = TestClient(app)

    trusted = settings.frontend_url
    response = client.get(
        f"/api/v3/auth/google?callback_url={trusted}",
        follow_redirects=False,
    )

    # Deve redirecionar para o Google (não erro)
    assert response.status_code == 307  # RedirectResponse

    # Verificar que a URL confiável está presente no state
    location = response.headers.get("location", "")
    parsed = urlparse(location)
    params = parse_qs(parsed.query)
    state_encoded = params.get("state", [""])[0]
    assert state_encoded, "State deveria estar presente"
    decoded = jwt.decode(state_encoded, settings.api_secret_key, algorithms=["HS256"])
    sd = decoded.get("sd", "")
    assert trusted in sd, f"State deveria conter a URL confiável: {sd}"
