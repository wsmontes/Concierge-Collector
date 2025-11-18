"""
OpenAIConfigService: Manages OpenAI service configurations from MongoDB.

Provides access to service configurations, prompts, and parameters with caching.
"""

import time
from typing import Dict, Optional, Any
from motor.motor_asyncio import AsyncIOMotorDatabase
from datetime import datetime, UTC


class OpenAIConfigService:
    """Manages OpenAI service configurations from MongoDB with caching and prompt rendering"""
    
    def __init__(self, db: AsyncIOMotorDatabase):
        """
        Initialize OpenAIConfigService.
        
        Args:
            db: Motor async MongoDB database instance
        """
        self.db = db
        self.cache: Dict[str, tuple] = {}
        self.cache_ttl = 600  # 10 minutes cache TTL (configs change less frequently)
    
    async def get_config(self, service: str) -> Dict[str, Any]:
        """
        Get configuration for OpenAI service.
        
        Args:
            service: Service name (transcription, concept_extraction_text, image_analysis)
            
        Returns:
            Configuration dictionary
            
        Raises:
            ValueError: If service not found or disabled
        """
        cache_key = f"openai_config:{service}"
        
        # Check cache
        if cache_key in self.cache:
            cached_data, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                return cached_data
        
        # Fetch from MongoDB
        config = await self.db.openai_configs.find_one({
            "service": service,
            "enabled": True
        })
        
        if not config:
            raise ValueError(f"Service '{service}' not found or disabled")
        
        # Update cache
        self.cache[cache_key] = (config, time.time())
        
        return config
    
    async def render_prompt(
        self, 
        service: str, 
        variables: Dict[str, Any]
    ) -> str:
        """
        Render prompt template with variables.
        
        Args:
            service: Service name
            variables: Dictionary of variables to inject into template
            
        Returns:
            Rendered prompt string
            
        Example:
            variables = {"text": "Great food", "categories": ["modern", "cozy"]}
            prompt = await render_prompt("concept_extraction_text", variables)
        """
        config = await self.get_config(service)
        prompt_template = config.get("prompt_template", "")
        
        # Simple template rendering
        for key, value in variables.items():
            placeholder = "{" + key + "}"
            
            # Convert lists to comma-separated strings
            if isinstance(value, list):
                value = ", ".join(str(v) for v in value)
            
            prompt_template = prompt_template.replace(placeholder, str(value))
        
        return prompt_template
    
    async def update_config(
        self, 
        service: str, 
        updates: Dict[str, Any], 
        updated_by: str = "api"
    ) -> Dict[str, Any]:
        """
        Update OpenAI service configuration.
        
        Args:
            service: Service name
            updates: Dictionary of fields to update
            updated_by: User/system that made the update
            
        Returns:
            Dictionary with update status
        """
        # Add metadata
        updates["updated_at"] = datetime.now(UTC).isoformat()
        updates["updated_by"] = updated_by
        
        result = await self.db.openai_configs.update_one(
            {"service": service},
            {
                "$set": updates,
                "$inc": {"version": 1}
            },
            upsert=True
        )
        
        # Invalidate cache
        cache_key = f"openai_config:{service}"
        if cache_key in self.cache:
            del self.cache[cache_key]
        
        return {
            "updated": True, 
            "service": service
        }
    
    async def toggle_service(self, service: str, enabled: bool) -> Dict[str, Any]:
        """
        Enable or disable a service.
        
        Args:
            service: Service name
            enabled: True to enable, False to disable
            
        Returns:
            Dictionary with toggle status
        """
        result = await self.db.openai_configs.update_one(
            {"service": service},
            {
                "$set": {
                    "enabled": enabled,
                    "updated_at": datetime.now(UTC).isoformat()
                }
            }
        )
        
        # Invalidate cache
        cache_key = f"openai_config:{service}"
        if cache_key in self.cache:
            del self.cache[cache_key]
        
        return {
            "service": service,
            "enabled": enabled
        }
    
    async def list_all_services(self) -> Dict[str, Any]:
        """
        List all OpenAI services.
        
        Returns:
            Dictionary of services with their status
        """
        cursor = self.db.openai_configs.find({})
        services = {}
        
        async for doc in cursor:
            services[doc["service"]] = {
                "model": doc["model"],
                "enabled": doc["enabled"],
                "version": doc.get("version", 1)
            }
        
        return services
    
    def clear_cache(self):
        """Clear the entire cache (useful for testing)"""
        self.cache = {}
