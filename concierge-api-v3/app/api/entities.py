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
from motor.motor_asyncio import AsyncIOMotorDatabase

router = APIRouter(prefix="/entities", tags=["entities"])


@router.post("", response_model=Entity, status_code=201)
async def create_entity(
    entity: EntityCreate,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Create a new entity"""
    # Prepare document
    doc = entity.model_dump()
    doc["_id"] = entity.entity_id
    doc["createdAt"] = datetime.now(timezone.utc)
    doc["updatedAt"] = datetime.now(timezone.utc)
    doc["version"] = 1
    
    # Insert
    try:
        await db.entities.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=500,
            detail=f"Entity {entity.entity_id} already exists"
        )
    
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
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Update entity with optimistic locking"""
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
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Delete entity"""
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
        items.append(Entity(**doc))
    
    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset
    )
