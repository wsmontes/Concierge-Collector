"""
AI API Endpoint Tests
Tests for the /api/v3/ai/* endpoints
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime


class TestAIHealthEndpoint:
    """Tests for GET /api/v3/ai/health"""
    
    @pytest.mark.asyncio
    async def test_health_check_success(self, client, test_db):
        """Test health check returns correct status"""
        # Seed categories
        await test_db.categories.insert_many([
            {"entity_type": "restaurant", "categories": ["modern"], "version": 1, "updated_at": datetime.utcnow()},
            {"entity_type": "bar", "categories": ["cocktail"], "version": 1, "updated_at": datetime.utcnow()}
        ])
        
        # Seed configs
        await test_db.openai_configs.insert_many([
            {"service": "transcription", "enabled": True, "model": "whisper-1", "version": 1, "updated_at": datetime.utcnow()},
            {"service": "concept_extraction_text", "enabled": True, "model": "gpt-4", "version": 1, "updated_at": datetime.utcnow()}
        ])
        
        response = await client.get("/api/v3/ai/health")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "healthy"
        assert data["categories_configured"] == 2
        assert data["services_enabled"] == 2
        assert "openai_api_key_set" in data
    
    @pytest.mark.asyncio
    async def test_health_check_no_data(self, client):
        """Test health check with no data in database"""
        response = await client.get("/api/v3/ai/health")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "healthy"
        assert data["categories_configured"] == 0
        assert data["services_enabled"] == 0


class TestAIOrchestrateEndpoint:
    """Tests for POST /api/v3/ai/orchestrate"""
    
    @pytest.mark.asyncio
    async def test_orchestrate_audio_only(self, client, auth_headers, test_db):
        """Test orchestrate with audio-only workflow"""
        # Seed test data
        await test_db.categories.insert_one({
            "entity_type": "restaurant",
            "categories": ["modern", "traditional"],
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        await test_db.openai_configs.insert_many([
            {
                "service": "transcription",
                "enabled": True,
                "model": "whisper-1",
                "config": {"temperature": 0},
                "prompt_template": None,
                "cache_ttl_seconds": 3600,
                "version": 1,
                "updated_at": datetime.utcnow()
            },
            {
                "service": "concept_extraction_text",
                "enabled": True,
                "model": "gpt-4",
                "config": {"temperature": 0.3, "max_tokens": 500},
                "prompt_template": "Extract concepts from: {{text}}",
                "cache_ttl_seconds": 3600,
                "version": 1,
                "updated_at": datetime.utcnow()
            }
        ])
        
        # Mock OpenAI responses
        with patch("app.services.openai_service.OpenAI") as mock_openai:
            mock_client = MagicMock()
            
            # Mock transcription
            mock_transcription = MagicMock()
            mock_transcription.text = "Modern restaurant with great atmosphere"
            mock_client.audio.transcriptions.create = AsyncMock(return_value=mock_transcription)
            
            # Mock concept extraction
            mock_completion = MagicMock()
            mock_completion.choices = [
                MagicMock(message=MagicMock(content='{"concepts": ["modern"], "confidence_score": 0.9}'))
            ]
            mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)
            
            mock_openai.return_value = mock_client
            
            # Make request
            response = await client.post(
                "/api/v3/ai/orchestrate",
                json={
                    "text": "Modern restaurant with great atmosphere"
                },
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["workflow"] == "audio_only"
        assert "results" in data
        assert "processing_time_ms" in data
        assert data["saved_to_db"] is False  # Smart default
    
    @pytest.mark.asyncio
    async def test_orchestrate_with_save(self, client, auth_headers, test_db):
        """Test orchestrate with save_to_db=True"""
        # Seed test data
        await test_db.categories.insert_one({
            "entity_type": "restaurant",
            "categories": ["modern"],
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        await test_db.openai_configs.insert_one({
            "service": "concept_extraction_text",
            "enabled": True,
            "model": "gpt-4",
            "config": {"temperature": 0.3},
            "prompt_template": "Extract: {{text}}",
            "cache_ttl_seconds": 3600,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        # Mock OpenAI
        with patch("app.services.openai_service.OpenAI") as mock_openai:
            mock_client = MagicMock()
            mock_completion = MagicMock()
            mock_completion.choices = [
                MagicMock(message=MagicMock(content='{"concepts": ["elegant"], "confidence_score": 0.95}'))
            ]
            mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)
            mock_openai.return_value = mock_client
            
            response = await client.post(
                "/api/v3/ai/orchestrate",
                json={
                    "text": "Elegant restaurant",
                    "output": {
                        "save_to_db": True,
                        "return_results": False,
                        "format": "ids_only"
                    }
                },
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["saved_to_db"] is True
        assert data["workflow"] == "audio_only"
    
    @pytest.mark.asyncio
    async def test_orchestrate_invalid_input(self, client, auth_headers):
        """Test orchestrate with invalid input"""
        response = await client.post(
            "/api/v3/ai/orchestrate",
            json={},  # No inputs
            headers=auth_headers
        )
        
        # Should return validation error or 400
        assert response.status_code in [400, 422]
    
    @pytest.mark.asyncio
    async def test_orchestrate_image_workflow(self, client, auth_headers, test_db):
        """Test orchestrate with image-only workflow"""
        # Seed test data
        await test_db.categories.insert_one({
            "entity_type": "restaurant",
            "categories": ["elegant", "modern"],
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        await test_db.openai_configs.insert_one({
            "service": "image_analysis",
            "enabled": True,
            "model": "gpt-4-vision-preview",
            "config": {"max_tokens": 300},
            "prompt_template": "Analyze: {{image_url}}",
            "cache_ttl_seconds": 3600,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        # Mock OpenAI
        with patch("app.services.openai_service.OpenAI") as mock_openai:
            mock_client = MagicMock()
            mock_completion = MagicMock()
            mock_completion.choices = [
                MagicMock(message=MagicMock(content='{"concepts": ["elegant", "modern"], "confidence_score": 0.92}'))
            ]
            mock_client.chat.completions.create = AsyncMock(return_value=mock_completion)
            mock_openai.return_value = mock_client
            
            response = await client.post(
                "/api/v3/ai/orchestrate",
                json={
                    "image_url": "https://example.com/restaurant.jpg"
                },
                headers=auth_headers
            )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["workflow"] == "image_only"
        assert "results" in data


class TestAIUsageStatsEndpoint:
    """Tests for GET /api/v3/ai/usage-stats"""
    
    @pytest.mark.asyncio
    async def test_usage_stats_empty(self, client):
        """Test usage stats with no data"""
        response = await client.get("/api/v3/ai/usage-stats")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "total_requests" in data
        assert "by_service" in data
    
    @pytest.mark.asyncio
    async def test_usage_stats_with_data(self, client, test_db):
        """Test usage stats with existing data"""
        # Insert test transcriptions
        await test_db.ai_transcriptions.insert_many([
            {
                "transcription_id": "trans_1",
                "text": "Test 1",
                "created_at": datetime.utcnow()
            },
            {
                "transcription_id": "trans_2",
                "text": "Test 2",
                "created_at": datetime.utcnow()
            }
        ])
        
        # Insert test concepts
        await test_db.ai_concepts.insert_many([
            {
                "text": "Test 1",
                "result": {"concepts": ["modern"]},
                "created_at": datetime.utcnow()
            }
        ])
        
        response = await client.get("/api/v3/ai/usage-stats")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["total_requests"] >= 3
        assert "by_service" in data
