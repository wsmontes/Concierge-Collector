"""
Curation endpoints - CRUD operations for curations
Professional FastAPI implementation with async MongoDB
"""

from fastapi import APIRouter, HTTPException, Header, Query, Depends
from typing import Optional, List
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError

from app.models.schemas import (
    Curation, CurationCreate, CurationUpdate, PaginatedResponse
)
from app.core.database import get_database
from app.core.security import verify_access_token
from motor.motor_asyncio import AsyncIOMotorDatabase

router = APIRouter(prefix="/curations", tags=["curations"])


@router.post("", response_model=Curation, status_code=201)
async def create_curation(
    curation: CurationCreate,
    db: AsyncIOMotorDatabase = Depends(get_database),
    token_data: dict = Depends(verify_access_token)  # Require JWT authentication
):
    """Create a new curation
    
    **Authentication Required:** Include `Authorization: Bearer <token>` header
    """
    # Verify entity exists
    entity = await db.entities.find_one({"_id": curation.entity_id})
    if not entity:
        raise HTTPException(
            status_code=404,
            detail=f"Entity {curation.entity_id} not found"
        )
    
    # Prepare document
    doc = curation.model_dump()
    doc["_id"] = curation.curation_id
    doc["createdAt"] = datetime.now(timezone.utc)
    doc["updatedAt"] = datetime.now(timezone.utc)
    doc["version"] = 1
    
    # Insert
    try:
        await db.curations.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=500,
            detail=f"Curation {curation.curation_id} already exists"
        )
    
    # Return created curation
    result = await db.curations.find_one({"_id": curation.curation_id})
    return Curation(**result)


@router.get("/search", response_model=PaginatedResponse)
async def search_curations(
    entity_id: Optional[str] = Query(None),
    curator_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Search curations with filters"""
    # Build query
    query = {}
    if entity_id:
        query["entity_id"] = entity_id
    if curator_id:
        query["curator.id"] = curator_id
    
    # Get total count
    total = await db.curations.count_documents(query)
    
    # Get paginated results
    cursor = db.curations.find(query).skip(offset).limit(limit)
    items = []
    async for doc in cursor:
        items.append(Curation(**doc))
    
    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/entities/{entity_id}/curations", response_model=List[Curation])
async def get_entity_curations(
    entity_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Get all curations for an entity"""
    # Verify entity exists
    entity = await db.entities.find_one({"_id": entity_id})
    if not entity:
        raise HTTPException(
            status_code=404,
            detail=f"Entity {entity_id} not found"
        )
    
    # Get curations
    cursor = db.curations.find({"entity_id": entity_id})
    curations = []
    async for doc in cursor:
        curations.append(Curation(**doc))
    
    return curations


@router.get("/{curation_id}", response_model=Curation)
async def get_curation(
    curation_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database)
):
    """Get curation by ID"""
    result = await db.curations.find_one({"_id": curation_id})
    
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Curation {curation_id} not found"
        )
    
    return Curation(**result)


@router.patch("/{curation_id}", response_model=Curation)
async def update_curation(
    curation_id: str,
    updates: CurationUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: AsyncIOMotorDatabase = Depends(get_database),
    token_data: dict = Depends(verify_access_token)  # Require JWT authentication
):
    """Update curation with optimistic locking
    
    **Authentication Required:** Include `Authorization: Bearer <token>` header
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
    result = await db.curations.find_one_and_update(
        {"_id": curation_id, "version": current_version},
        {"$set": update_data},
        return_document=True
    )
    
    if not result:
        raise HTTPException(
            status_code=409,
            detail="Version conflict or curation not found"
        )
    
    return Curation(**result)


@router.delete("/{curation_id}", status_code=204)
async def delete_curation(
    curation_id: str,
    db: AsyncIOMotorDatabase = Depends(get_database),
    token_data: dict = Depends(verify_access_token)  # Require JWT authentication
):
    """Delete curation
    
    **Authentication Required:** Include `Authorization: Bearer <token>` header
    """
    result = await db.curations.delete_one({"_id": curation_id})
    
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Curation {curation_id} not found"
        )
    
    return None
