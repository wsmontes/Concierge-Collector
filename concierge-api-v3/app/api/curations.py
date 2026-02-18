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
    Curation, CurationCreate, CurationUpdate, PaginatedResponse, CurationStatus,
    SemanticSearchRequest, SemanticSearchResponse, SemanticSearchResult, ConceptMatch,
    HybridSearchRequest, HybridSearchResponse, HybridSearchResult
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
    # Verify entity exists (skip for orphaned curations)
    if curation.entity_id:
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
    doc["createdBy"] = curation.createdBy or curation.curator_id
    doc["updatedBy"] = curation.curator_id
    
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
    status: Optional[CurationStatus] = Query(None),
    include_deleted: bool = Query(False),
    since: Optional[str] = Query(None, description="ISO timestamp - only return curations updated after this time"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Database = Depends(get_database)
):
    """Search curations with filters
    
    Supports incremental sync via ?since parameter:
    - If since is provided, only returns curations with updatedAt >= since
    - Reduces bandwidth for large collections
    """
    # Build query
    query = {}
    if entity_id:
        query["entity_id"] = entity_id
    if curator_id:
        query["curator.id"] = curator_id
    
    # ✅ INCREMENTAL SYNC: Filter by updatedAt >= since
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            query["updatedAt"] = {"$gte": since_dt}
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid since timestamp format. Use ISO 8601.")
    
    # ✅ STATUS FILTERING
    if status:
        query["status"] = status
    elif not include_deleted:
        # Default: exclude deleted items
        query["status"] = {"$ne": "deleted"}
    
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
    
    # Get curations (exclude deleted by default)
    cursor = db.curations.find({
        "entity_id": entity_id,
        "status": {"$ne": "deleted"}
    })
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

    # Keep curator fields consistent regardless of which one is provided
    if "curator" in update_data and "curator_id" not in update_data:
        curator_obj = update_data.get("curator") or {}
        if isinstance(curator_obj, dict) and curator_obj.get("id"):
            update_data["curator_id"] = curator_obj.get("id")

    if "curator_id" in update_data and "curator" not in update_data:
        current_curator = current.get("curator") or {}
        update_data["curator"] = {
            "id": update_data.get("curator_id"),
            "name": current_curator.get("name") or "Unknown",
            "email": current_curator.get("email")
        }

    # Preserve original creator forever (backfill once for legacy records)
    if current.get("createdBy"):
        update_data["createdBy"] = current.get("createdBy")
    else:
        update_data["createdBy"] = current.get("curator_id") or (current.get("curator") or {}).get("id")

    # Last writer becomes the last updater
    update_data["updatedBy"] = (
        update_data.get("curator_id")
        or (update_data.get("curator") or {}).get("id")
        or auth.get("user")
        or current.get("updatedBy")
    )

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
    auth: dict = Depends(verify_auth)  # Support both API key and JWT
):
    """Delete curation (Soft Delete)
    
    Marks the curation as 'deleted' instead of removing from DB.
    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header
    """
    result = db.curations.update_one(
        {"_id": curation_id},
        {
            "$set": {
                "status": "deleted",
                "updatedAt": datetime.now(timezone.utc),
                "updatedBy": auth.get("user")
            },
            "$inc": {"version": 1}
        }
    )
    
    if result.matched_count == 0:
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
        query_vector = np.asarray(response.data[0].embedding, dtype=np.float32)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate embedding: {str(e)}")

    query_norm = float(np.linalg.norm(query_vector))
    if query_norm == 0.0:
        raise HTTPException(status_code=500, detail="Failed to generate valid query embedding")
    
    query_embed_time = time.time() - query_embed_start
    
    # 2. Fetch all curations with embeddings (only restaurants for now)
    query_filter = {"embeddings": {"$exists": True, "$ne": []}}
    projection = {
        "entity_id": 1,
        "curation_id": 1,
        "categories": 1,
        "curator": 1,
        "notes": 1,
        "embeddings": 1,
    }
    curations = list(db.curations.find(query_filter, projection))
    
    # 3. Calculate similarities for each curation
    results = []
    
    allowed_categories = set(request.categories) if request.categories else None

    for curation in curations:
        embeddings = curation.get("embeddings", [])
        if not embeddings:
            continue
        
        matches = []
        similarity_sum = 0.0
        max_similarity = 0.0
        match_count = 0
        
        for emb in embeddings:
            # Filter by category if specified
            if allowed_categories and emb.get("category") not in allowed_categories:
                continue
            
            # Calculate cosine similarity
            try:
                concept_vector = np.asarray(emb["vector"], dtype=np.float32)
                concept_norm = float(np.linalg.norm(concept_vector))
                if concept_norm == 0.0:
                    continue
                similarity = float(
                    np.dot(query_vector, concept_vector) / 
                    (query_norm * concept_norm)
                )
            except Exception:
                continue
            
            # Filter by threshold
            if similarity >= request.min_similarity:
                rounded_similarity = round(similarity, 4)
                matches.append({
                    "text": emb.get("text", ""),
                    "category": emb.get("category", ""),
                    "concept": emb.get("concept", ""),
                    "similarity": rounded_similarity,
                })
                similarity_sum += rounded_similarity
                match_count += 1
                if rounded_similarity > max_similarity:
                    max_similarity = rounded_similarity
        
        if not matches:
            continue
        
        # Sort matches by similarity (descending)
        matches.sort(key=lambda x: x["similarity"], reverse=True)
        avg_similarity = similarity_sum / match_count
        
        entity_id = curation.get("entity_id")
        if entity_id is None:
            continue

        # Build result
        result_data = {
            "entity_id": entity_id,
            "curation": {
                "curation_id": curation.get("curation_id", curation["_id"]),
                "categories": curation.get("categories", {}),
                "curator": curation.get("curator", {}),
                "notes": curation.get("notes", {})
            },
            "matches": matches[:10],  # Top 10 matches
            "avg_similarity": round(avg_similarity, 4),
            "max_similarity": round(max_similarity, 4),
            "match_count": match_count
        }
        
        results.append(result_data)
    
    # 5. Sort by max_similarity (best match first)
    results.sort(key=lambda x: x["max_similarity"], reverse=True)
    
    # 6. Limit results
    results = results[:request.limit]

    if request.include_entity and results:
        entity_ids = [result["entity_id"] for result in results]
        entity_projection = {
            "name": 1,
            "entity_type": 1,
            "location": 1,
            "contact": 1,
        }
        entities = list(db.entities.find({"_id": {"$in": entity_ids}}, entity_projection))
        entities_by_id = {
            entity["_id"]: {
                "name": entity.get("name"),
                "entity_type": entity.get("entity_type"),
                "location": entity.get("location"),
                "contact": entity.get("contact"),
            }
            for entity in entities
        }
        for result in results:
            entity_data = entities_by_id.get(result["entity_id"])
            if entity_data:
                result["entity"] = entity_data
    
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


@router.post("/hybrid-search", response_model=HybridSearchResponse)
def hybrid_search(
    request: HybridSearchRequest,
    db: Database = Depends(get_database)
):
    """Busca híbrida: combina busca tradicional de entities + busca semântica de curations
    
    Executa ambas as buscas EM PARALELO e combina os resultados de forma inteligente:
    - Entities que batem por nome/localização recebem entity_score
    - Curations que batem semanticamente recebem semantic_score
    - Score final = (1 - boost_semantic) * entity_score + boost_semantic * semantic_score
    
    **Example queries:**
    - "restaurante japonês em jardins"
    - "jantar romântico com vinho"
    - "casual lunch near paulista"
    """
    start_time = time.time()
    
    # ========== 1. BUSCA TRADICIONAL DE ENTITIES (rápida) ==========
    entity_search_start = time.time()
    entity_results = {}
    
    entity_filter = {}
    
    # Text search no nome
    if request.query:
        entity_filter["$text"] = {"$search": request.query}
    
    # Location filter
    if request.location:
        entity_filter["$or"] = [
            {"location.city": {"$regex": request.location, "$options": "i"}},
            {"location.neighborhood": {"$regex": request.location, "$options": "i"}},
            {"location.address": {"$regex": request.location, "$options": "i"}}
        ]
    
    # Se tiver filtros, busca entities
    if entity_filter:
        entities = list(db.entities.find(entity_filter).limit(50))
        for entity in entities:
            entity_id = entity["_id"]
            # Score baseado em text score (se disponível) ou 0.5 default
            entity_score = entity.get("score", 0.5)
            entity_results[entity_id] = {
                "entity": entity,
                "entity_score": entity_score
            }
    
    entity_search_time = time.time() - entity_search_start
    
    # ========== 2. BUSCA SEMÂNTICA DE CURATIONS (paralela) ==========
    semantic_search_start = time.time()
    semantic_results = {}
    
    # Generate query embedding
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    
    client = OpenAI(api_key=openai_api_key)
    
    try:
        response = client.embeddings.create(
            input=request.query,
            model="text-embedding-3-small",
            dimensions=1536
        )
        query_vector = np.array(response.data[0].embedding)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate embedding: {str(e)}")
    
    # Fetch all curations with embeddings (skip orphaned curations without entity_id)
    curations = list(db.curations.find({
        "embeddings": {"$exists": True, "$ne": []},
        "entity_id": {"$ne": None, "$exists": True}
    }))
    
    for curation in curations:
        entity_id = curation["entity_id"]
        embeddings = curation.get("embeddings", [])
        
        if not embeddings:
            continue
        
        matches = []
        similarities = []
        
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
            
            if similarity >= request.min_similarity:
                similarities.append(similarity)
                matches.append(ConceptMatch(
                    text=emb.get("text", ""),
                    category=emb.get("category", ""),
                    concept=emb.get("concept", ""),
                    similarity=similarity
                ))
        
        if matches:
            # Sort matches by similarity
            matches.sort(key=lambda x: x.similarity, reverse=True)
            
            # Use max similarity as semantic score
            semantic_score = max(similarities)
            
            semantic_results[entity_id] = {
                "curation": curation,
                "semantic_score": semantic_score,
                "matches": matches[:10]  # Top 10 matches
            }
    
    semantic_search_time = time.time() - semantic_search_start
    
    # ========== 3. COMBINAR RESULTADOS ==========
    combined = {}
    all_entity_ids = set(entity_results.keys()) | set(semantic_results.keys())
    
    for entity_id in all_entity_ids:
        entity_data = entity_results.get(entity_id, {})
        semantic_data = semantic_results.get(entity_id, {})
        
        entity_score = entity_data.get("entity_score", 0.0)
        semantic_score = semantic_data.get("semantic_score", 0.0)
        
        # Determine match type
        if entity_score > 0 and semantic_score > 0:
            match_type = "hybrid"
        elif semantic_score > 0:
            match_type = "semantic"
        else:
            match_type = "entity"
        
        # Combined score: weighted average
        # boost_semantic controla o peso da busca semântica
        combined_score = (
            (1 - request.boost_semantic) * entity_score + 
            request.boost_semantic * semantic_score
        )
        
        # Get entity data (from entity search or from curation's entity_id)
        entity = entity_data.get("entity")
        if not entity and entity_id:
            entity = db.entities.find_one({"_id": entity_id})
        
        if not entity:
            continue
        
        combined[entity_id] = {
            "entity_id": entity_id,
            "entity": {
                "name": entity.get("name"),
                "entity_type": entity.get("entity_type"),
                "location": entity.get("location"),
                "contact": entity.get("contact")
            },
            "curation": semantic_data.get("curation"),
            "score": combined_score,
            "match_type": match_type,
            "entity_score": entity_score,
            "semantic_score": semantic_score,
            "semantic_matches": semantic_data.get("matches")
        }
    
    # ========== 4. RANKEAR E LIMITAR ==========
    results = list(combined.values())
    results.sort(key=lambda x: x["score"], reverse=True)
    results = results[:request.limit]
    
    total_time = time.time() - start_time
    
    return HybridSearchResponse(
        results=[HybridSearchResult(**r) for r in results],
        query=request.query,
        entity_search_time=round(entity_search_time, 3),
        semantic_search_time=round(semantic_search_time, 3),
        total_time=round(total_time, 3),
        total_results=len(results)
    )
