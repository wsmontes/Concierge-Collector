"""
AI Services Tests - Simplified
Basic integration tests for AI services
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock
from datetime import datetime

from app.services.category_service import CategoryService
from app.services.openai_config_service import OpenAIConfigService


# ============================================================================
# CategoryService Tests
# ============================================================================

class TestCategoryService:
    """Tests for CategoryService"""
    
    @pytest.mark.asyncio
    async def test_get_categories_from_db(self, test_db):
        """Test getting categories from database"""
        service = CategoryService(test_db)
        
        # Seed categories
        await test_db.categories.insert_one({
            "entity_type": "restaurant",
            "categories": ["modern", "traditional", "michelin_star"],
            "active": True,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        categories = await service.get_categories("restaurant")
        
        assert categories is not None
        assert len(categories) > 0
    
    @pytest.mark.asyncio
    async def test_update_categories(self, test_db):
        """Test updating categories"""
        service = CategoryService(test_db)
        new_categories = ["new_cat1", "new_cat2", "new_cat3"]
        
        result = await service.update_categories("restaurant", new_categories)
        
        assert result["updated"] is True
        assert result["entity_type"] == "restaurant"
        assert result["count"] == 3
        
        # Verify in database
        doc = await test_db.categories.find_one({"entity_type": "restaurant"})
        assert doc["categories"] == new_categories
    
    @pytest.mark.asyncio
    async def test_clear_cache(self, test_db):
        """Test cache clearing"""
        service = CategoryService(test_db)
        
        # Seed and load
        await test_db.categories.insert_one({
            "entity_type": "restaurant",
            "categories": ["modern"],
            "active": True,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        await service.get_categories("restaurant")
        
        # Clear cache should not raise error
        service.clear_cache()
        assert len(service.cache) == 0


# ============================================================================
# OpenAIConfigService Tests
# ============================================================================

class TestOpenAIConfigService:
    """Tests for OpenAIConfigService"""
    
    @pytest.mark.asyncio
    async def test_get_config_success(self, test_db):
        """Test getting service config"""
        service = OpenAIConfigService(test_db)
        
        # Seed config
        await test_db.openai_configs.insert_one({
            "service": "transcription",
            "enabled": True,
            "model": "whisper-1",
            "config": {"language": "pt", "temperature": 0},
            "prompt_template": None,
            "cache_ttl_seconds": 3600,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        config = await service.get_config("transcription")
        
        assert config is not None
        assert config["service"] == "transcription"
        assert config["model"] == "whisper-1"
        assert config["enabled"] is True
    
    @pytest.mark.asyncio
    async def test_get_config_not_found(self, test_db):
        """Test getting non-existent service config"""
        service = OpenAIConfigService(test_db)
        
        with pytest.raises(ValueError):
            await service.get_config("nonexistent_service")
    
    @pytest.mark.asyncio
    async def test_render_prompt(self, test_db):
        """Test prompt rendering"""
        service = OpenAIConfigService(test_db)
        
        # Seed config with template
        await test_db.openai_configs.insert_one({
            "service": "test_service",
            "enabled": True,
            "model": "gpt-4",
            "config": {},
            "prompt_template": "Hello {name}, welcome to {place}!",
            "cache_ttl_seconds": 3600,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        rendered = await service.render_prompt("test_service", {
            "name": "John",
            "place": "Restaurant"
        })
        
        assert "John" in rendered
        assert "Restaurant" in rendered
    
    @pytest.mark.asyncio
    async def test_update_config(self, test_db):
        """Test updating service config"""
        service = OpenAIConfigService(test_db)
        
        # Seed initial config
        await test_db.openai_configs.insert_one({
            "service": "transcription",
            "enabled": True,
            "model": "whisper-1",
            "config": {"language": "pt"},
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        # Update
        result = await service.update_config("transcription", {
            "model": "whisper-2",
            "config": {"language": "en"}
        })
        
        assert result["updated"] is True
        
        # Verify in database
        doc = await test_db.openai_configs.find_one({"service": "transcription"})
        assert doc["model"] == "whisper-2"
        assert doc["config"]["language"] == "en"
    
    @pytest.mark.asyncio
    async def test_toggle_service(self, test_db):
        """Test toggling service enabled state"""
        service = OpenAIConfigService(test_db)
        
        # Seed config
        await test_db.openai_configs.insert_one({
            "service": "transcription",
            "enabled": True,
            "model": "whisper-1",
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        # Disable
        result = await service.toggle_service("transcription", False)
        assert result["service"] == "transcription"
        
        doc = await test_db.openai_configs.find_one({"service": "transcription"})
        assert doc["enabled"] is False
        
        # Enable
        await service.toggle_service("transcription", True)
        doc = await test_db.openai_configs.find_one({"service": "transcription"})
        assert doc["enabled"] is True


# ============================================================================
# Integration Tests
# ============================================================================

class TestAIServicesIntegration:
    """Integration tests for AI services"""
    
    @pytest.mark.asyncio
    async def test_category_and_config_services_together(self, test_db):
        """Test using both services together"""
        category_service = CategoryService(test_db)
        config_service = OpenAIConfigService(test_db)
        
        # Seed data
        await test_db.categories.insert_one({
            "entity_type": "restaurant",
            "categories": ["modern", "traditional"],
            "active": True,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        await test_db.openai_configs.insert_one({
            "service": "concept_extraction_text",
            "enabled": True,
            "model": "gpt-4",
            "config": {"temperature": 0.3},
            "prompt_template": "Categories: {categories}",
            "cache_ttl_seconds": 3600,
            "version": 1,
            "updated_at": datetime.utcnow()
        })
        
        # Get categories
        categories = await category_service.get_categories("restaurant")
        assert len(categories) > 0
        
        # Get config
        config = await config_service.get_config("concept_extraction_text")
        assert config["model"] == "gpt-4"
        
        # Render prompt with categories
        rendered = await config_service.render_prompt("concept_extraction_text", {
            "categories": categories
        })
        assert "modern" in rendered or "traditional" in rendered
