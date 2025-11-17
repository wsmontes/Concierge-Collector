"""
app/routes/sync.py

Purpose: Synchronization endpoints for Collector ↔ Server ↔ Concierge
Responsibilities:
  - /sync/pull - Collector pulls changes from server
  - /sync/push - Collector pushes changes to server
  - /sync/from-concierge - Concierge sends embeddings
Dependencies: FastAPI, database operations
"""

from fastapi import APIRouter, HTTPException, status, Depends
from datetime import datetime
from typing import List, Dict, Any

from app.models import (
    SyncPullRequest,
    SyncPullResponse,
    SyncPushRequest,
    SyncPushResponse,
    ConciergeEmbedding,
    ConciergeUploadRequest,
    ConciergeUploadResponse,
    TokenData,
)
from app.auth import get_current_user
from app import database

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/pull", response_model=SyncPullResponse)
async def sync_pull_endpoint(
    request: SyncPullRequest,
    current_user: TokenData = Depends(get_current_user),
) -> SyncPullResponse:
    """
    Pull changes from server to Collector
    
    Returns all entities/curations updated since last_sync_timestamp
    Requires authentication
    """
    try:
        # Get entities updated since last sync
        entities = await database.get_entities_since(request.last_sync_timestamp)
        
        # Get curations updated since last sync
        curations = await database.get_curations_since(request.last_sync_timestamp)
        
        # Filter by specific entity_ids if provided
        if request.entity_ids:
            entities = [e for e in entities if e.entity_id in request.entity_ids]
            entity_ids_set = set(request.entity_ids)
            curations = [c for c in curations if c.entity_id in entity_ids_set]
        
        # TODO: Track deleted entities/curations
        # For now, return empty lists
        deleted_entity_ids: List[str] = []
        deleted_curation_ids: List[str] = []
        
        return SyncPullResponse(
            entities=entities,
            curations=curations,
            deleted_entity_ids=deleted_entity_ids,
            deleted_curation_ids=deleted_curation_ids,
            sync_timestamp=datetime.utcnow(),
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to pull sync data: {str(e)}",
        )


@router.post("/push", response_model=SyncPushResponse)
async def sync_push_endpoint(
    request: SyncPushRequest,
    current_user: TokenData = Depends(get_current_user),
) -> SyncPushResponse:
    """
    Push changes from Collector to server
    
    Creates or updates entities/curations from Collector
    Handles conflict detection
    Requires authentication
    """
    entities_created = 0
    entities_updated = 0
    entities_deleted = 0
    curations_created = 0
    curations_updated = 0
    curations_deleted = 0
    conflicts = []
    
    try:
        # Process entities
        for entity_dict in request.entities:
            try:
                # Check if this is an update (has entity_id) or create (no entity_id)
                entity_id = entity_dict.get("entity_id")
                
                if entity_id:
                    # Update existing entity
                    existing = await database.get_entity(entity_id)
                    if not existing:
                        conflicts.append({
                            "type": "entity",
                            "entity_id": entity_id,
                            "reason": "Entity not found",
                        })
                        continue
                    
                    # Check version for optimistic locking
                    if "version" in entity_dict and entity_dict["version"] != existing.version:
                        conflicts.append({
                            "type": "entity",
                            "entity_id": entity_id,
                            "reason": f"Version conflict: expected {existing.version}, got {entity_dict['version']}",
                        })
                        continue
                    
                    # Create update object - only fields from EntityUpdate
                    allowed_update_fields = {"name", "status", "location", "contact", "metadata", "tags", "notes", "version"}
                    update_data = {k: v for k, v in entity_dict.items() 
                                  if k in allowed_update_fields}
                    
                    # Ensure version is present
                    if "version" not in update_data:
                        update_data["version"] = existing.version
                    
                    from app.models import EntityUpdate
                    entity_update = EntityUpdate(**update_data)
                    
                    # Update entity with version check
                    current_version = update_data["version"]
                    updated = await database.update_entity(entity_id, entity_update, current_version)
                    if updated:
                        entities_updated += 1
                    else:
                        conflicts.append({
                            "type": "entity",
                            "entity_id": entity_id,
                            "reason": "Update failed",
                        })
                else:
                    # Create new entity
                    from app.models import EntityCreate
                    entity_create = EntityCreate(**entity_dict)
                    await database.create_entity(entity_create)
                    entities_created += 1
                    
            except Exception as e:
                conflicts.append({
                    "type": "entity",
                    "error": str(e),
                })
        
        # Process curations
        for curation_dict in request.curations:
            try:
                entity_id = curation_dict.get("entity_id")
                if not entity_id:
                    conflicts.append({
                        "type": "curation",
                        "reason": "Missing entity_id",
                    })
                    continue
                
                # Verify entity exists
                entity = await database.get_entity(entity_id)
                if not entity:
                    conflicts.append({
                        "type": "curation",
                        "entity_id": entity_id,
                        "message": "Entity not found",
                    })
                    continue
                
                # Create curation
                from app.models import CurationCreate
                curation_create = CurationCreate(**curation_dict)
                await database.create_curation(curation_create)
                curations_created += 1
                
            except Exception as e:
                conflicts.append({
                    "type": "curation",
                    "error": str(e),
                })
        
        # Process deleted entities
        for entity_id in request.deleted_entity_ids:
            try:
                success = await database.delete_entity(entity_id)
                if success:
                    entities_deleted += 1
                else:
                    conflicts.append({
                        "type": "entity_delete",
                        "entity_id": entity_id,
                        "reason": "Entity not found",
                    })
            except Exception as e:
                conflicts.append({
                    "type": "entity_delete",
                    "entity_id": entity_id,
                    "error": str(e),
                })
        
        # Process deleted curations
        for curation_id in request.deleted_curation_ids:
            try:
                success = await database.delete_curation(curation_id, soft_delete=True)
                if success:
                    curations_deleted += 1
                else:
                    conflicts.append({
                        "type": "curation_delete",
                        "curation_id": curation_id,
                        "reason": "Curation not found",
                    })
            except Exception as e:
                conflicts.append({
                    "type": "curation_delete",
                    "curation_id": curation_id,
                    "error": str(e),
                })
        
        return SyncPushResponse(
            entities_created=entities_created,
            entities_updated=entities_updated,
            entities_deleted=entities_deleted,
            curations_created=curations_created,
            curations_updated=curations_updated,
            curations_deleted=curations_deleted,
            conflicts=conflicts,
            sync_timestamp=datetime.utcnow(),
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to push sync data: {str(e)}",
        )


@router.post("/from-concierge", response_model=Dict[str, Any])
async def sync_from_concierge_endpoint(
    request: ConciergeEmbedding,
    current_user: TokenData = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    Receive single embedding from Concierge platform
    
    Appends metadata to entity with embedding from Concierge
    Requires authentication (Concierge service account)
    """
    try:
        # Verify entity exists
        entity = await database.get_entity(request.entity_id)
        if not entity:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Entity {request.entity_id} not found",
            )
        
        # Create metadata object
        metadata = {
            "type": "concierge_embeddings",
            "source": "concierge-platform",
            "data": {
                "embeddings": request.embeddings,
                "analysis": request.analysis,
                "generated_at": request.generated_at.isoformat(),
            },
            "timestamp": datetime.utcnow(),
        }
        
        # Append metadata to entity
        success = await database.update_entity_metadata(
            request.entity_id,
            metadata,
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to update entity metadata",
            )
        
        return {
            "message": "Embedding received successfully",
            "entity_id": request.entity_id,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process Concierge data: {str(e)}",
        )


@router.post("/from-concierge-batch", response_model=ConciergeUploadResponse)
async def sync_from_concierge_batch_endpoint(
    request: ConciergeUploadRequest,
    current_user: TokenData = Depends(get_current_user),
) -> ConciergeUploadResponse:
    """
    Receive embeddings and analysis from Concierge platform
    
    Appends metadata to entities with embeddings from Concierge
    Requires authentication (Concierge service account)
    """
    entities_updated = 0
    errors = []
    
    try:
        for embedding_data in request.embeddings:
            try:
                # Verify entity exists
                entity = await database.get_entity(embedding_data.entity_id)
                if not entity:
                    errors.append({
                        "entity_id": embedding_data.entity_id,
                        "error": "Entity not found",
                    })
                    continue
                
                # Create metadata object
                metadata = {
                    "type": "concierge_embeddings",
                    "source": request.source,
                    "data": {
                        "embeddings": embedding_data.embeddings,
                        "analysis": embedding_data.analysis,
                        "generated_at": embedding_data.generated_at.isoformat(),
                    },
                    "timestamp": datetime.utcnow(),
                }
                
                # Append metadata to entity
                success = await database.update_entity_metadata(
                    embedding_data.entity_id,
                    metadata,
                )
                
                if success:
                    entities_updated += 1
                else:
                    errors.append({
                        "entity_id": embedding_data.entity_id,
                        "error": "Failed to update metadata",
                    })
                    
            except Exception as e:
                errors.append({
                    "entity_id": embedding_data.entity_id,
                    "error": str(e),
                })
        
        return ConciergeUploadResponse(
            entities_updated=entities_updated,
            errors=errors,
            timestamp=datetime.utcnow(),
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process Concierge data: {str(e)}",
        )
