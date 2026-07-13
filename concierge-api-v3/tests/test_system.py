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

    def test_global_exception_handler_does_not_leak_details(self, client):
        """O exception handler global não deve expor detalhes internos no body."""
        # Usa uma rota existente que pode disparar erro interno
        response = client.get("/api/v3/entities/nonexistent_____")
        # Verifica que respostas de erro não vazam stack traces
        assert "Traceback" not in response.text
        # Se for 500, confirma que é genérico (sem detalhes da exceção)
        if response.status_code == 500:
            data = response.json()
            assert "Internal server error" in data.get("detail", "")
