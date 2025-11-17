"""
app/routes/entities.py

Purpose: Entity CRUD endpoints
Responsibilities:
  - List/filter entities
  - Get single entity
  - Create entity
  - Update entity
  - Delete entity
Dependencies: FastAPI, database operations
"""

from fastapi import APIRouter, HTTPException, status, Query, Depends
from typing import Optional, List

from app.models import Entity, EntityCreate, EntityUpdate, TokenData, EntityListResponse
from app.auth import get_current_user, get_current_user_dev
from app import database

router = APIRouter(prefix="/entities", tags=["entities"])


@router.post("/", response_model=Entity, status_code=status.HTTP_201_CREATED)
async def create_entity_endpoint(
    entity: EntityCreate,
    current_user: TokenData = Depends(get_current_user_dev),
) -> Entity:
    """
    Create a new entity
    
    Requires authentication (bypassed in DEV_MODE)
    """
    try:
        created_entity = await database.create_entity(entity)
        return created_entity
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create entity: {str(e)}",
        )


@router.get("/{entity_id}", response_model=Entity)
async def get_entity_endpoint(
    entity_id: str,
) -> Entity:
    """
    Get a single entity by ID
    
    Public endpoint (no authentication required)
    """
    entity = await database.get_entity(entity_id)
    
    if entity is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entity {entity_id} not found",
        )
    
    return entity


@router.get("/", response_model=EntityListResponse)
async def list_entities_endpoint(
    entity_type: Optional[str] = Query(None, description="Filter by entity type (e.g., 'restaurant')"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status"),
    city: Optional[str] = Query(None, description="Filter by city"),
    country: Optional[str] = Query(None, description="Filter by country"),
    curator_id: Optional[str] = Query(None, description="Filter by curator"),
    tags: Optional[str] = Query(None, description="Filter by tags (comma-separated)"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
) -> EntityListResponse:
    """
    List entities with optional filtering and pagination
    
    Public endpoint (no authentication required)
    Returns paginated response with total count
    """
    # Parse tags
    tags_list = tags.split(",") if tags else None
    
    try:
        # Get entities and total count
        entities = await database.list_entities(
            entity_type=entity_type,
            status=status_filter,
            city=city,
            country=country,
            curator_id=curator_id,
            tags=tags_list,
            skip=skip,
            limit=limit,
        )
        
        total = await database.count_entities(
            entity_type=entity_type,
            status=status_filter,
            city=city,
            country=country,
            curator_id=curator_id,
            tags=tags_list,
        )
        
        return EntityListResponse(
            entities=entities,
            total=total,
            skip=skip,
            limit=limit
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list entities: {str(e)}",
        )


@router.put("/{entity_id}", response_model=Entity)
async def update_entity_endpoint(
    entity_id: str,
    entity_update: EntityUpdate,
    current_user: TokenData = Depends(get_current_user_dev),
) -> Entity:
    """
    Update an entity with optimistic locking
    
    Requires authentication (bypassed in DEV_MODE)
    Returns 409 if version conflict occurs
    version field is required in body for optimistic locking
    """
    current_version = entity_update.version
    updated_entity = await database.update_entity(entity_id, entity_update, current_version)
    
    if updated_entity is None:
        # Check if entity exists
        existing = await database.get_entity(entity_id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Entity {entity_id} not found",
            )
        else:
            # Version conflict
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Version conflict. Current version is {existing.version}, you provided {current_version}",
            )
    
    return updated_entity


@router.delete("/{entity_id}", status_code=status.HTTP_200_OK)
async def delete_entity_endpoint(
    entity_id: str,
    hard_delete: bool = Query(False, description="Permanently delete (default: soft delete)"),
    current_user: TokenData = Depends(get_current_user_dev),
):
    """
    Delete an entity
    
    Requires authentication (bypassed in DEV_MODE)
    Default: soft delete (status = 'deleted')
    hard_delete=true: permanently remove from database
    """
    if hard_delete:
        success = await database.hard_delete_entity(entity_id)
    else:
        success = await database.delete_entity(entity_id)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entity {entity_id} not found",
        )
    
    return {"message": "Entity deleted successfully", "entity_id": entity_id, "hard_delete": hard_delete}
