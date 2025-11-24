"""
Curation endpoints - CRUD operations for curations
Professional FastAPI implementation with async MongoDB
"""

from fastapi import APIRouter, HTTPException, Header, Query, Depends
from fastapi.security import HTTPAuthorizationCredentials
from typing import Optional, List
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
import secrets
import time
import os
import numpy as np

from app.models.schemas import (
    Curation, CurationCreate, CurationUpdate, PaginatedResponse,
    SemanticSearchRequest, SemanticSearchResponse, SemanticSearchResult, ConceptMatch
)
from app.core.database import get_database
from app.core.security import verify_access_token, api_key_header, bearer_scheme, get_api_secret_key
from pymongo.database import Database
from jose import jwt, JWTError
from openai import OpenAI

router = APIRouter(prefix="/curations", tags=["curations"])


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
            from app.core.security import ALGORITHM
            payload = jwt.decode(bearer.credentials, get_api_secret_key(), algorithms=[ALGORITHM])
            return {"authenticated": True, "method": "jwt", "user": payload.get("sub")}
        except JWTError:
            pass
    
    raise HTTPException(status_code=401, detail="Missing authorization token")


@router.post("", response_model=Curation, status_code=201)
def create_curation(
    curation: CurationCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)  # Support both API key and JWT
):
    """Create a new curation
    
    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header
    """
    # Verify entity exists
    entity = db.entities.find_one({"_id": curation.entity_id})
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
        db.curations.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=500,
            detail=f"Curation {curation.curation_id} already exists"
        )
    
    # Return created curation
    result = db.curations.find_one({"_id": curation.curation_id})
    return Curation(**result)


@router.get("/search", response_model=PaginatedResponse)
def search_curations(
    entity_id: Optional[str] = Query(None),
    curator_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_database)
):
    """Search curations with filters"""
    # Build query
    query = {}
    if entity_id:
        query["entity_id"] = entity_id
    if curator_id:
        query["curator.id"] = curator_id
    
    # Get total count
    total = db.curations.count_documents(query)
    
    # Get paginated results
    cursor = db.curations.find(query).skip(offset).limit(limit)
    items = []
    for doc in cursor:
        items.append(Curation(**doc))
    
    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/entities/{entity_id}/curations", response_model=List[Curation])
def get_entity_curations(
    entity_id: str,
    db: Database = Depends(get_database)
):
    """Get all curations for an entity"""
    # Verify entity exists
    entity = db.entities.find_one({"_id": entity_id})
    if not entity:
        raise HTTPException(
            status_code=404,
            detail=f"Entity {entity_id} not found"
        )
    
    # Get curations
    cursor = db.curations.find({"entity_id": entity_id})
    curations = []
    for doc in cursor:
        curations.append(Curation(**doc))
    
    return curations


@router.get("/{curation_id}", response_model=Curation)
def get_curation(
    curation_id: str,
    db: Database = Depends(get_database)
):
    """Get curation by ID"""
    result = db.curations.find_one({"_id": curation_id})
    
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"Curation {curation_id} not found"
        )
    
    return Curation(**result)


@router.patch("/{curation_id}", response_model=Curation)
def update_curation(
    curation_id: str,
    updates: CurationUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)  # Support both API key and JWT
):
    """Update curation with optimistic locking
    
    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header
    """
    # Get current curation for version
    current = db.curations.find_one({"_id": curation_id})
    if not current:
        raise HTTPException(status_code=404, detail="Curation not found")
    
    current_version = current.get("version", 1)
    
    # If If-Match provided, validate it
    if if_match:
        try:
            requested_version = int(if_match.strip('"'))
            if requested_version != current_version:
                raise HTTPException(
                    status_code=409,
                    detail=f"Version conflict: current={current_version}, requested={requested_version}"
                )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid If-Match header format")
    
    # Prepare update
    update_data = {k: v for k, v in updates.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updatedAt"] = datetime.now(timezone.utc)
    update_data["version"] = current_version + 1
    
    # Update
    result = db.curations.find_one_and_update(
        {"_id": curation_id},
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
def delete_curation(
    curation_id: str,
    db: Database = Depends(get_database),
    token_data: dict = Depends(verify_access_token)  # Require JWT authentication
):
    """Delete curation
    
    **Authentication Required:** Include `Authorization: Bearer <token>` header
    """
    result = db.curations.delete_one({"_id": curation_id})
    
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail=f"Curation {curation_id} not found"
        )


@router.post("/semantic-search", response_model=SemanticSearchResponse)
def semantic_search_curations(
    request: SemanticSearchRequest,
    db: Database = Depends(get_database)
):
    """Semantic search for curations using concept embeddings
    
    Generates embedding for the query and finds curations with similar concepts
    using cosine similarity between vectors.
    
    **Example queries:**
    - "casual japanese food"
    - "romantic dinner with wine"
    - "outdoor seating italian restaurant"
    - "business lunch downtown"
    """
    start_time = time.time()
    
    # 1. Generate query embedding
    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    
    client = OpenAI(api_key=openai_api_key)
    
    query_embed_start = time.time()
    try:
        response = client.embeddings.create(
            input=request.query,
            model="text-embedding-3-small",
            dimensions=1536
        )
        query_vector = np.array(response.data[0].embedding)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate embedding: {str(e)}")
    
    query_embed_time = time.time() - query_embed_start
    
    # 2. Build MongoDB filter
    query_filter = {"embeddings": {"$exists": True, "$ne": []}}
    
    if request.entity_types:
        # Filter by entity type
        entities = list(db.entities.find(
            {"entity_type": {"$in": request.entity_types}},
            {"_id": 1}
        ))
        entity_ids = [e["_id"] for e in entities]
        if entity_ids:
            query_filter["entity_id"] = {"$in": entity_ids}
        else:
            # No entities of requested types
            return SemanticSearchResponse(
                results=[],
                query=request.query,
                query_embedding_time=round(query_embed_time, 3),
                search_time=0.0,
                total_results=0
            )
    
    # 3. Fetch curations with embeddings
    curations = list(db.curations.find(query_filter))
    
    # 4. Calculate similarities for each curation
    results = []
    
    for curation in curations:
        embeddings = curation.get("embeddings", [])
        if not embeddings:
            continue
        
        matches = []
        
        for emb in embeddings:
            # Filter by category if specified
            if request.categories and emb.get("category") not in request.categories:
                continue
            
            # Calculate cosine similarity
            try:
                concept_vector = np.array(emb["vector"])
                similarity = float(
                    np.dot(query_vector, concept_vector) / 
                    (np.linalg.norm(query_vector) * np.linalg.norm(concept_vector))
                )
            except Exception:
                continue
            
            # Filter by threshold
            if similarity >= request.min_similarity:
                matches.append(ConceptMatch(
                    text=emb.get("text", ""),
                    category=emb.get("category", ""),
                    concept=emb.get("concept", ""),
                    similarity=round(similarity, 4)
                ))
        
        if not matches:
            continue
        
        # Sort matches by similarity (descending)
        matches.sort(key=lambda x: x.similarity, reverse=True)
        
        # Calculate aggregate scores
        similarities = [m.similarity for m in matches]
        avg_similarity = sum(similarities) / len(similarities)
        max_similarity = max(similarities)
        
        # Build result
        result_data = {
            "entity_id": curation["entity_id"],
            "curation": {
                "curation_id": curation.get("curation_id", curation["_id"]),
                "categories": curation.get("categories", {}),
                "curator": curation.get("curator", {}),
                "notes": curation.get("notes", {})
            },
            "matches": [m.model_dump() for m in matches[:10]],  # Top 10 matches
            "avg_similarity": round(avg_similarity, 4),
            "max_similarity": round(max_similarity, 4),
            "match_count": len(matches)
        }
        
        # Include entity data if requested
        if request.include_entity:
            entity = db.entities.find_one({"_id": curation["entity_id"]})
            if entity:
                result_data["entity"] = {
                    "name": entity.get("name"),
                    "entity_type": entity.get("entity_type"),
                    "location": entity.get("location"),
                    "contact": entity.get("contact")
                }
        
        results.append(result_data)
    
    # 5. Sort by max_similarity (best match first)
    results.sort(key=lambda x: x["max_similarity"], reverse=True)
    
    # 6. Limit results
    results = results[:request.limit]
    
    # 7. Calculate total time
    total_time = time.time() - start_time
    search_time = total_time - query_embed_time
    
    return SemanticSearchResponse(
        results=[SemanticSearchResult(**r) for r in results],
        query=request.query,
        query_embedding_time=round(query_embed_time, 3),
        search_time=round(search_time, 3),
        total_results=len(results)
    )
    
    return None
