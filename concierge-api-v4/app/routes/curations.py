"""
app/routes/curations.py

Purpose: Curation CRUD endpoints
Responsibilities:
  - List/filter curations
  - Get single curation
  - Create curation
  - Update curation
  - Delete curation
Dependencies: FastAPI, database operations
"""

from fastapi import APIRouter, HTTPException, status, Query, Depends
from typing import Optional, List

from app.models import Curation, CurationCreate, CurationUpdate, TokenData, CurationListResponse
from app.auth import get_current_user
from app import database

router = APIRouter(prefix="/curations", tags=["curations"])


@router.post("/", response_model=Curation, status_code=status.HTTP_201_CREATED)
async def create_curation_endpoint(
    curation: CurationCreate,
    current_user: TokenData = Depends(get_current_user),
) -> Curation:
    """
    Create a new curation
    
    Requires authentication
    Validates that entity exists before creating curation
    """
    # Verify entity exists
    entity = await database.get_entity(curation.entity_id)
    if entity is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entity {curation.entity_id} not found",
        )
    
    try:
        created_curation = await database.create_curation(curation)
        return created_curation
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create curation: {str(e)}",
        )


@router.get("/{curation_id}", response_model=Curation)
async def get_curation_endpoint(
    curation_id: str,
) -> Curation:
    """
    Get a single curation by ID
    
    Public endpoint (no authentication required)
    """
    curation = await database.get_curation(curation_id)
    
    if curation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Curation {curation_id} not found",
        )
    
    return curation


@router.get("/", response_model=CurationListResponse)
async def list_curations_endpoint(
    entity_id: Optional[str] = Query(None, description="Filter by entity ID"),
    curator_id: Optional[str] = Query(None, description="Filter by curator ID"),
    category: Optional[str] = Query(None, description="Filter by category"),
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(100, ge=1, le=500, description="Maximum records to return"),
) -> CurationListResponse:
    """
    List curations with optional filtering and pagination
    
    Public endpoint (no authentication required)
    Returns paginated response with total count
    """
    try:
        # Get curations and total count
        curations = await database.list_curations(
            entity_id=entity_id,
            curator_id=curator_id,
            category=category,
            skip=skip,
            limit=limit,
        )
        
        total = await database.count_curations(
            entity_id=entity_id,
            curator_id=curator_id,
            category=category,
        )
        
        return CurationListResponse(
            curations=curations,
            total=total,
            skip=skip,
            limit=limit
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list curations: {str(e)}",
        )


@router.put("/{curation_id}", response_model=Curation)
async def update_curation_endpoint(
    curation_id: str,
    curation_update: CurationUpdate,
    current_user: TokenData = Depends(get_current_user),
) -> Curation:
    """
    Update a curation with optimistic locking
    
    Requires authentication
    Returns 409 if version conflict occurs
    version field is required in body for optimistic locking
    """
    current_version = curation_update.version
    updated_curation = await database.update_curation(curation_id, curation_update, current_version)
    
    if updated_curation is None:
        # Check if curation exists
        existing = await database.get_curation(curation_id)
        if existing is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Curation {curation_id} not found",
            )
        else:
            # Version conflict
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Version conflict. Current version is {existing.version}, you provided {current_version}",
            )
    
    return updated_curation


@router.delete("/{curation_id}", status_code=status.HTTP_200_OK)
async def delete_curation_endpoint(
    curation_id: str,
    hard_delete: bool = Query(False, description="Permanently delete (default: soft delete)"),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Delete a curation
    
    Requires authentication
    Default: soft delete (set is_deleted flag)
    hard_delete=true: permanently remove from database
    """
    success = await database.delete_curation(curation_id, soft_delete=not hard_delete)
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Curation {curation_id} not found",
        )
    
    return {"message": "Curation deleted successfully", "curation_id": curation_id, "hard_delete": hard_delete}
