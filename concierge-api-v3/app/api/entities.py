"""
Entity endpoints - CRUD operations
"""

from fastapi import APIRouter, HTTPException, Header, Query, Depends
from fastapi.security import HTTPAuthorizationCredentials
from typing import Optional, List
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
from pymongo.database import Database
import secrets

from app.models.schemas import (
    Entity, EntityCreate, EntityUpdate, PaginatedResponse, ErrorResponse
)
from app.core.database import get_database
from app.core.security import api_key_header, bearer_scheme, get_api_secret_key
from jose import jwt, JWTError

router = APIRouter(prefix="/entities", tags=["entities"])


async def verify_auth(
    api_key: Optional[str] = Depends(api_key_header),
    bearer: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)
) -> dict:
    """Verify either OAuth token or API key"""
    # Try API key first
    if api_key:
        try:
            expected_key = get_api_secret_key()
            if secrets.compare_digest(api_key, expected_key):
                return {"authenticated": True, "method": "api_key"}
        except:
            pass
    
    # Try Bearer token
    if bearer:
        try:
            # Import here to avoid circular dependency
            from app.core.security import ALGORITHM
            payload = jwt.decode(bearer.credentials, get_api_secret_key(), algorithms=[ALGORITHM])
            return {"authenticated": True, "method": "jwt", "user": payload.get("sub")}
        except JWTError:
            pass
    
    raise HTTPException(status_code=401, detail="Missing authorization token")


@router.post("", response_model=Entity, status_code=201)
def create_entity(
    entity: EntityCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)
):
    """Create new entity or update if exists"""
    # Check if exists
    existing = db.entities.find_one({"_id": entity.entity_id})
    
    if existing:
        # Merge data
        doc = entity.model_dump(exclude_unset=True)
        
        if "data" in doc and "data" in existing:
            existing_data = existing.get("data") or {}
            new_data = doc.get("data") or {}
            doc["data"] = {**existing_data, **new_data}
        
        doc["updatedAt"] = datetime.now(timezone.utc)
        doc["version"] = existing.get("version", 1) + 1
        doc.pop("createdAt", None)
        doc.pop("createdBy", None)
        
        db.entities.update_one(
            {"_id": entity.entity_id},
            {"$set": doc}
        )
        
        result = db.entities.find_one({"_id": entity.entity_id})
        return Entity(**result)
    
    else:
        # Create new
        doc = entity.model_dump()
        doc["_id"] = entity.entity_id
        doc["createdAt"] = datetime.now(timezone.utc)
        doc["updatedAt"] = datetime.now(timezone.utc)
        doc["version"] = 1
        
        db.entities.insert_one(doc)
        
        result = db.entities.find_one({"_id": entity.entity_id})
        return Entity(**result)


@router.get("/{entity_id}", response_model=Entity)
def get_entity(
    entity_id: str,
    db: Database = Depends(get_database)
):
    """Get entity by ID"""
    result = db.entities.find_one({"_id": entity_id})
    
    if not result:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    
    return Entity(**result)


@router.patch("/{entity_id}", response_model=Entity)
def update_entity(
    entity_id: str,
    updates: EntityUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)
):
    """Update entity with optimistic locking"""
    if not if_match:
        raise HTTPException(
            status_code=428,
            detail="If-Match header required"
        )
    
    try:
        current_version = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid If-Match")
    
    update_data = {k: v for k, v in updates.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updatedAt"] = datetime.now(timezone.utc)
    update_data["version"] = current_version + 1
    
    result = db.entities.find_one_and_update(
        {"_id": entity_id, "version": current_version},
        {"$set": update_data},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=409, detail="Version conflict or not found")
    
    return Entity(**result)


@router.delete("/{entity_id}", status_code=204)
def delete_entity(
    entity_id: str,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)
):
    """Delete entity"""
    result = db.entities.delete_one({"_id": entity_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    
    return None


@router.get("", response_model=PaginatedResponse)
def list_entities(
    type: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    since: Optional[str] = Query(None, description="ISO timestamp - only return entities updated after this time"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_database)
):
    """List entities with filters and pagination
    
    Supports incremental sync via ?since parameter:
    - If since is provided, only returns entities with updatedAt >= since
    - Reduces bandwidth for large collections (1000 entities → ~10 per sync)
    """
    query = {}
    if type:
        query["type"] = type
    if name:
        query["name"] = {"$regex": name, "$options": "i"}
    
    # ✅ INCREMENTAL SYNC: Filter by updatedAt >= since
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            query["updatedAt"] = {"$gte": since_dt}
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid since timestamp format. Use ISO 8601.")
    
    total = db.entities.count_documents(query)
    
    cursor = db.entities.find(query).skip(offset).limit(limit)
    items = []
    for doc in cursor:
        doc["_id"] = str(doc["_id"])
        items.append(Entity(**doc))
    
    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset
    )
