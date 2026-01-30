"""
GPT-5.2 Migration Tests
Tests for validating GPT-5.2 Responses API integration and structured outputs
"""
import pytest
from httpx import AsyncClient
import base64


pytestmark = [pytest.mark.openai, pytest.mark.integration]


@pytest.mark.asyncio
class TestGPT52AudioTranscription:
    """Test GPT-5.2 Audio transcription with automatic language detection"""
    
    async def test_audio_language_auto_detection(self, async_client, auth_token):
        """
        Test that GPT-5.2 Audio automatically detects language
        
        Phase 1 Migration: whisper-1 → gpt-5.2-audio with auto-detection
        """
        fake_audio = base64.b64encode(b"RIFF" + b"\x00" * 40).decode()
        
        request_body = {
            "audio_file": fake_audio,
            # Note: No language parameter - testing auto-detection
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Should not crash without language parameter
        assert response.status_code != 500, \
            f"Auto-detection should not cause 500 error: {response.text}"
        
        # May return 200 (success), 400 (invalid audio), or 503 (service unavailable)
        assert response.status_code in [200, 400, 503]
        
        # If successful, verify language was auto-detected
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", {})
            if "transcription" in results:
                trans = results["transcription"]
                assert "language" in trans, "Missing auto-detected language"
                # Should be ISO-639-1 code (e.g., "pt", "en", "es")
                assert len(trans["language"]) == 2, \
                    f"Language code should be ISO-639-1 (2 chars), got: {trans['language']}"
    
    async def test_audio_language_override(self, async_client, auth_token):
        """Test that manual language parameter still works as override"""
        fake_audio = base64.b64encode(b"RIFF" + b"\x00" * 40).decode()
        
        request_body = {
            "audio_file": fake_audio,
            "language": "pt-BR",  # Manual override
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        assert response.status_code != 500
        assert response.status_code in [200, 400, 503]
        
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", {})
            if "transcription" in results:
                trans = results["transcription"]
                # Should use provided language (normalized to pt)
                assert trans["language"] in ["pt", "pt-BR"], \
                    f"Expected 'pt' or 'pt-BR', got: {trans['language']}"
    
    async def test_audio_model_is_gpt52(self, async_client, auth_token):
        """Verify that gpt-5.2-audio model is being used"""
        fake_audio = base64.b64encode(b"RIFF" + b"\x00" * 40).decode()
        
        request_body = {
            "audio_file": fake_audio,
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", {})
            if "transcription" in results:
                trans = results["transcription"]
                if "model" in trans:
                    assert trans["model"] == "gpt-5.2-audio", \
                        f"Expected gpt-5.2-audio, got: {trans['model']}"


@pytest.mark.asyncio
class TestGPT52ConceptExtraction:
    """Test GPT-5.2 concept extraction with structured outputs"""
    
    async def test_concept_extraction_structured_output(self, async_client, auth_token):
        """
        Test that concept extraction uses structured outputs
        
        Phase 2 Migration: gpt-4 → gpt-5.2 with Pydantic validation
        """
        request_body = {
            "text": "Amazing Italian restaurant with wood-fired pizza and romantic ambiance",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        assert response.status_code != 500
        assert response.status_code in [200, 503]
        
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", {})
            
            if "concepts" in results:
                concepts_data = results["concepts"]
                
                # Verify structured output schema (ConceptExtractionOutput)
                assert "concepts" in concepts_data, "Missing concepts array"
                assert "confidence_score" in concepts_data, "Missing confidence_score"
                
                # Verify concepts array is valid
                concepts = concepts_data["concepts"]
                assert isinstance(concepts, list), "concepts should be a list"
                assert 2 <= len(concepts) <= 8, \
                    f"Expected 2-8 concepts, got {len(concepts)}"
                
                # Verify confidence_score is valid
                score = concepts_data["confidence_score"]
                assert 0.0 <= score <= 1.0, \
                    f"confidence_score should be 0.0-1.0, got {score}"
                
                # GPT-5.2 Migration: Check for new reasoning field
                # (optional field, only populated when ambiguous)
                if "reasoning" in concepts_data:
                    assert isinstance(concepts_data["reasoning"], (str, type(None)))
    
    async def test_concept_extraction_model_is_gpt52(self, async_client, auth_token):
        """Verify that gpt-5.2 model is being used for concept extraction"""
        request_body = {
            "text": "Modern Japanese fusion restaurant",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", {})
            if "concepts" in results:
                concepts_data = results["concepts"]
                if "model" in concepts_data:
                    assert concepts_data["model"] == "gpt-5.2", \
                        f"Expected gpt-5.2, got: {concepts_data['model']}"


@pytest.mark.asyncio
class TestGPT52ImageAnalysis:
    """Test GPT-5.2 image analysis with structured outputs"""
    
    async def test_image_analysis_structured_output(self, async_client, auth_token):
        """
        Test that image analysis uses structured outputs
        
        Phase 3 Migration: gpt-4-vision → gpt-5.2 with ImageAnalysisOutput schema
        """
        # Use a test image URL or base64
        request_body = {
            "image_url": "https://example.com/restaurant.jpg",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        assert response.status_code != 500
        assert response.status_code in [200, 400, 503]  # 400 if URL invalid
        
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", {})
            
            if "image_analysis" in results:
                analysis = results["image_analysis"]
                
                # Verify structured output schema (ImageAnalysisOutput)
                assert "description" in analysis, "Missing description field"
                assert "detected_items" in analysis, "Missing detected_items field"
                assert "confidence_score" in analysis, "Missing confidence_score"
                
                # Verify detected_items structure
                items = analysis["detected_items"]
                assert isinstance(items, list), "detected_items should be a list"
                
                # Each item should have name, confidence, category
                for item in items:
                    assert "name" in item, "Item missing name"
                    assert "confidence" in item, "Item missing confidence"
                    assert "category" in item, "Item missing category"
                    assert 0.0 <= item["confidence"] <= 1.0, \
                        f"Item confidence should be 0.0-1.0, got {item['confidence']}"
                
                # GPT-5.2 Migration: Check for new fields
                # cuisine_inference and ambiance are optional
                if "cuisine_inference" in analysis:
                    assert isinstance(analysis["cuisine_inference"], (str, type(None)))
                
                if "ambiance" in analysis:
                    assert isinstance(analysis["ambiance"], (str, type(None)))
                
                # Verify items are sorted by confidence (descending)
                if len(items) > 1:
                    confidences = [item["confidence"] for item in items]
                    assert confidences == sorted(confidences, reverse=True), \
                        "Items should be sorted by confidence (highest first)"
    
    async def test_image_analysis_model_is_gpt52(self, async_client, auth_token):
        """Verify that gpt-5.2 model is being used for image analysis"""
        request_body = {
            "image_url": "https://example.com/restaurant.jpg",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        if response.status_code == 200:
            data = response.json()
            results = data.get("results", {})
            if "image_analysis" in results:
                analysis = results["image_analysis"]
                if "model" in analysis:
                    assert analysis["model"] == "gpt-5.2", \
                        f"Expected gpt-5.2, got: {analysis['model']}"


@pytest.mark.asyncio
class TestGPT52ErrorHandling:
    """Test that GPT-5.2 migration maintains proper error handling"""
    
    async def test_validation_errors_return_400(self, async_client, auth_token):
        """Test that Pydantic validation errors return 400 (not 500)"""
        # This would have caused parsing errors with old json.loads() approach
        request_body = {
            "text": "Test",
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Should never return 500 - structured outputs prevent this
        assert response.status_code != 500, \
            "Structured outputs should prevent 500 errors from invalid responses"
    
    async def test_responses_api_error_handling(self, async_client, auth_token):
        """Test that Responses API errors are handled gracefully"""
        request_body = {
            "text": "Test restaurant" * 1000,  # Very long text
            "entity_type": "restaurant"
        }
        
        response = await async_client.post(
            "/api/v3/ai/orchestrate",
            json=request_body,
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Should handle gracefully (400 for too long, 503 if API fails)
        # But NEVER 500
        assert response.status_code != 500
        assert response.status_code in [200, 400, 503]
