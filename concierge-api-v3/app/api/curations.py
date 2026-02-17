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


def _resolve_embedding_runtime(db: Database) -> tuple[str, int]:
    """Resolve embedding model and dimensions from env, falling back to stored embeddings metadata."""
    env_model = os.getenv("EMBEDDING_MODEL")
    env_dimensions = os.getenv("EMBEDDING_DIMENSIONS")

    model = env_model.strip() if env_model else None
    dimensions: Optional[int] = None

    if env_dimensions:
        try:
            dimensions = int(env_dimensions)
        except ValueError:
            dimensions = None

    sample = db.embeddings.find_one({}, {"model": 1, "dimensions": 1})
    if sample:
        if not model and sample.get("model"):
            model = str(sample.get("model"))
        if dimensions is None and sample.get("dimensions"):
            try:
                dimensions = int(sample.get("dimensions"))
            except (TypeError, ValueError):
                dimensions = None

    if not model:
        model = "text-embedding-3-small"
    if not dimensions or dimensions <= 0:
        dimensions = 1536

    return model, dimensions


def _build_openai_client() -> OpenAI:
    """Build OpenAI client with optional custom base URL."""
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    client_kwargs = {"api_key": openai_api_key}
    openai_base_url = os.getenv("OPENAI_BASE_URL")
    if openai_base_url:
        client_kwargs["base_url"] = openai_base_url

    return OpenAI(**client_kwargs)


def _fetch_curations_by_ids(db: Database, curation_ids: List[str]) -> Dict[str, dict]:
    """Fetch curations by internal _id or curation_id and map by both keys."""
    if not curation_ids:
        return {}

    curations = list(
        db.curations.find(
            {
                "$or": [
                    {"_id": {"$in": curation_ids}},
                    {"curation_id": {"$in": curation_ids}},
                ]
            }
        )
    )

    mapping: Dict[str, dict] = {}
    for curation in curations:
        if curation.get("_id"):
            mapping[str(curation["_id"])] = curation
        if curation.get("curation_id"):
            mapping[str(curation["curation_id"])] = curation
    return mapping


def _load_semantic_matches(
    db: Database,
    query_vector: np.ndarray,
    model: str,
    dimensions: int,
    min_similarity: float,
    categories: Optional[List[str]],
    require_entity: bool,
) -> Dict[str, dict]:
    """Load semantic matches grouped by curation using deduplicated embedding collections."""
    link_query: Dict[str, object] = {"model": model, "dimensions": dimensions}
    if categories:
        link_query["category"] = {"$in": categories}
    if require_entity:
        link_query["entity_id"] = {"$exists": True, "$ne": None}

    links = list(
        db.embedding_links.find(
            link_query,
            {
                "_id": 0,
                "curation_id": 1,
                "entity_id": 1,
                "concept_key": 1,
                "category": 1,
                "concept": 1,
            },
        )
    )

    if not links:
        return {}

    concept_keys = sorted({link.get("concept_key") for link in links if link.get("concept_key")})
    if not concept_keys:
        return {}

    embeddings_docs = list(
        db.embeddings.find(
            {"concept_key": {"$in": concept_keys}, "model": model, "dimensions": dimensions},
            {"_id": 0, "concept_key": 1, "vector": 1},
        )
    )

    vectors_by_key: Dict[str, np.ndarray] = {}
    for embedding_doc in embeddings_docs:
        concept_key = embedding_doc.get("concept_key")
        vector_values = embedding_doc.get("vector")
        if not concept_key or not isinstance(vector_values, list) or not vector_values:
            continue
        vectors_by_key[str(concept_key)] = np.array(vector_values)

    if not vectors_by_key:
        return {}

    query_norm = np.linalg.norm(query_vector)
    if query_norm == 0:
        return {}

    grouped: Dict[str, dict] = {}
    for link in links:
        curation_id = link.get("curation_id")
        concept_key = link.get("concept_key")
        if not curation_id or not concept_key:
            continue

        concept_vector = vectors_by_key.get(str(concept_key))
        if concept_vector is None:
            continue

        denominator = query_norm * np.linalg.norm(concept_vector)
        if denominator == 0:
            continue

        similarity = float(np.dot(query_vector, concept_vector) / denominator)
        if similarity < min_similarity:
            continue

        curation_id = str(curation_id)
        aggregate = grouped.setdefault(
            curation_id,
            {
                "entity_id": link.get("entity_id"),
                "matches": [],
                "similarities": [],
            },
        )

        if not aggregate.get("entity_id") and link.get("entity_id"):
            aggregate["entity_id"] = link.get("entity_id")

        category = str(link.get("category") or "")
        concept = str(link.get("concept") or "")

        aggregate["similarities"].append(similarity)
        aggregate["matches"].append(
            ConceptMatch(
                text=f"{category} {concept}".strip(),
                category=category,
                concept=concept,
                similarity=round(similarity, 4),
            )
        )

    results: Dict[str, dict] = {}
    for curation_id, aggregate in grouped.items():
        matches: List[ConceptMatch] = aggregate["matches"]
        if not matches:
            continue

        matches.sort(key=lambda match: match.similarity, reverse=True)
        similarities = aggregate["similarities"]
        results[curation_id] = {
            "entity_id": aggregate.get("entity_id"),
            "matches": matches,
            "avg_similarity": round(sum(similarities) / len(similarities), 4),
            "max_similarity": round(max(similarities), 4),
            "match_count": len(matches),
        }

    return results


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
    
    model, dimensions = _resolve_embedding_runtime(db)
    client = _build_openai_client()
    
    query_embed_start = time.time()
    try:
        response = client.embeddings.create(
            input=request.query,
            model=model,
            dimensions=dimensions
        )
        query_vector = np.array(response.data[0].embedding)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate embedding: {str(e)}")
    
    query_embed_time = time.time() - query_embed_start
    
    semantic_by_curation = _load_semantic_matches(
        db=db,
        query_vector=query_vector,
        model=model,
        dimensions=dimensions,
        min_similarity=request.min_similarity,
        categories=request.categories,
        require_entity=False,
    )

    curation_map = _fetch_curations_by_ids(db, list(semantic_by_curation.keys()))

    results = []

    for curation_id, semantic_data in semantic_by_curation.items():
        curation = curation_map.get(curation_id)
        if not curation:
            continue

        matches = semantic_data["matches"]
        if not matches:
            continue

        entity = None
        if curation.get("entity_id"):
            entity = db.entities.find_one({"_id": curation["entity_id"]})

        if request.entity_types:
            if not entity or entity.get("entity_type") not in request.entity_types:
                continue

        result_data = {
            "entity_id": curation["entity_id"],
            "curation": {
                "curation_id": curation.get("curation_id", curation["_id"]),
                "categories": curation.get("categories", {}),
                "curator": curation.get("curator", {}),
                "notes": curation.get("notes", {})
            },
            "matches": [m.model_dump() for m in matches[:10]],  # Top 10 matches
            "avg_similarity": semantic_data["avg_similarity"],
            "max_similarity": semantic_data["max_similarity"],
            "match_count": semantic_data["match_count"],
        }

        if request.include_entity and curation.get("entity_id"):
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
    
    model, dimensions = _resolve_embedding_runtime(db)
    client = _build_openai_client()
    
    try:
        response = client.embeddings.create(
            input=request.query,
            model=model,
            dimensions=dimensions
        )
        query_vector = np.array(response.data[0].embedding)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate embedding: {str(e)}")

    semantic_by_curation = _load_semantic_matches(
        db=db,
        query_vector=query_vector,
        model=model,
        dimensions=dimensions,
        min_similarity=request.min_similarity,
        categories=request.categories,
        require_entity=True,
    )

    curation_map = _fetch_curations_by_ids(db, list(semantic_by_curation.keys()))

    for curation_id, semantic_data in semantic_by_curation.items():
        curation = curation_map.get(curation_id)
        if not curation:
            continue

        entity_id = semantic_data.get("entity_id") or curation.get("entity_id")
        if not entity_id:
            continue

        current = semantic_results.get(entity_id)
        if not current or semantic_data["max_similarity"] > current["semantic_score"]:
            semantic_results[entity_id] = {
                "curation": curation,
                "semantic_score": semantic_data["max_similarity"],
                "matches": semantic_data["matches"][:10],
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
