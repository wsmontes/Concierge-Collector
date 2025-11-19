"""
Entity endpoints - CRUD operations for entities
Professional FastAPI implementation with async MongoDB
"""

from fastapi import APIRouter, HTTPException, Header, Query, Depends
from typing import Optional, List
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError

from app.models.schemas import (
    Entity, EntityCreate, EntityUpdate, PaginatedResponse, ErrorResponse
)
from app.core.database import get_database
from app.core.security import verify_api_key
from motor.motor_asyncio import AsyncIOMotorDatabase

router = APIRouter(prefix="/entities", tags=["entities"])


@router.post("", response_model=Entity, status_code=201)
async def create_entity(
    entity: EntityCreate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: str = Depends(verify_api_key)  # Require API key
):
    """Create a new entity or update if exists (upsert with merge)
    
    **Authentication Required:** Include `X-API-Key` header
    """
    # Check if entity already exists
    existing = await db.entities.find_one({"_id": entity.entity_id})
    
    if existing:
        # Entity exists - merge data intelligently
        doc = entity.model_dump(exclude_unset=True)
        
        # Merge data field if both have it
        if "data" in doc and "data" in existing:
            # Deep merge data objects (handle None values)
            existing_data = existing.get("data") or {}
            new_data = doc.get("data") or {}
            merged_data = {**existing_data, **new_data}
            doc["data"] = merged_data
        
        # Update timestamps
        doc["updatedAt"] = datetime.now(timezone.utc)
        doc["version"] = existing.get("version", 1) + 1
        
        # Don't overwrite creation metadata
        doc.pop("createdAt", None)
        doc.pop("createdBy", None)
        
        # Update existing entity
        await db.entities.update_one(
            {"_id": entity.entity_id},
            {"$set": doc}
        )
        
        # Return updated entity
        result = await db.entities.find_one({"_id": entity.entity_id})
        return Entity(**result)
    
    else:
        # Entity doesn't exist - create new
        doc = entity.model_dump()
        doc["_id"] = entity.entity_id
        doc["createdAt"] = datetime.now(timezone.utc)
        doc["updatedAt"] = datetime.now(timezone.utc)
        doc["version"] = 1
        
        # Insert
        await db.entities.insert_one(doc)
        
        # Return created entity
        result = await db.entities.find_one({"_id": entity.entity_id})
        return Entity(**result)



@router.get("/{entity_id}", response_model=Entity)
async def get_entity(
    entity_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Get entity by ID"""
    result = await db.entities.find_one({"_id": entity_id})
    
    if not result:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    
    return Entity(**result)


@router.patch("/{entity_id}", response_model=Entity)
async def update_entity(
    entity_id: str,
    updates: EntityUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: str = Depends(verify_api_key)  # Require API key
):
    """Update entity with optimistic locking
    
    **Authentication Required:** Include `X-API-Key` header
    """
    # Check If-Match header
    if not if_match:
        raise HTTPException(
            status_code=428,
            detail="If-Match header is required for updates"
        )
    
    # Parse version from ETag
    try:
        current_version = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid If-Match header format")
    
    # Prepare update
    update_data = {k: v for k, v in updates.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updatedAt"] = datetime.now(timezone.utc)
    update_data["version"] = current_version + 1
    
    # Update with version check (optimistic locking)
    result = await db.entities.find_one_and_update(
        {"_id": entity_id, "version": current_version},
        {"$set": update_data},
        return_document=True
    )
    
    if not result:
        raise HTTPException(
            status_code=409,
            detail="Version conflict or entity not found"
        )
    
    return Entity(**result)


@router.delete("/{entity_id}", status_code=204)
async def delete_entity(
    entity_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    _: str = Depends(verify_api_key)  # Require API key
):
    """Delete entity
    
    **Authentication Required:** Include `X-API-Key` header
    """
    result = await db.entities.delete_one({"_id": entity_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    
    return None


@router.get("", response_model=PaginatedResponse)
async def list_entities(
    type: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """List entities with filters and pagination"""
    # Build query
    query = {}
    if type:
        query["type"] = type
    if name:
        query["name"] = {"$regex": name, "$options": "i"}
    
    # Get total count
    total = await db.entities.count_documents(query)
    
    # Get paginated results
    cursor = db.entities.find(query).skip(offset).limit(limit)
    items = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])  # Convert ObjectId to string
        items.append(Entity(**doc))
    
    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset
    )
