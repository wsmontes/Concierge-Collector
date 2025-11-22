"""
MongoDB database connection - PyMongo driver
Follows official MongoDB documentation exactly
"""

from pymongo import MongoClient
from pymongo.database import Database
from pymongo.read_preferences import ReadPreference
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

# Global client
_client: MongoClient = None


def connect_to_mongo():
    """Connect to MongoDB - called at startup"""
    global _client
    
    logger.info("Connecting to MongoDB...")
    
    # Per MongoDB docs: pass connection string only
    _client = MongoClient(settings.mongodb_url)
    
    # Test connection
    _client.admin.command('ping')
    logger.info(f"✅ MongoDB connected: {settings.mongodb_db_name}")
    
    # Create indexes
    _ensure_indexes()


def close_mongo_connection():
    """Close MongoDB connection - called at shutdown"""
    global _client
    if _client:
        _client.close()
        logger.info("✅ MongoDB closed")


def get_database() -> Database:
    """Get database instance"""
    if _client is None:
        raise RuntimeError("MongoDB not connected")
    return _client[settings.mongodb_db_name]


def _ensure_indexes():
    """Create indexes if they don't exist"""
    try:
        db = get_database()
        
        # Entities collection
        db.entities.create_index("type", background=True)
        db.entities.create_index("name", background=True)
        db.entities.create_index("createdAt", background=True)
        db.entities.create_index([("name", "text")], background=True)
        
        # Prevent duplicate entities by place_id
        db.entities.create_index("externalId", unique=True, sparse=True, background=True)
        db.entities.create_index("data.place_id", unique=True, sparse=True, background=True)
        
        # Curations collection
        db.curations.create_index("entity_id", unique=True, background=True)
        db.curations.create_index("curator.id", background=True)
        db.curations.create_index("createdAt", background=True)
        
        logger.info("✅ Indexes ready")
    except Exception as e:
        logger.warning(f"Index creation: {e}")
