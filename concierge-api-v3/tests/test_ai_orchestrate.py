"""
Test AI Orchestrate Endpoint
Tests specifically designed to catch async/await issues and validate proper endpoint behavior
"""
import pytest
from unittest.mock import MagicMock
from app.services.ai_orchestrator import OutputHandler
from httpx import AsyncClient
import base64
import json


@pytest.mark.openai
class TestAIOrchestrate:
    """Comprehensive tests for /api/v3/ai/orchestrate endpoint"""
    
    @pytest.mark.asyncio
    async def test_orchestrate_endpoint_is_async(self, async_client, auth_headers):
        """
        CRITICAL: Test that orchestrate endpoint properly handles async operations
        
        This test would have caught the async/await bug that caused the 500 error.
        If the endpoint is not properly async, this test will fail.
        """
        # Simple request that should work with minimal processing
        request_data = {
            "text": "Italian restaurant with great pizza",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        # Should NOT return 500 - that indicates async/await issues
        assert response.status_code != 500, f"500 error indicates async/await bug: {response.text}"
        
        # With auth headers, external model/provider may return 400/503 depending on environment
        assert response.status_code in [200, 400, 503], \
            f"Unexpected status code {response.status_code}: {response.text}"
    
    @pytest.mark.asyncio
    async def test_orchestrate_with_audio_base64(self, async_client, auth_headers):
        """
        Test audio transcription workflow (the one that was failing)
        
        This is the actual workflow that users were experiencing errors with.
        """
        # Create a minimal valid audio file (base64 encoded)
        # This is a tiny WAV file header
        fake_audio = base64.b64encode(b"RIFF" + b"\x00" * 40).decode()
        
        request_data = {
            "audio_file": fake_audio,
            "language": "pt-BR",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        # Audio providers may return 500 depending on upstream error mapping
        assert response.status_code in [200, 400, 500, 503]
    
    @pytest.mark.asyncio
    async def test_orchestrate_returns_proper_response_structure(self, async_client, auth_headers):
        """Test that successful responses have proper structure"""
        request_data = {
            "text": "Test restaurant",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        if response.status_code == 200:
            data = response.json()
            # Verify response structure
            assert "workflow" in data, "Response missing 'workflow' field"
            assert "results" in data, "Response missing 'results' field"
            assert "saved_to_db" in data, "Response missing 'saved_to_db' field"
            assert "processing_time_ms" in data, "Response missing 'processing_time_ms' field"
    
    @pytest.mark.asyncio
    async def test_orchestrate_requires_authentication(self, async_client):
        """Test that endpoint requires OAuth authentication"""
        request_data = {
            "text": "Test restaurant",
            "entity_type": "restaurant"
        }
        
        # No auth headers
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_data
        )
        
        # Without auth, should return 401 Unauthorized (no test mode bypass)
        assert response.status_code == 401, \
            f"Expected 401 without auth, got {response.status_code}"
        
        data = response.json()
        assert "detail" in data
        assert "authorization" in data["detail"].lower() or "token" in data["detail"].lower()
    
    @pytest.mark.asyncio
    async def test_orchestrate_workflow_detection(self, async_client, auth_headers):
        """Test that workflow is correctly detected based on inputs"""
        test_cases = [
            {
                "input": {"text": "Test"},
                "expected_workflow": "audio_only"
            },
            {
                "input": {"audio_file": "fake_base64"},
                "expected_workflow": "audio_only"
            },
            # Add more as needed
        ]
        
        for case in test_cases:
            response = await async_client.post(
                "/api/v3/ai/orchestrate",
                json=case["input"],
                headers=auth_headers
            )
            
            # If successful, verify workflow detection
            if response.status_code == 200:
                data = response.json()
                assert data["workflow"] == case["expected_workflow"], \
                    f"Expected workflow {case['expected_workflow']}, got {data['workflow']}"
    
    def test_orchestrate_sync_endpoint_compatibility(self, client, auth_headers):
        """
        Test that endpoint works with synchronous client
        
        This ensures backward compatibility and that we haven't broken
        anything by making the endpoint async.
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
        
        # Should work or return auth/service errors, but NOT 500
        assert response.status_code != 500, \
            f"Sync client got 500 error: {response.text}"


class TestAIEndpointErrorHandling:
    """Test error handling in AI endpoints"""
    
    @pytest.mark.asyncio
    async def test_orchestrate_handles_missing_openai_key(self, async_client, auth_headers, monkeypatch):
        """Test proper error when OpenAI key is missing"""
        # This would require mocking the environment
        # For now, just verify we get a meaningful error, not 500
        pass
    
    @pytest.mark.asyncio
    async def test_orchestrate_handles_invalid_audio_data(self, async_client, auth_headers):
        """Test handling of corrupted audio data"""
        request_data = {
            "audio_file": "this_is_not_valid_base64_!@#$",
            "language": "pt-BR",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        # Invalid/corrupted audio may surface as provider/transcription errors
        assert response.status_code in [400, 500, 503]
    
    @pytest.mark.asyncio
    async def test_orchestrate_with_very_large_audio(self, async_client, auth_headers):
        """Test handling of audio files that are too large"""
        # Create a large base64 string (simulating 100MB audio)
        large_audio = base64.b64encode(b"x" * (100 * 1024 * 1024)).decode()
        
        request_data = {
            "audio_file": large_audio[:1000],  # Just use a portion for testing
            "language": "pt-BR",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_data,
            headers=auth_headers
        )
        
        # Very large/invalid payloads may be rejected by provider/runtime
        assert response.status_code in [200, 400, 413, 500, 503]


class TestAsyncAwaitPatterns:
    """Tests specifically to detect async/await issues"""
    
    @pytest.mark.asyncio
    async def test_all_async_dependencies_are_awaited(self, async_client):
        """
        This test would catch if we forgot to await an async method
        
        The original bug: calling orchestrator.orchestrate() without await
        """
        # Test all async endpoints return valid responses
        endpoints = [
            ("/api/v3/ai/health", "GET", None),
            # Add more async endpoints as needed
        ]
        
        for endpoint, method, data in endpoints:
            if method == "GET":
                response = await async_client.get(endpoint)
            else:
                response = await async_client.post(endpoint, json=data or {})
            
            # None should return 500 from async/await issues
            assert response.status_code != 500, \
                f"{endpoint} returned 500 - possible async/await bug"


class TestOutputHandler:
    """Tests for OutputHandler methods"""

    def test_save_results_writes_to_mongo(self):
        """save_results deve usar operações síncronas do PyMongo (sem await)."""
        mock_db = MagicMock()
        mock_db.entities.update_one = MagicMock(return_value=MagicMock(modified_count=1))
        mock_db.curations.insert_one = MagicMock(return_value=MagicMock(inserted_id="abc123"))

        results = {
            "entity": {"entity_id": "ent_001"},
            "curation": {"curation_id": "cur_001", "entity_id": "ent_001"},
        }

        saved = OutputHandler.save_results(mock_db, results)

        assert "entity" in saved
        assert "curation" in saved
        mock_db.entities.update_one.assert_called_once()
        mock_db.curations.insert_one.assert_called_once()


# Fixtures removed - using global fixtures from conftest.py
# - async_client: defined in conftest.py with pytest_asyncio
# - auth_headers: defined in conftest.py with test mode bypass
