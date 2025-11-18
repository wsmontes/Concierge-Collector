"""
AI Services Tests
Tests for CategoryService, OpenAIConfigService, OpenAIService, and AIOrchestrator
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from datetime import datetime, timedelta

from app.services.category_service import CategoryService
from app.services.openai_config_service import OpenAIConfigService
from app.services.openai_service import OpenAIService
from app.services.ai_orchestrator import AIOrchestrator, OutputHandler


@pytest_asyncio.fixture
async def category_service(test_db):
    """Create CategoryService with test database"""
    service = CategoryService(test_db)
    
    # Seed test categories
    await test_db.categories.insert_many([
        {
            "entity_type": "restaurant",
            "categories": ["modern", "traditional", "michelin_star"],
            "active": True,
            "version": 1,
            "updated_at": datetime.utcnow()
        },
        {
            "entity_type": "bar",
            "categories": ["cocktail_bar", "wine_bar", "brewery"],
            "active": True,
            "version": 1,
            "updated_at": datetime.utcnow()
        }
    ])
    
    yield service
    
    # Cleanup handled by test_db fixture


@pytest_asyncio.fixture
async def openai_config_service(test_db):
    """Create OpenAIConfigService with test database"""
    service = OpenAIConfigService(test_db)
    
    # Seed test configs
    await test_db.openai_configs.insert_many([
        {
            "service": "transcription",
            "enabled": True,
            "model": "whisper-1",
            "config": {"language": "pt", "temperature": 0},
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
            "prompt_template": "Extract concepts from: {{text}}. Categories: {{categories}}",
            "cache_ttl_seconds": 3600,
            "version": 1,
            "updated_at": datetime.utcnow()
        }
    ])
    
    yield service
    
    # Cleanup handled by test_db fixture


@pytest_asyncio.fixture
async def openai_service(test_db, category_service, openai_config_service):
    """Create OpenAIService with mocked OpenAI client"""
    service = OpenAIService(api_key="test_key", db=test_db)
    
    # Mock OpenAI client
    service.client = MagicMock()
    
    yield service


@pytest_asyncio.fixture
async def ai_orchestrator(test_db, openai_service, category_service):
    """Create AIOrchestrator with test services"""
    orchestrator = AIOrchestrator(test_db, openai_service, category_service)
    yield orchestrator


# ============================================================================
# CategoryService Tests
# ============================================================================

class TestCategoryService:
    """Tests for CategoryService"""
    
    @pytest.mark.asyncio
    async def test_get_categories_restaurant(self, category_service):
        """Test getting restaurant categories"""
        categories = await category_service.get_categories("restaurant")
        
        assert categories is not None
        assert "modern" in categories
        assert "traditional" in categories
        assert "michelin_star" in categories
    
    @pytest.mark.asyncio
    async def test_get_categories_bar(self, category_service):
        """Test getting bar categories"""
        categories = await category_service.get_categories("bar")
        
        assert categories is not None
        assert "cocktail_bar" in categories
        assert "wine_bar" in categories
        assert "brewery" in categories
    
    @pytest.mark.asyncio
    async def test_get_categories_fallback(self, category_service):
        """Test fallback to restaurant when entity_type not found"""
        categories = await category_service.get_categories("hotel")
        
        # Should fallback to restaurant
        assert categories is not None
        assert "modern" in categories
    
    @pytest.mark.asyncio
    async def test_categories_cached(self, category_service):
        """Test that categories are cached"""
        # First call
        categories1 = await category_service.get_categories("restaurant")
        
        # Second call should use cache (verify no DB query)
        categories2 = await category_service.get_categories("restaurant")
        
        assert categories1 == categories2
    
    @pytest.mark.asyncio
    async def test_update_categories(self, category_service, test_db):
        """Test updating categories"""
        new_categories = ["new_cat1", "new_cat2", "new_cat3"]
        
        await category_service.update_categories("restaurant", new_categories)
        
        # Verify in database
        doc = await test_db.categories.find_one({"entity_type": "restaurant"})
        assert doc["categories"] == new_categories
        assert doc["version"] == 2  # Version incremented
    
    @pytest.mark.asyncio
    async def test_list_entity_types(self, category_service):
        """Test listing all entity types"""
        entity_types = await category_service.list_all_entity_types()
        
        assert "restaurant" in entity_types
        assert "bar" in entity_types
        assert len(entity_types) == 2


# ============================================================================
# OpenAIConfigService Tests
# ============================================================================

class TestOpenAIConfigService:
    """Tests for OpenAIConfigService"""
    
    @pytest.mark.asyncio
    async def test_get_config(self, openai_config_service):
        """Test getting service config"""
        config = await openai_config_service.get_config("transcription")
        
        assert config is not None
        assert config["service"] == "transcription"
        assert config["model"] == "whisper-1"
        assert config["enabled"] is True
    
    @pytest.mark.asyncio
    async def test_get_config_disabled_service(self, openai_config_service, test_db):
        """Test getting disabled service config raises error"""
        # Disable service
        await test_db.openai_configs.update_one(
            {"service": "transcription"},
            {"$set": {"enabled": False}}
        )
        
        with pytest.raises(ValueError, match="not found or disabled"):
            await openai_config_service.get_config("transcription")
    
    @pytest.mark.asyncio
    async def test_render_prompt_simple(self, openai_config_service):
        """Test simple prompt rendering"""
        # Use actual service with template
        variables = {"text": "Great restaurant", "categories": ["modern", "elegant"]}
        
        rendered = await openai_config_service.render_prompt("concept_extraction_text", variables)
        
        assert "Great restaurant" in rendered
        assert "modern" in rendered
    
    @pytest.mark.asyncio
    async def test_render_prompt_with_list(self, openai_config_service):
        """Test prompt rendering with list variable"""
        variables = {"text": "Test", "categories": ["modern", "traditional", "michelin"]}
        
        rendered = await openai_config_service.render_prompt("concept_extraction_text", variables)
        
        assert "modern" in rendered
        assert "traditional" in rendered
        assert "michelin" in rendered
    
    @pytest.mark.asyncio
    async def test_render_prompt_missing_variable(self, openai_config_service):
        """Test prompt rendering with partial variables"""
        # Template expects {{text}} and {{categories}}, only provide text
        variables = {"text": "Test restaurant"}
        
        rendered = await openai_config_service.render_prompt("concept_extraction_text", variables)
        
        # Should have the text variable replaced
        assert "Test restaurant" in rendered
    
    @pytest.mark.asyncio
    async def test_config_cached(self, openai_config_service):
        """Test that configs are cached"""
        # First call
        config1 = await openai_config_service.get_config("transcription")
        
        # Second call should use cache (verify same result)
        config2 = await openai_config_service.get_config("transcription")
        
        assert config1 == config2
    
    @pytest.mark.asyncio
    async def test_update_config(self, openai_config_service, test_db):
        """Test updating service config"""
        updates = {
            "model": "whisper-2",
            "config": {"language": "en", "temperature": 0.1}
        }
        
        await openai_config_service.update_config("transcription", updates)
        
        # Verify in database
        doc = await test_db.openai_configs.find_one({"service": "transcription"})
        assert doc["model"] == "whisper-2"
        assert doc["config"]["language"] == "en"
        assert doc["version"] == 2
    
    @pytest.mark.asyncio
    async def test_toggle_service(self, openai_config_service, test_db):
        """Test toggling service enabled state"""
        # Disable
        await openai_config_service.toggle_service("transcription", False)
        doc = await test_db.openai_configs.find_one({"service": "transcription"})
        assert doc["enabled"] is False
        
        # Enable
        await openai_config_service.toggle_service("transcription", True)
        doc = await test_db.openai_configs.find_one({"service": "transcription"})
        assert doc["enabled"] is True


# ============================================================================
# OpenAIService Tests
# ============================================================================

class TestOpenAIService:
    """Tests for OpenAIService"""
    
    @pytest.mark.asyncio
    async def test_transcribe_audio_with_file(self, openai_service):
        """Test audio transcription with file"""
        # Mock OpenAI response with proper async mock
        with patch.object(openai_service.client.audio.transcriptions, 'create', new_callable=AsyncMock) as mock_create:
            mock_transcription = MagicMock()
            mock_transcription.text = "Test transcription from audio"
            mock_create.return_value = mock_transcription
            
            # Create a fake file object
            from io import BytesIO
            audio_data = BytesIO(b"fake_audio_data")
            audio_data.name = "test.mp3"
            
            result = await openai_service.transcribe_audio(audio_data=audio_data)
            
            assert result["text"] == "Test transcription from audio"
            assert "transcription_id" in result
            assert result["model"] == "whisper-1"
    
    @pytest.mark.asyncio
    async def test_transcribe_audio_direct_text(self, openai_service):
        """Test transcription with language parameter"""
        # Mock OpenAI response with proper async mock
        with patch.object(openai_service.client.audio.transcriptions, 'create', new_callable=AsyncMock) as mock_create:
            mock_transcription = MagicMock()
            mock_transcription.text = "Texto em português"
            mock_create.return_value = mock_transcription
            
            from io import BytesIO
            audio_data = BytesIO(b"fake_audio_data")
            audio_data.name = "test.mp3"
            
            result = await openai_service.transcribe_audio(audio_data=audio_data, language="pt-BR")
            
            assert result["text"] == "Texto em português"
            assert result["language"] == "pt-BR"
    
    @pytest.mark.asyncio
    async def test_extract_concepts_from_text(self, openai_service, test_db):
        """Test concept extraction from text"""
        # Mock OpenAI response with proper async mock
        with patch.object(openai_service.client.chat.completions, 'create', new_callable=AsyncMock) as mock_create:
            mock_response = MagicMock()
            mock_message = MagicMock()
            mock_message.content = '{"concepts": ["modern", "creative"], "confidence_score": 0.9}'
            mock_choice = MagicMock()
            mock_choice.message = mock_message
            mock_response.choices = [mock_choice]
            mock_create.return_value = mock_response
            
            result = await openai_service.extract_concepts_from_text(
                text="Modern and creative cuisine",
                entity_type="restaurant"
            )
            
            assert "concepts" in result
            assert "modern" in result["concepts"]
            assert "creative" in result["concepts"]
            assert result["confidence_score"] == 0.9
    
    @pytest.mark.asyncio
    async def test_extract_concepts_cached(self, openai_service, test_db):
        """Test concept extraction uses cache"""
        # Insert cached result
        cache_doc = {
            "text": "Test cached text",
            "entity_type": "restaurant",
            "result": {
                "concepts": ["cached_concept"],
                "confidence_score": 0.95
            },
            "created_at": datetime.utcnow(),
            "expires_at": datetime.utcnow() + timedelta(hours=1)
        }
        await test_db.ai_concepts.insert_one(cache_doc)
        
        result = await openai_service.extract_concepts_from_text(
            text="Test cached text",
            entity_type="restaurant"
        )
        
        assert result["concepts"] == ["cached_concept"]
        assert result["confidence_score"] == 0.95
    
    @pytest.mark.asyncio
    async def test_analyze_image(self, openai_service):
        """Test image analysis"""
        # Mock OpenAI response with proper async mock
        with patch.object(openai_service.client.chat.completions, 'create', new_callable=AsyncMock) as mock_create:
            mock_response = MagicMock()
            mock_message = MagicMock()
            mock_message.content = '{"concepts": ["elegant", "modern"], "confidence_score": 0.88, "visual_notes": "Beautiful interior"}'
            mock_choice = MagicMock()
            mock_choice.message = mock_message
            mock_response.choices = [mock_choice]
            mock_create.return_value = mock_response
            
            result = await openai_service.analyze_image(
                image_url="https://example.com/image.jpg",
                entity_type="restaurant"
            )
            
            assert "concepts" in result
            assert "elegant" in result["concepts"]
            assert "modern" in result["concepts"]
            assert result["confidence_score"] == 0.88


# ============================================================================
# OutputHandler Tests
# ============================================================================

class TestOutputHandler:
    """Tests for OutputHandler"""
    
    def test_apply_defaults_no_output(self):
        """Test smart defaults when no output provided"""
        request_data = {}
        result = OutputHandler.apply_defaults(request_data)
        
        assert result["output"]["save_to_db"] is False
        assert result["output"]["return_results"] is True
        assert result["output"]["format"] == "full"
    
    def test_apply_defaults_empty_output(self):
        """Test smart defaults with empty output object"""
        request_data = {"output": {}}
        result = OutputHandler.apply_defaults(request_data)
        
        assert result["output"]["save_to_db"] is True  # Default when output present
        assert result["output"]["return_results"] is False
        assert result["output"]["format"] == "full"
    
    def test_apply_defaults_partial_output(self):
        """Test defaults with partial output config"""
        request_data = {
            "output": {
                "save_to_db": True
            }
        }
        result = OutputHandler.apply_defaults(request_data)
        
        assert result["output"]["save_to_db"] is True
        assert result["output"]["return_results"] is False  # Default when saving
        assert result["output"]["format"] == "full"  # Default format
    
    @pytest.mark.asyncio
    async def test_format_results_full(self):
        """Test full format output"""
        data = {
            "entity": {"entity_id": "ent_123"},
            "curation": {"curation_id": "cur_123"},
            "concepts": {"concepts": ["modern"], "confidence_score": 0.9}
        }
        
        result = await OutputHandler.format_results(data, "full")
        
        assert result == data
    
    @pytest.mark.asyncio
    async def test_format_results_minimal(self):
        """Test minimal format output"""
        data = {
            "entity": {"entity_id": "ent_123"},
            "curation": {"curation_id": "cur_123"},
            "concepts": {"concepts": ["modern"], "confidence_score": 0.9}
        }
        
        result = await OutputHandler.format_results(data, "minimal")
        
        assert result["entity_id"] == "ent_123"
        assert result["curation_id"] == "cur_123"
        assert result["concepts"] == ["modern"]
    
    @pytest.mark.asyncio
    async def test_format_results_ids_only(self):
        """Test ids_only format output"""
        data = {
            "entity": {"entity_id": "ent_123"},
            "curation": {"curation_id": "cur_456"}
        }
        
        result = await OutputHandler.format_results(data, "ids_only")
        
        assert result["entity_id"] == "ent_123"
        assert result["curation_id"] == "cur_456"


# ============================================================================
# AIOrchestrator Tests
# ============================================================================

class TestAIOrchestrator:
    """Tests for AIOrchestrator"""
    
    @pytest.mark.asyncio
    async def test_detect_workflow_audio_only(self, ai_orchestrator):
        """Test workflow detection for audio-only input"""
        inputs = {"text": "Test text"}
        
        workflow = ai_orchestrator._detect_workflow(inputs)
        
        assert workflow == "audio_only"
    
    @pytest.mark.asyncio
    async def test_detect_workflow_image_only(self, ai_orchestrator):
        """Test workflow detection for image-only input"""
        inputs = {"image_url": "https://example.com/image.jpg"}
        
        workflow = ai_orchestrator._detect_workflow(inputs)
        
        assert workflow == "image_only"
    
    @pytest.mark.asyncio
    async def test_detect_workflow_place_with_audio(self, ai_orchestrator):
        """Test workflow detection for place + audio"""
        inputs = {
            "place_id": "place_123",
            "text": "Test text"
        }
        
        workflow = ai_orchestrator._detect_workflow(inputs)
        
        assert workflow == "place_id_with_audio"
    
    @pytest.mark.asyncio
    async def test_detect_workflow_place_with_image(self, ai_orchestrator):
        """Test workflow detection for place + image"""
        inputs = {
            "place_id": "place_123",
            "image_url": "https://example.com/image.jpg"
        }
        
        workflow = ai_orchestrator._detect_workflow(inputs)
        
        assert workflow == "place_id_with_image"
    
    @pytest.mark.asyncio
    async def test_detect_workflow_combined(self, ai_orchestrator):
        """Test workflow detection for combined audio + image"""
        inputs = {
            "place_id": "place_123",
            "text": "Test text",
            "image_url": "https://example.com/image.jpg"
        }
        
        workflow = ai_orchestrator._detect_workflow(inputs)
        
        assert workflow == "place_id_with_audio_and_image"
    
    @pytest.mark.asyncio
    async def test_execute_workflow_audio_only(self, ai_orchestrator, openai_service):
        """Test executing audio-only workflow"""
        # Mock OpenAI responses
        openai_service.transcribe_audio = AsyncMock(return_value={
            "text": "Modern restaurant",
            "source": "direct_text",
            "cached": False
        })
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content='{"concepts": ["modern"], "confidence_score": 0.9}'))
        ]
        openai_service.client.chat.completions.create = AsyncMock(return_value=mock_response)
        
        inputs = {"text": "Modern restaurant"}
        output_config = {"save_to_db": False, "return_results": True, "format": "full"}
        
        result = await ai_orchestrator.execute_workflow(
            workflow="audio_only",
            inputs=inputs,
            output_config=output_config,
            entity_type="restaurant"
        )
        
        assert "transcription" in result
        assert "concepts" in result
        assert result["transcription"]["text"] == "Modern restaurant"
    
    @pytest.mark.asyncio
    async def test_orchestrate_with_auto_detection(self, ai_orchestrator, openai_service):
        """Test full orchestration with auto-detection"""
        # Mock OpenAI responses
        openai_service.transcribe_audio = AsyncMock(return_value={
            "text": "Elegant atmosphere",
            "source": "direct_text",
            "cached": False
        })
        
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(message=MagicMock(content='{"concepts": ["elegant"], "confidence_score": 0.95}'))
        ]
        openai_service.client.chat.completions.create = AsyncMock(return_value=mock_response)
        
        response = await ai_orchestrator.orchestrate(
            inputs={"text": "Elegant atmosphere"},
            output=None,  # Test smart defaults
            entity_type="restaurant"
        )
        
        assert response["workflow"] == "audio_only"
        assert response["saved_to_db"] is False
        assert "results" in response
        assert "processing_time_ms" in response
