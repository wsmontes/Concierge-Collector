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
    Uses create_index with background=True and handles conflicts gracefully
    """
    try:
        entities = _database.entities
        curations = _database.curations
        
        # Entities indexes (non-unique)
        await _create_index_safe(entities, "type", unique=False)
        await _create_index_safe(entities, "name", unique=False)
        await _create_index_safe(entities, "createdAt", unique=False)
        await _create_index_safe(entities, [("name", "text")], unique=False)
        
        # Curations indexes
        # entity_id should be unique per curation (one curation per entity)
        await _create_index_safe(curations, "entity_id", unique=True)
        await _create_index_safe(curations, "curator.id", unique=False)
        await _create_index_safe(curations, "createdAt", unique=False)
        
        logger.info("✅ Database indexes verified/created")
        
    except Exception as e:
        logger.warning(f"⚠️ Index creation failed: {e}")


async def _create_index_safe(collection, keys, unique=False):
    """
    Safely create an index, handling conflicts with existing indexes
    If index exists with different options, drops and recreates it
    """
    try:
        await collection.create_index(keys, unique=unique, background=True)
    except Exception as e:
        # If index exists with different spec, try to drop and recreate
        if "IndexKeySpecsConflict" in str(e) or "IndexOptionsConflict" in str(e):
            try:
                # Get index name
                if isinstance(keys, list):
                    index_name = "_".join([f"{k}_{v}" for k, v in keys])
                else:
                    index_name = f"{keys}_1"
                
                logger.info(f"Dropping conflicting index: {index_name}")
                await collection.drop_index(index_name)
                
                # Recreate with correct spec
                await collection.create_index(keys, unique=unique, background=True)
                logger.info(f"✅ Recreated index: {index_name}")
            except Exception as drop_error:
                logger.warning(f"Could not resolve index conflict: {drop_error}")
        else:
            # Other errors (like index already exists with same spec) can be ignored
            pass


def get_database() -> AsyncIOMotorDatabase:
    """Get database instance for dependency injection"""
    if _database is None:
        raise RuntimeError("Database not initialized. Call connect_to_mongo() first.")
    return _database
