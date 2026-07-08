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

        # ── Entities collection ──────────────────────────────────────────────
        # Simple indexes
        db.entities.create_index("type", background=True)
        db.entities.create_index("name", background=True)
        db.entities.create_index("createdAt", background=True)
        db.entities.create_index([("name", "text")], background=True)

        # Uniqueness guards
        db.entities.create_index("externalId", unique=True, sparse=True, background=True)
        db.entities.create_index("data.place_id", unique=True, sparse=True, background=True)

        # Composite indexes for scale
        # Supports: list with status filter + incremental sync (?since)
        db.entities.create_index([("status", 1), ("updatedAt", -1)], background=True)
        # Supports: stable cursor-based pagination on large collections
        db.entities.create_index([("updatedAt", -1), ("_id", 1)], background=True)
        # Supports: type filter combined with status
        db.entities.create_index([("type", 1), ("status", 1)], background=True)

        # ── Curations collection ─────────────────────────────────────────────
        # Drop legacy unique index on entity_id if it exists
        try:
            indexes = db.curations.index_information()
            for name, meta in indexes.items():
                if "key" in meta and meta["key"] == [("entity_id", 1)] and meta.get("unique") is True:
                    logger.warning(f"Found legacy unique index '{name}' on entity_id - Dropping...")
                    db.curations.drop_index(name)
                    logger.info("✅ Dropped legacy unique index")
                    break
        except Exception as e:
            logger.warning(f"Error checking legacy indexes: {e}")

        # Simple indexes
        db.curations.create_index("entity_id", background=True)
        db.curations.create_index("curator.id", background=True)
        db.curations.create_index("createdAt", background=True)

        # Composite indexes for scale
        # Supports: status filter + incremental sync (?since)
        db.curations.create_index([("status", 1), ("updatedAt", -1)], background=True)
        # Supports: curations per entity excluding deleted (most common query)
        db.curations.create_index([("entity_id", 1), ("status", 1)], background=True)
        # Supports: curations per curator with status filter
        db.curations.create_index([("curator.id", 1), ("status", 1)], background=True)
        # Supports: stable cursor-based pagination on large collections
        db.curations.create_index([("updatedAt", -1), ("_id", 1)], background=True)

        logger.info("✅ Indexes ready")
    except Exception as e:
        logger.warning(f"Index creation: {e}")
