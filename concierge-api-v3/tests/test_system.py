"""
Test system endpoints: health and info
"""
import pytest


class TestSystemEndpoints:
    """Test system/health endpoints"""
    
    def test_health_check(self, client):
        """Test health check endpoint"""
        response = client.get("/api/v3/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        # Database may be connected or have errors
        assert "database" in data
        assert data["database"] in ["connected"] or data["database"].startswith("error:")
        assert "timestamp" in data
    
    def test_api_info(self, client):
        """Test API info endpoint"""
        response = client.get("/api/v3/info")

        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Concierge Collector API"
        assert data["version"] == "3.0.0"
        assert "description" in data

    def test_openai_endpoints_require_auth(self, client):
        """Endpoints OpenAI-compatíveis devem exigir autenticação."""
        # POST /v1/chat/completions sem auth
        response = client.post("/api/v3/openai/v1/chat/completions", json={
            "model": "gpt-4",
            "messages": [{"role": "user", "content": "hello"}],
        })
        assert response.status_code == 401

        # GET /v1/functions sem auth
        response = client.get("/api/v3/openai/v1/functions")
        assert response.status_code == 401

        # GET /v1/models sem auth
        response = client.get("/api/v3/openai/v1/models")
        assert response.status_code == 401

    def test_openai_endpoints_with_auth(self, client, auth_headers):
        """Endpoints OpenAI-compatíveis com autenticação válida."""
        # POST /v1/chat/completions com auth
        response = client.post(
            "/api/v3/openai/v1/chat/completions",
            json={
                "model": "gpt-4",
                "messages": [{"role": "user", "content": "hello"}],
            },
            headers=auth_headers
        )
        assert response.status_code != 401  # Deve passar auth

        # GET /v1/functions com auth
        response = client.get(
            "/api/v3/openai/v1/functions",
            headers=auth_headers
        )
        assert response.status_code != 401  # Deve passar auth

        # GET /v1/models com auth
        response = client.get(
            "/api/v3/openai/v1/models",
            headers=auth_headers
        )
        assert response.status_code != 401  # Deve passar auth

    def test_global_exception_handler_does_not_leak_details(self, client):
        """O exception handler global nao deve expor detalhes internos no body."""
        from unittest.mock import patch
        from pymongo.collection import Collection

        # The session-scoped client has raise_server_exceptions=True (default),
        # so ServerErrorMiddleware re-raises after sending the 500.
        # We need a throwaway client with raise_server_exceptions=False to
        # actually capture the 500 response body and verify no leak.
        from starlette.testclient import TestClient
        from main import app

        with patch.object(Collection, "find_one", side_effect=RuntimeError("Something broke internally")):
            with TestClient(app, raise_server_exceptions=False) as tc:
                response = tc.get("/api/v3/curations/test_id_that_will_crash")

        assert response.status_code == 500, (
            f"Expected 500, got {response.status_code}: {response.text[:200]}"
        )
        data = response.json()
        assert "Internal server error" in data.get("detail", "")
        # Ensure no Python stack trace, exception type, or variable leaked
        assert "Traceback" not in response.text
        assert "RuntimeError" not in response.text
