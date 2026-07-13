"""
Entity endpoints - CRUD operations
"""

from fastapi import APIRouter, HTTPException, Header, Query, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials
from typing import Optional, List
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
from pymongo.database import Database
import secrets

from jose import jwt, JWTError

from app.models.schemas import (
    Entity, EntityCreate, EntityUpdate, PaginatedResponse, ErrorResponse,
    BulkEntityCreate, BulkOperationResponse, BulkItemError
)
from app.core.database import get_database
from app.models.user import has_role
from app.core.security import api_key_header, bearer_scheme, get_api_secret_key

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
            return {
                "authenticated": True,
                "method": "jwt",
                "user": payload.get("sub"),
                "role": payload.get("role", "curator")
            }
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
    after_id: Optional[str] = Query(None, description="Cursor-based pagination: return items with _id > after_id (O(log n), preferred over offset for large sets)"),
    db: Database = Depends(get_database)
):
    """List entities with filters and pagination.

    Two pagination modes (mutually exclusive — after_id takes priority):
    - **Cursor-based** (?after_id=<last_id>): O(log n), stable under concurrent writes.
      Preferred for large collections and incremental loads.
    - **Offset-based** (?offset=N): compatible with legacy callers, degrades at high offsets.

    Supports incremental sync via ?since (updatedAt >= since).
    """
    query = {}
    if type:
        query["type"] = type
    if name:
        query["name"] = {"$regex": name, "$options": "i"}

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            query["updatedAt"] = {"$gte": since_dt}
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid since timestamp format. Use ISO 8601.")

    # count_documents is only needed for offset-based callers; skip it for cursor mode
    if after_id:
        query["_id"] = {"$gt": after_id}
        total = -1  # unknown / not computed — saves a full collection scan
        cursor = db.entities.find(query).sort("_id", 1).limit(limit)
    else:
        total = db.entities.count_documents(query)
        cursor = db.entities.find(query).sort("_id", 1).skip(offset).limit(limit)

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


@router.post("/bulk", response_model=BulkOperationResponse, status_code=200)
def bulk_upsert_entities(
    request: Request,
    payload: BulkEntityCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)
):
    """Bulk upsert entities (create or update) — max 500 per call.

    Each item is processed independently. Errors are collected per item and
    returned in the response so the caller can decide how to retry.

    **Authentication Required:** Bearer token or X-API-Key header.
    **Minimum role:** curator
    """
    caller_role = auth.get("role", "curator")
    if not has_role(caller_role, "curator"):
        raise HTTPException(status_code=403, detail="Insufficient role: curator or admin required for bulk import")
    created = 0
    updated = 0
    errors: list = []
    now = datetime.now(timezone.utc)

    for idx, entity in enumerate(payload.entities):
        try:
            existing = db.entities.find_one({"_id": entity.entity_id}, {"_id": 1, "version": 1, "data": 1})

            if existing:
                doc = entity.model_dump(exclude_unset=True)

                # Deep-merge the data field instead of replacing it
                if "data" in doc and existing.get("data"):
                    doc["data"] = {**existing["data"], **doc["data"]}

                doc["updatedAt"] = now
                doc["version"] = existing.get("version", 1) + 1
                doc.pop("createdAt", None)
                doc.pop("createdBy", None)

                db.entities.update_one({"_id": entity.entity_id}, {"$set": doc})
                updated += 1
            else:
                doc = entity.model_dump()
                doc["_id"] = entity.entity_id
                doc["createdAt"] = now
                doc["updatedAt"] = now
                doc["version"] = 1
                db.entities.insert_one(doc)
                created += 1

        except DuplicateKeyError:
            # Unique index collision (e.g. duplicate place_id) — treat as updated
            updated += 1
        except Exception as exc:
            errors.append(BulkItemError(
                index=idx,
                id=entity.entity_id,
                error=str(exc)
            ))

    return BulkOperationResponse(
        created=created,
        updated=updated,
        skipped=0,
        errors=errors,
        total_received=len(payload.entities)
    )
