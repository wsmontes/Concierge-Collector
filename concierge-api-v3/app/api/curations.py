"""
Curation endpoints - CRUD operations for curations
Professional FastAPI implementation with async MongoDB
"""

from fastapi import APIRouter, HTTPException, Header, Query, Depends, Request, status
from typing import Optional, List
import re
import logging
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
import time
import os
import numpy as np

from app.models.schemas import (
    Curation, CurationCreate, CurationUpdate, PaginatedResponse, CurationStatus,
    SemanticSearchRequest, SemanticSearchResponse, SemanticSearchResult, ConceptMatch,
    HybridSearchRequest, HybridSearchResponse, HybridSearchResult,
    BulkCurationCreate, BulkOperationResponse, BulkItemError
)
from app.core.database import get_database
from bson import ObjectId

from app.core.query_utils import resolve_after_id
from app.core.security import verify_access_token, verify_auth
from app.models.user import has_role
from app.services.curation_denorm import denormalize_curation_location
from app.api.entities import find_entity
from app.core.vector_packing import DEFAULT_EMBEDDING_DIMENSIONS, try_pack_vector
from pymongo.database import Database
from openai import OpenAI

logger = logging.getLogger(__name__)


def _vector_to_array(vector) -> "np.ndarray":
    """Converte vetor de embedding para array numpy — aceita lista (doubles,
    formato antigo) ou Binary float32 (formato compactado, ~metade do espaço).
    '<f4' é EXPLÍCITO: o formato gravado é little-endian e o dtype nativo
    trocaria os bytes em host big-endian (similaridade viraria lixo)."""
    if isinstance(vector, bytes):
        return np.frombuffer(vector, dtype="<f4")
    return np.asarray(vector, dtype=np.float32)


def _compact_embeddings_for_storage(embeddings):
    """Compacta 'vector' de cada entrada para Binary float32 (~6KB/1536d vs
    ~20KB do array de doubles no BSON). Fronteira de escrita: todo vetor que
    entra no Mongo via API passa por aqui — o formato de lista estourou a cota
    do Atlas em 2026-08-12. Usa try_pack_vector (política única, em
    app/core/vector_packing.py). Entrada com vetor ausente/vazio/malformado/
    dimensão errada é REMOVIDA por inteiro — nunca re-entra no formato caro
    nem vira Binary de lixo, e a curadoria volta a ser selecionável pelo
    backfill ($or: embeddings ausente ou [])."""
    if not isinstance(embeddings, list):
        return embeddings
    out = []
    dropped = False
    for emb in embeddings:
        if not isinstance(emb, dict) or "vector" not in emb:
            out.append(emb)
            continue
        vector = emb["vector"]
        if isinstance(vector, bytes):
            out.append(emb)
            continue
        packed = try_pack_vector(vector, expected_dim=DEFAULT_EMBEDDING_DIMENSIONS)
        if packed is None:
            logger.warning(
                "entrada de embeddings REMOVIDA: vetor mantido sem compactar "
                "(ausente/vazio/malformado/dimensão errada): %r",
                emb.get("text"),
            )
            dropped = True
            continue
        out.append({**emb, "vector": packed})
    # qualquer entrada dropada → array inteiro vazio: o filtro do backfill
    # ($or: embeddings ausente ou []) re-seleciona a curadoria — um array
    # parcialmente válido deixaria os textos dropados perdidos para sempre
    return [] if dropped else out


def _vector_search_or_fallback(db, projection, query_vector, candidate_limit, fallback_filter):
    """Tenta o $vectorSearch (índice Atlas) e cai para a varredura bounded por
    recência. RECALL conhecido: o Atlas não indexa o Binary subtype 0 do
    formato compactado, então sem o índice vector só as candidate_limit
    curadorias com embeddings MAIS RECENTES são pontuadas em Python —
    curadorias antigas ficam fora dos candidatos enquanto o índice não for
    recriado no Atlas. Falha do $vectorSearch é logada, nunca silenciosa."""
    vector_index_name = os.getenv("MONGODB_CURATIONS_VECTOR_INDEX", "").strip()
    if vector_index_name:
        try:
            vector_pipeline = [
                {
                    "$vectorSearch": {
                        "index": vector_index_name,
                        "path": "embeddings.vector",
                        "queryVector": query_vector.tolist(),
                        "numCandidates": min(max(candidate_limit * 5, 400), 5000),
                        "limit": candidate_limit,
                    }
                },
                {"$project": projection},
            ]
            resultados = list(db.curations.aggregate(vector_pipeline))
            if resultados:
                return resultados
        except Exception as e:
            logger.warning(
                f"$vectorSearch falhou (índice '{vector_index_name}' indisponível "
                f"ou vetores em formato não indexável — Binary float32): {e}. "
                "Usando fallback por varredura + score em Python."
            )
    return list(
        db.curations.find(fallback_filter, projection)
        .sort("updatedAt", -1)
        .limit(candidate_limit)
    )


router = APIRouter(prefix="/curations", tags=["curations"])


CURATION_RESPONSE_PROJECTION = {
    "embeddings": 0,
    "embeddings_metadata": 0,
}


def _clean_created_by(curation, doc):
    """createdBy sem o placeholder 'unknown' (case-insensitive) — cai para o
    curator_id normalizado; sem nada, None."""
    raw = curation.createdBy
    if raw and str(raw).lower() != "unknown":
        return raw
    cur_id = doc.get("curator_id")
    if cur_id and str(cur_id).lower() != "unknown":
        return cur_id
    return None


def _normalize_curator_id(doc):
    """Regra ÚNICA server-side: curator.id é autoritativo e o placeholder
    'unknown' (sync sem usuário) nunca persiste sobre um valor real."""
    curator = doc.get("curator") or {}
    cur_id = doc.get("curator_id")
    if (not cur_id or str(cur_id).lower() == "unknown") and curator.get("id"):
        doc["curator_id"] = curator["id"]
    return doc


def find_curation(db, curation_id, projection=None):
    """Resolução DETERMINÍSTICA por probes sequenciais: _id string exato →
    _id ObjectId → campo curation_id. O $or do Mongo NÃO garante ordem entre
    branches — twins resolviam por plano de query, não por prioridade.
    projection evita transferir embeddings inteiros (~6KB/vetor) em buscas
    de existência."""
    doc = db.curations.find_one({"_id": curation_id}, projection)
    if doc:
        return doc
    if ObjectId.is_valid(curation_id):
        doc = db.curations.find_one({"_id": ObjectId(curation_id)}, projection)
        if doc:
            return doc
    return db.curations.find_one({"curation_id": curation_id}, projection)


def build_curation_response_payload(curation_doc: dict) -> dict:
    """Build lightweight curation payload without embeddings."""
    if not curation_doc:
        return {}

    raw_id = curation_doc.get("curation_id", curation_doc.get("_id"))
    return {
        "curation_id": str(raw_id) if raw_id is not None else None,
        "categories": curation_doc.get("categories", {}),
        "curator": curation_doc.get("curator", {}),
        "notes": curation_doc.get("notes", {}),
        "status": curation_doc.get("status"),
        "restaurant_name": curation_doc.get("restaurant_name"),
    }


@router.post("", response_model=Curation, status_code=201)
def create_curation(
    curation: CurationCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)  # Support both API key and JWT
):
    """Create a new curation
    
    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header
    """
    # Verify entity exists (skip for orphaned curations) — find_entity
    # resolve ObjectId/string/slug (os 471 ObjectId não-linkáveis)
    if curation.entity_id:
        entity = find_entity(db, curation.entity_id)
        if not entity:
            raise HTTPException(
                status_code=404,
                detail=f"Entity {curation.entity_id} not found"
            )
    
    # Prepare document
    doc = curation.model_dump()
    if curation.entity_id and entity:
        doc.update(denormalize_curation_location(entity))
    doc["_id"] = curation.curation_id
    doc["createdAt"] = datetime.now(timezone.utc)
    doc["updatedAt"] = datetime.now(timezone.utc)
    doc["version"] = 1
    _normalize_curator_id(doc)
    doc["createdBy"] = _clean_created_by(curation, doc)
    doc["updatedBy"] = doc.get("curator_id")

    # Twin guard: um doc ObjectId com o mesmo id pode existir (índice único
    # é type-aware) — insert às cegas criaria um duplicado silencioso
    if find_curation(db, curation.curation_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Curation {curation.curation_id} already exists"
        )
    # Insert
    try:
        db.curations.insert_one(doc)
    except DuplicateKeyError:
        # twin criado por corrida entre o guard e o insert: re-checa e
        # devolve 409 consistente (o índice unique é type-aware)
        if find_curation(db, curation.curation_id, projection={"_id": 1}):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Curation {curation.curation_id} already exists"
            )
        raise
    
    # Return created curation
    result = db.curations.find_one({"_id": curation.curation_id}, CURATION_RESPONSE_PROJECTION)
    return Curation(**result)


@router.get("/search", response_model=PaginatedResponse)
def search_curations(
    entity_id: Optional[str] = Query(None),
    curator_id: Optional[str] = Query(None),
    status: Optional[CurationStatus] = Query(None),
    include_deleted: bool = Query(False),
    since: Optional[str] = Query(None, description="ISO timestamp - only return curations updated after this time"),
    city: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Busca por texto em restaurant_name"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    after_id: Optional[str] = Query(None, description="Cursor-based pagination: return items with _id > after_id (O(log n), preferred over offset for large sets)"),
    db: Database = Depends(get_database)
):
    """Search curations with filters.

    Two pagination modes (mutually exclusive — after_id takes priority):
    - **Cursor-based** (?after_id=<last_id>): O(log n), preferred for large collections.
    - **Offset-based** (?offset=N): legacy compatible, degrades at high offsets.

    Supports incremental sync via ?since (updatedAt >= since).
    """
    query = {}
    if entity_id:
        query["entity_id"] = entity_id
    if curator_id:
        query["curator.id"] = curator_id
    if city:
        query["city"] = city
    if type:
        query["type"] = type
    if q:
        sanitized = q.strip()[:200]
        if sanitized:
            escaped = re.escape(sanitized)
            query["$or"] = [
                {"restaurant_name": {"$regex": escaped, "$options": "i"}},
                {"notes.public": {"$regex": escaped, "$options": "i"}},
                {"curator.name": {"$regex": escaped, "$options": "i"}},
            ]

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace('Z', '+00:00'))
            query["updatedAt"] = {"$gte": since_dt}
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid since timestamp format. Use ISO 8601.")

    if status:
        query["status"] = status
    elif not include_deleted:
        query["status"] = {"$ne": "deleted"}

    if after_id:
        # Cursor por _id com TRANSIÇÃO DE SEGMENTO (mesmo hazard de entities:
        # $gt contra string não alcança _ids ObjectId — página vazia no fim
        # das strings entra no segmento ObjectId)
        query["_id"] = {"$gt": resolve_after_id(db, "curations", after_id)}
        total = -1  # not computed in cursor mode
        docs = list(db.curations.find(query, CURATION_RESPONSE_PROJECTION).sort("_id", 1).limit(limit))
        if not docs and isinstance(query["_id"]["$gt"], str):
            transition = dict(query)
            transition["_id"] = {"$gt": ObjectId("0" * 24)}
            docs = list(db.curations.find(transition, CURATION_RESPONSE_PROJECTION).sort("_id", 1).limit(limit))
        items = []
        for doc in docs:
            if doc.get("_id") is None:
                logger.warning("curadoria sem _id pulada na listagem (cursor)")
                continue
            items.append(Curation(**doc))
        return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)

    total = db.curations.count_documents(query)
    cursor = db.curations.find(query, CURATION_RESPONSE_PROJECTION).sort("_id", 1).skip(offset).limit(limit)

    items = []
    for doc in cursor:
        if doc.get("_id") is None:
            logger.warning("curadoria sem _id pulada na listagem")
            continue
        items.append(Curation(**doc))

    return PaginatedResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset
    )


@router.get("/cities")
def list_cities(db: Database = Depends(get_database)):
    """Retorna lista distinta de cidades para o dropdown de filtro.
    Usa MongoDB distinct() com índice implícito — O(1) na prática."""
    cities = db.curations.distinct("city")
    return sorted([c for c in cities if c])


@router.get("/entities/{entity_id}/curations", response_model=List[Curation])
def get_entity_curations(
    entity_id: str,
    db: Database = Depends(get_database)
):
    """Get all curations for an entity"""
    # Verify entity exists
    entity = find_entity(db, entity_id)
    if not entity:
        raise HTTPException(
            status_code=404,
            detail=f"Entity {entity_id} not found"
        )
    
    # Get curations (exclude deleted by default)
    projection = CURATION_RESPONSE_PROJECTION

    cursor = db.curations.find({
        "entity_id": entity_id,
        "status": {"$ne": "deleted"}
    }, projection).limit(200)
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
    result = find_curation(db, curation_id, projection=CURATION_RESPONSE_PROJECTION)

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
    # Get current curation for version — resolução DETERMINÍSTICA: o $or
    # poderia ler a versão de UM twin e escrever no OUTRO (dois contadores
    # de versão independentes ping-pongando 409)
    current = find_curation(db, curation_id, projection=CURATION_RESPONSE_PROJECTION)
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

    # Denormalize city/type if entity_id is changing
    if "entity_id" in update_data and update_data["entity_id"]:
        entity = find_entity(db, update_data["entity_id"])
        if entity:
            entity = {k: entity.get(k) for k in ("type", "data")}
        if entity:
            update_data.update(denormalize_curation_location(entity))

    update_data["updatedAt"] = datetime.now(timezone.utc)
    update_data["version"] = current_version + 1

    # Fronteira de escrita: vetores entram no Mongo compactados (Binary float32)
    if "embeddings" in update_data:
        update_data["embeddings"] = _compact_embeddings_for_storage(update_data["embeddings"])
    
    # Update — escreve no _id ESPECÍFICO do doc que a versão leu (nunca no
    # twin por decisão do planner). O filtro de version é CONDICIONAL: doc
    # sem campo version (legado/restore) nunca casaria com {"version": 1}
    # no equality match — para esses, o PATCH segue sem optimistic lock.
    write_filter = {"_id": current["_id"]}
    if "version" in current:
        write_filter["version"] = current_version
    result = db.curations.find_one_and_update(
        write_filter,
        {"$set": update_data},
        projection=CURATION_RESPONSE_PROJECTION,
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
    alvo = find_curation(db, curation_id, projection={"_id": 1})
    if not alvo:
        raise HTTPException(status_code=404, detail=f"Curation {curation_id} not found")
    result = db.curations.update_one(
        {"_id": alvo["_id"]},
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
    
    # 2. Fetch candidate curations with embeddings
    # Prefer MongoDB native vector search when an index is configured, fallback to full scan.
    projection = {
        "entity_id": 1,
        "curation_id": 1,
        "categories": 1,
        "curator": 1,
        "notes": 1,
        "embeddings": 1,
    }

    candidate_limit = min(max(request.limit * 20, 200), 2000)
    curations = _vector_search_or_fallback(
        db, projection, query_vector, candidate_limit,
        {"embeddings": {"$exists": True, "$ne": []}},
    )

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
                concept_vector = _vector_to_array(emb["vector"])
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
            "curation": build_curation_response_payload(curation),
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
        escaped_location = re.escape(request.location)
        entity_filter["$or"] = [
            {"location.city": {"$regex": escaped_location, "$options": "i"}},
            {"location.neighborhood": {"$regex": escaped_location, "$options": "i"}},
            {"location.address": {"$regex": escaped_location, "$options": "i"}}
        ]
    
    # Se tiver filtros, busca entities
    if entity_filter:
        entities = list(db.entities.find(entity_filter).limit(50))
        for entity in entities:
            entity_id = entity.get("_id")
            if entity_id is None:
                continue
            entity_key = str(entity_id)
            # Score baseado em text score (se disponível) ou 0.5 default
            entity_score = entity.get("score", 0.5)
            entity_results[entity_key] = {
                "entity": entity,
                "entity_score": entity_score,
                "entity_id_raw": entity_id,
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
        query_vector = np.asarray(response.data[0].embedding, dtype=np.float32)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate embedding: {str(e)}")

    query_norm = float(np.linalg.norm(query_vector))
    if query_norm == 0.0:
        raise HTTPException(status_code=500, detail="Failed to generate valid query embedding")
    
    # Fetch candidate curations with embeddings (prefer vector index, fallback to scan)
    projection = {
        "entity_id": 1,
        "curation_id": 1,
        "categories": 1,
        "curator": 1,
        "notes": 1,
        "embeddings": 1,
    }

    candidate_limit = min(max(request.limit * 20, 200), 2000)
    curations = _vector_search_or_fallback(
        db, projection, query_vector, candidate_limit,
        {
            "embeddings": {"$exists": True, "$ne": []},
            "entity_id": {"$ne": None, "$exists": True},
        },
    )

    allowed_categories = set(request.categories) if request.categories else None
    
    for curation in curations:
        entity_id = curation.get("entity_id")
        if entity_id is None:
            continue
        entity_key = str(entity_id)
        embeddings = curation.get("embeddings", [])
        
        if not embeddings:
            continue
        
        matches = []
        similarities = []
        
        for emb in embeddings:
            # Filter by category if specified
            if allowed_categories and emb.get("category") not in allowed_categories:
                continue
            
            # Calculate cosine similarity
            try:
                concept_vector = _vector_to_array(emb["vector"])
                concept_norm = float(np.linalg.norm(concept_vector))
                if concept_norm == 0.0:
                    continue
                similarity = float(
                    np.dot(query_vector, concept_vector) / 
                    (query_norm * concept_norm)
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

            existing = semantic_results.get(entity_key)
            if existing and existing.get("semantic_score", 0.0) >= semantic_score:
                continue

            semantic_results[entity_key] = {
                "curation": build_curation_response_payload(curation),
                "semantic_score": semantic_score,
                "matches": matches[:10],  # Top 10 matches
                "entity_id_raw": entity_id,
            }
    
    semantic_search_time = time.time() - semantic_search_start
    
    # ========== 3. COMBINAR RESULTADOS ==========
    combined = {}
    all_entity_ids = set(entity_results.keys()) | set(semantic_results.keys())

    # Fetch missing entities in batch (avoid N+1 find_one)
    missing_entity_ids = []
    seen_missing = set()
    for entity_id in all_entity_ids:
        if entity_id in entity_results:
            continue
        semantic_data = semantic_results.get(entity_id, {})
        raw_id = semantic_data.get("entity_id_raw")
        if raw_id is None:
            continue
        raw_id_key = str(raw_id)
        if raw_id_key in seen_missing:
            continue
        seen_missing.add(raw_id_key)
        missing_entity_ids.append(raw_id)

    entities_by_id = {}
    if missing_entity_ids:
        missing_entities = list(db.entities.find({"_id": {"$in": missing_entity_ids}}))
        entities_by_id = {str(entity.get("_id")): entity for entity in missing_entities}
    
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
        if not entity:
            entity = entities_by_id.get(entity_id)
        
        if not entity:
            continue

        output_entity_id = str(entity.get("_id", entity_id))
        
        combined[entity_id] = {
            "entity_id": output_entity_id,
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


@router.post("/bulk", response_model=BulkOperationResponse, status_code=200)
def bulk_upsert_curations(
    request: Request,
    payload: BulkCurationCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth)
):
    """Bulk upsert curations (create or update) — max 500 per call.

    Each item is processed independently. Errors are collected per item and
    returned in the response so the caller can decide how to retry.

    If a curation with the same curation_id already exists it is updated
    (all fields merged); otherwise it is created.

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

    # Pre-fetch all unique entity_ids to avoid N+1 queries in the loop.
    # find_entity resolve ObjectId/string/slug — o $in com strings puras não
    # casava as 471 entities ObjectId (type bracketing) e a denormalização
    # city/type era pulada no caminho que o sync offline usa.
    unique_eids = list({c.entity_id for c in payload.curations if c.entity_id})
    by_id: dict = {}
    by_slug: dict = {}
    if unique_eids:
        # hex válido vira ObjectId no $in: entity ObjectId SEM campo entity_id
        # (bulk import) é alcançada — $in com string nunca casa ObjectId
        eid_variants = list(unique_eids)
        for eid in unique_eids:
            if ObjectId.is_valid(eid):
                eid_variants.append(ObjectId(eid))
        entity_docs = db.entities.find(
            {"$or": [{"_id": {"$in": eid_variants}}, {"entity_id": {"$in": unique_eids}}]},
            {"type": 1, "data.location": 1, "entity_id": 1}  # entity_id NA projeção (senão o slug nunca casa)
        )
        # strings ANTES de ObjectIds (prioridade documentada do repo) —
        # setdefault: o primeiro escreve, o outro não sobrescreve
        for e in sorted(entity_docs, key=lambda e: 0 if isinstance(e["_id"], str) else 1):
            # DOIS dicts: str(_id) e slug nunca se sobrescrevem (colisão
            # slug==str(_id) de outra entity denormalizaria cidade errada)
            by_id.setdefault(str(e["_id"]), e)
            if e.get("entity_id"):
                by_slug.setdefault(e["entity_id"], e)

    for idx, curation in enumerate(payload.curations):
        try:
            existing = find_curation(
                db, curation.curation_id,
                projection={"_id": 1, "version": 1, "createdBy": 1,
                            "createdAt": 1, "curator_id": 1},
            )

            # Denormalize city/type from entity (pre-fetched batch) — _id
            # exato tem prioridade sobre o slug
            entity_for_denorm = None
            if curation.entity_id:
                entity_for_denorm = by_id.get(curation.entity_id) or by_slug.get(curation.entity_id)

            if existing:
                doc = curation.model_dump(exclude_unset=True)
                doc.pop("curation_id", None)
                doc.pop("createdAt", None)
                doc.pop("createdBy", None)
                doc["updatedAt"] = now
                doc["version"] = existing.get("version", 1) + 1
                _normalize_curator_id(doc)  # ANTES do updatedBy: 'unknown' não persiste
                if (doc.get("curator_id") or "").lower() == "unknown" and existing.get("curator_id"):
                    # payload de device deslogado não clobber o valor real
                    doc["curator_id"] = existing["curator_id"]
                doc["updatedBy"] = doc.get("curator_id") or curation.curator_id
                if entity_for_denorm:
                    doc.update(denormalize_curation_location(entity_for_denorm))

                # atualiza o doc ESPECÍFICO que a existência achou (twin
                # ObjectId/string nunca é tocado por engano)
                db.curations.update_one({"_id": existing["_id"]}, {"$set": doc})
                updated += 1
            else:
                doc = curation.model_dump()
                _normalize_curator_id(doc)  # ANTES do createdBy/updatedBy
                doc["_id"] = curation.curation_id
                doc["createdAt"] = now
                doc["updatedAt"] = now
                doc["version"] = 1
                doc["createdBy"] = _clean_created_by(curation, doc)
                doc["updatedBy"] = doc.get("curator_id")
                if entity_for_denorm:
                    doc.update(denormalize_curation_location(entity_for_denorm))
                db.curations.insert_one(doc)
                created += 1

        except DuplicateKeyError:
            # Race: another request inserted between our find_one and insert_one.
            # Update the existing document with our data (preserve createdAt).
            try:
                update_doc = {k: v for k, v in doc.items() if k not in ("_id", "createdAt")}
                db.curations.update_one({"_id": curation.curation_id}, {"$set": update_doc})
                updated += 1
            except Exception as update_exc:
                errors.append(BulkItemError(
                    index=idx,
                    id=curation.curation_id,
                    error=f"Race recovery failed after DuplicateKeyError: {str(update_exc)}"
                ))
        except Exception as exc:
            errors.append(BulkItemError(
                index=idx,
                id=curation.curation_id,
                error=str(exc)
            ))

    return BulkOperationResponse(
        created=created,
        updated=updated,
        skipped=0,
        errors=errors,
        total_received=len(payload.curations)
    )
