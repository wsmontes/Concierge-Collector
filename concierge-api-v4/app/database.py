"""
app/database.py

Purpose: MongoDB database connection and operations using Motor (async)
Responsibilities:
  - Establish MongoDB connection
  - Create indexes
  - Provide CRUD operations for entities and curations
  - Handle optimistic locking via version field
Dependencies: motor, pymongo
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging

from app.core.config import settings
from app.models import Entity, EntityCreate, EntityUpdate, Curation, CurationCreate, CurationUpdate

logger = logging.getLogger(__name__)

# Global database client
_client: Optional[AsyncIOMotorClient] = None
_database: Optional[AsyncIOMotorDatabase] = None


async def connect_to_mongo() -> None:
    """Connect to MongoDB"""
    global _client, _database
    
    try:
        logger.info(f"Connecting to MongoDB: {settings.mongodb_url}")
        _client = AsyncIOMotorClient(
            settings.mongodb_url,
            maxPoolSize=10,
            minPoolSize=1,
        )
        _database = _client[settings.mongodb_db_name]
        
        # Test connection
        await _database.command("ping")
        logger.info(f"✅ Connected to MongoDB: {settings.mongodb_db_name}")
        
        # Create indexes if enabled
        if settings.create_indexes_on_startup:
            await create_indexes()
        
    except Exception as e:
        logger.error(f"❌ Failed to connect to MongoDB: {e}")
        raise


async def close_mongo_connection() -> None:
    """Close MongoDB connection"""
    global _client
    
    if _client:
        _client.close()
        logger.info("✅ Closed MongoDB connection")


def get_database() -> AsyncIOMotorDatabase:
    """Get database instance"""
    if _database is None:
        raise RuntimeError("Database not initialized. Call connect_to_mongo() first.")
    return _database


async def create_indexes() -> None:
    """Create database indexes for performance"""
    db = get_database()
    
    try:
        # Entities collection indexes
        await db.entities.create_index("entity_id", unique=True)
        await db.entities.create_index("type")
        await db.entities.create_index("name")
        await db.entities.create_index("status")
        await db.entities.create_index("createdBy")
        await db.entities.create_index("createdAt")
        await db.entities.create_index([("location.city", 1), ("location.country", 1)])
        await db.entities.create_index("tags")
        
        # Curations collection indexes
        await db.curations.create_index("curation_id", unique=True)
        await db.curations.create_index("entity_id")
        await db.curations.create_index("curator_id")
        await db.curations.create_index("category")
        await db.curations.create_index("createdAt")
        await db.curations.create_index([("entity_id", 1), ("curator_id", 1)])
        
        # Curators collection indexes
        await db.curators.create_index("curator_id", unique=True)
        await db.curators.create_index("email", unique=True)
        await db.curators.create_index("status")
        
        logger.info("✅ Created database indexes")
        
    except Exception as e:
        logger.warning(f"⚠️ Failed to create some indexes: {e}")


# ============================================================================
# ENTITY OPERATIONS
# ============================================================================

async def create_entity(entity: EntityCreate) -> Entity:
    """Create a new entity"""
    db = get_database()
    
    # Generate entity_id
    entity_id = f"entity_{int(datetime.utcnow().timestamp() * 1000)}"
    
    entity_dict = entity.model_dump(by_alias=True)
    entity_dict.update({
        "entity_id": entity_id,
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
        "version": 1,
    })
    
    result = await db.entities.insert_one(entity_dict)
    
    if result.inserted_id:
        created = await db.entities.find_one({"entity_id": entity_id})
        return Entity(**created)
    
    raise RuntimeError("Failed to create entity")


async def get_entity(entity_id: str) -> Optional[Entity]:
    """Get entity by ID"""
    db = get_database()
    
    entity_dict = await db.entities.find_one({"entity_id": entity_id})
    if entity_dict:
        return Entity(**entity_dict)
    return None


async def list_entities(
    entity_type: Optional[str] = None,
    status: Optional[str] = None,
    city: Optional[str] = None,
    country: Optional[str] = None,
    curator_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[Entity]:
    """List entities with filtering"""
    db = get_database()
    
    # Build query
    query: Dict[str, Any] = {}
    
    if entity_type:
        query["type"] = entity_type
    
    if status:
        query["status"] = status
    
    if city:
        query["location.city"] = city
    
    if country:
        query["location.country"] = country
    
    if curator_id:
        query["createdBy"] = curator_id
    
    if tags:
        query["tags"] = {"$in": tags}
    
    # Execute query with pagination
    cursor = db.entities.find(query).skip(skip).limit(limit).sort("createdAt", -1)
    
    entities = []
    async for doc in cursor:
        entities.append(Entity(**doc))
    
    return entities


async def count_entities(
    entity_type: Optional[str] = None,
    status: Optional[str] = None,
    city: Optional[str] = None,
    country: Optional[str] = None,
    curator_id: Optional[str] = None,
    tags: Optional[List[str]] = None,
) -> int:
    """Count entities matching filters"""
    db = get_database()
    
    # Build same query as list_entities
    query: Dict[str, Any] = {}
    
    if entity_type:
        query["type"] = entity_type
    
    if status:
        query["status"] = status
    
    if city:
        query["location.city"] = city
    
    if country:
        query["location.country"] = country
    
    if curator_id:
        query["createdBy"] = curator_id
    
    if tags:
        query["tags"] = {"$in": tags}
    
    return await db.entities.count_documents(query)


async def update_entity(
    entity_id: str,
    entity_update: EntityUpdate,
    current_version: int,
) -> Optional[Entity]:
    """
    Update entity with optimistic locking
    
    Args:
        entity_id: Entity to update
        entity_update: Fields to update
        current_version: Current version (for optimistic locking)
    
    Returns:
        Updated entity or None if version conflict
    """
    db = get_database()
    
    # Prepare update data (exclude None values)
    update_data = entity_update.model_dump(by_alias=True, exclude_none=True)
    
    if not update_data:
        # No fields to update
        return await get_entity(entity_id)
    
    # Add version increment and updatedAt
    update_data["updatedAt"] = datetime.utcnow()
    update_data["version"] = current_version + 1
    
    # Update with version check (optimistic locking)
    result = await db.entities.find_one_and_update(
        {"entity_id": entity_id, "version": current_version},
        {"$set": update_data},
        return_document=True,
    )
    
    if result:
        return Entity(**result)
    
    # Version conflict or entity not found
    return None


async def delete_entity(entity_id: str) -> bool:
    """Soft delete entity (set status to 'deleted')"""
    db = get_database()
    
    result = await db.entities.update_one(
        {"entity_id": entity_id},
        {"$set": {"status": "deleted", "updatedAt": datetime.utcnow()}},
    )
    
    return result.modified_count > 0


async def hard_delete_entity(entity_id: str) -> bool:
    """Hard delete entity (remove from database)"""
    db = get_database()
    
    result = await db.entities.delete_one({"entity_id": entity_id})
    return result.deleted_count > 0


# ============================================================================
# CURATION OPERATIONS
# ============================================================================

async def create_curation(curation: CurationCreate) -> Curation:
    """Create a new curation"""
    db = get_database()
    
    # Generate curation_id
    curation_id = f"curation_{int(datetime.utcnow().timestamp() * 1000)}"
    
    curation_dict = curation.model_dump(by_alias=True)
    curation_dict.update({
        "curation_id": curation_id,
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
        "version": 1,
    })
    
    result = await db.curations.insert_one(curation_dict)
    
    if result.inserted_id:
        created = await db.curations.find_one({"curation_id": curation_id})
        return Curation(**created)
    
    raise RuntimeError("Failed to create curation")


async def get_curation(curation_id: str) -> Optional[Curation]:
    """Get curation by ID"""
    db = get_database()
    
    curation_dict = await db.curations.find_one({"curation_id": curation_id})
    if curation_dict:
        return Curation(**curation_dict)
    return None


async def list_curations(
    entity_id: Optional[str] = None,
    curator_id: Optional[str] = None,
    category: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
) -> List[Curation]:
    """List curations with filtering"""
    db = get_database()
    
    # Build query
    query: Dict[str, Any] = {}
    
    if entity_id:
        query["entity_id"] = entity_id
    
    if curator_id:
        query["curator_id"] = curator_id
    
    if category:
        query["category"] = category
    
    # Execute query with pagination
    cursor = db.curations.find(query).skip(skip).limit(limit).sort("createdAt", -1)
    
    curations = []
    async for doc in cursor:
        curations.append(Curation(**doc))
    
    return curations


async def count_curations(
    entity_id: Optional[str] = None,
    curator_id: Optional[str] = None,
    category: Optional[str] = None,
) -> int:
    """Count curations matching filters"""
    db = get_database()
    
    # Build same query as list_curations
    query: Dict[str, Any] = {}
    
    if entity_id:
        query["entity_id"] = entity_id
    
    if curator_id:
        query["curator_id"] = curator_id
    
    if category:
        query["category"] = category
    
    return await db.curations.count_documents(query)
    if category:
        query["category"] = category
    
    # Execute query with pagination
    cursor = db.curations.find(query).skip(skip).limit(limit).sort("createdAt", -1)
    
    curations = []
    async for doc in cursor:
        curations.append(Curation(**doc))
    
    return curations


async def update_curation(
    curation_id: str,
    curation_update: CurationUpdate,
    current_version: int,
) -> Optional[Curation]:
    """
    Update curation with optimistic locking
    
    Args:
        curation_id: Curation to update
        curation_update: Fields to update
        current_version: Current version (for optimistic locking)
    
    Returns:
        Updated curation or None if version conflict
    """
    db = get_database()
    
    # Prepare update data (exclude None values)
    update_data = curation_update.model_dump(by_alias=True, exclude_none=True)
    
    if not update_data:
        # No fields to update
        return await get_curation(curation_id)
    
    # Add version increment and updatedAt
    update_data["updatedAt"] = datetime.utcnow()
    update_data["version"] = current_version + 1
    
    # Update with version check (optimistic locking)
    result = await db.curations.find_one_and_update(
        {"curation_id": curation_id, "version": current_version},
        {"$set": update_data},
        return_document=True,
    )
    
    if result:
        return Curation(**result)
    
    # Version conflict or curation not found
    return None


async def delete_curation(curation_id: str, soft_delete: bool = False) -> bool:
    """Delete curation (soft or hard)"""
    db = get_database()
    
    if soft_delete:
        # Soft delete: set is_deleted flag
        result = await db.curations.update_one(
            {"curation_id": curation_id},
            {"$set": {"is_deleted": True, "updatedAt": datetime.utcnow()}},
        )
        return result.modified_count > 0
    else:
        # Hard delete: remove from database
        result = await db.curations.delete_one({"curation_id": curation_id})
        return result.deleted_count > 0


# ============================================================================
# SYNC OPERATIONS
# ============================================================================

async def get_entities_since(timestamp: Optional[datetime] = None) -> List[Entity]:
    """Get entities updated since timestamp"""
    db = get_database()
    
    query = {}
    if timestamp:
        query["updatedAt"] = {"$gt": timestamp}
    
    cursor = db.entities.find(query).sort("updatedAt", 1)
    
    entities = []
    async for doc in cursor:
        entities.append(Entity(**doc))
    
    return entities


async def get_curations_since(timestamp: Optional[datetime] = None) -> List[Curation]:
    """Get curations updated since timestamp"""
    db = get_database()
    
    query = {}
    if timestamp:
        query["updatedAt"] = {"$gt": timestamp}
    
    cursor = db.curations.find(query).sort("updatedAt", 1)
    
    curations = []
    async for doc in cursor:
        curations.append(Curation(**doc))
    
    return curations


async def update_entity_metadata(entity_id: str, metadata: Dict[str, Any]) -> bool:
    """
    Append metadata to entity (used for Concierge embeddings)
    
    Args:
        entity_id: Entity to update
        metadata: Metadata object to append
    
    Returns:
        True if successful
    """
    db = get_database()
    
    result = await db.entities.update_one(
        {"entity_id": entity_id},
        {
            "$push": {"metadata": metadata},
            "$set": {"updatedAt": datetime.utcnow()},
        },
    )
    
    return result.modified_count > 0


# ============================================================================
# USER OPERATIONS
# ============================================================================

async def create_user(user_data: Dict[str, Any]) -> str:
    """
    Create a new user
    
    Args:
        user_data: User data with username, email, hashed_password
    
    Returns:
        curator_id (username)
    """
    db = get_database()
    collection = db["users"]
    
    user_doc = {
        "curator_id": user_data["username"],  # Using username as curator_id
        "username": user_data["username"],
        "email": user_data["email"],
        "hashed_password": user_data["hashed_password"],
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
    }
    
    await collection.insert_one(user_doc)
    return user_doc["curator_id"]


async def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """
    Get user by username
    
    Args:
        username: Username to search for
    
    Returns:
        User document or None if not found
    """
    db = get_database()
    collection = db["users"]
    
    user = await collection.find_one({"username": username})
    return user
