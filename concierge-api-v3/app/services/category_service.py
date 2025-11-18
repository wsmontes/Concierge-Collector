"""
CategoryService: Manages concept categories from MongoDB.

Provides access to concept categories by entity type with caching and fallback logic.
"""

import time
from typing import List, Optional, Dict
from motor.motor_asyncio import AsyncIOMotorDatabase
from datetime import datetime, UTC


class CategoryService:
    """Manages concept categories from MongoDB with in-memory caching"""
    
    def __init__(self, db: AsyncIOMotorDatabase):
        """
        Initialize CategoryService.
        
        Args:
            db: Motor async MongoDB database instance
        """
        self.db = db
        self.cache: Dict[str, tuple] = {}
        self.cache_ttl = 3600  # 1 hour cache TTL
    
    async def get_categories(self, entity_type: str = "restaurant") -> List[str]:
        """
        Get categories for entity type with caching.
        
        Args:
            entity_type: Type of entity (restaurant, bar, hotel, attraction)
            
        Returns:
            List of concept category strings
            
        Notes:
            - Uses in-memory cache (1h TTL)
            - Falls back to restaurant categories if entity_type not found
            - Returns empty list if no categories found at all
        """
        cache_key = f"categories:{entity_type}"
        
        # Check cache
        if cache_key in self.cache:
            cached_data, timestamp = self.cache[cache_key]
            if time.time() - timestamp < self.cache_ttl:
                return cached_data
        
        # Fetch from MongoDB
        doc = await self.db.categories.find_one({
            "entity_type": entity_type,
            "active": True
        })
        
        if not doc:
            # Fallback to restaurant categories
            if entity_type != "restaurant":
                return await self.get_categories("restaurant")
            else:
                # No categories at all
                return []
        
        categories = doc.get("categories", [])
        
        # Update cache
        self.cache[cache_key] = (categories, time.time())
        
        return categories
    
    async def update_categories(
        self, 
        entity_type: str, 
        categories: List[str], 
        updated_by: str = "api"
    ) -> Dict[str, any]:
        """
        Update categories for entity type.
        
        Args:
            entity_type: Type of entity
            categories: List of category strings
            updated_by: User/system that made the update
            
        Returns:
            Dictionary with update status
        """
        result = await self.db.categories.update_one(
            {"entity_type": entity_type},
            {
                "$set": {
                    "categories": categories,
                    "updated_at": datetime.now(UTC).isoformat(),
                    "updated_by": updated_by
                },
                "$inc": {"version": 1}
            },
            upsert=True
        )
        
        # Invalidate cache
        cache_key = f"categories:{entity_type}"
        if cache_key in self.cache:
            del self.cache[cache_key]
        
        return {
            "updated": True, 
            "entity_type": entity_type,
            "count": len(categories)
        }
    
    async def list_all_entity_types(self) -> List[str]:
        """
        List all available entity types.
        
        Returns:
            List of entity type strings
        """
        cursor = self.db.categories.find({"active": True})
        entity_types = []
        
        async for doc in cursor:
            entity_types.append(doc["entity_type"])
        
        return sorted(entity_types)
    
    async def get_category_stats(self) -> Dict[str, int]:
        """
        Get statistics about categories.
        
        Returns:
            Dictionary mapping entity_type to category count
        """
        cursor = self.db.categories.find({"active": True})
        stats = {}
        
        async for doc in cursor:
            stats[doc["entity_type"]] = len(doc.get("categories", []))
        
        return stats
    
    def clear_cache(self):
        """Clear the entire cache (useful for testing)"""
        self.cache = {}
