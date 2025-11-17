"""
MongoDB database connection and operations using Motor (async driver)
Best practices: connection pooling, proper error handling, indexes
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

# Global database client and database
_client: Optional[AsyncIOMotorClient] = None
_database: Optional[AsyncIOMotorDatabase] = None


async def connect_to_mongo():
    """
    Connect to MongoDB with Motor async driver
    Creates indexes for optimal performance
    """
    global _client, _database
    
    try:
        logger.info(f"Connecting to MongoDB: {settings.mongodb_url[:50]}...")
        
        # Create Motor client (async)
        _client = AsyncIOMotorClient(
            settings.mongodb_url,
            maxPoolSize=10,
            minPoolSize=1,
            serverSelectionTimeoutMS=5000
        )
        
        # Get database
        _database = _client[settings.mongodb_db_name]
        
        # Verify connection
        await _client.admin.command('ping')
        logger.info(f"✅ Connected to MongoDB: {settings.mongodb_db_name}")
        
        # Create indexes
        await create_indexes()
        
    except Exception as e:
        logger.error(f"❌ MongoDB connection failed: {e}")
        raise


async def close_mongo_connection():
    """Close MongoDB connection gracefully"""
    global _client
    if _client:
        _client.close()
        logger.info("✅ MongoDB connection closed")


async def create_indexes():
    """
    Create database indexes for optimal query performance
    Indexes on: _id, type, entity_id, curator.id, createdAt
    """
    try:
        # Entities indexes
        entities = _database.entities
        await entities.create_index("type")
        await entities.create_index("name")
        await entities.create_index("createdAt")
        await entities.create_index([("name", "text")])  # Text search
        
        # Curations indexes
        curations = _database.curations
        await entities.create_index("entity_id")
        await curations.create_index("curator.id")
        await curations.create_index("createdAt")
        
        logger.info("✅ Database indexes created")
        
    except Exception as e:
        logger.warning(f"⚠️ Index creation failed: {e}")


def get_database() -> AsyncIOMotorDatabase:
    """Get database instance for dependency injection"""
    if _database is None:
        raise RuntimeError("Database not initialized. Call connect_to_mongo() first.")
    return _database
