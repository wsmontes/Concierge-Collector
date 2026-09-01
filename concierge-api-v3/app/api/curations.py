"""
Curation endpoints - CRUD operations for curations
Professional FastAPI implementation with async MongoDB
"""

from fastapi import APIRouter, HTTPException, Header, Query, Depends, Request
from typing import Optional, List
import re
import logging
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
import time
import os
import numpy as np

from pydantic import ValidationError

from app.models.schemas import (
    Curation,
    CurationCreate,
    CurationUpdate,
    PaginatedResponse,
    CurationStatus,
    SemanticSearchRequest,
    SemanticSearchResponse,
    SemanticSearchResult,
    ConceptMatch,
    HybridSearchRequest,
    HybridSearchResponse,
    HybridSearchResult,
    BulkCurationCreate,
    BulkOperationResponse,
    BulkItemError,
)
from app.core.database import get_database
from bson import ObjectId

from app.core.query_utils import resolve_after_id
from app.core.rate_limit import limiter, auth_header_key
from app.core.security import is_admin_auth, require_role, verify_auth
from app.models.user import has_role
from app.services.curation_denorm import denormalize_curation_location
from app.services.catalog_service import ensure_catalog_sequence
from app.services.curation_service import (
    CURATION_RESPONSE_PROJECTION,
    create_curation_doc,
    find_curation,
    resolve_ownership_action,
    stored_owner_identity,
    _normalize_curator_id,
    _is_placeholder_identity,
    _clean_created_by,
)
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
        return embeddings, False
    out = []
    dropped = False
    for emb in embeddings:
        if not isinstance(emb, dict) or "vector" not in emb:
            if isinstance(emb, dict):
                dropped = True
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
    return out, dropped


def _filter_by_entity_types(db, curations, entity_types):
    """Filtra candidatos cujo tipo de entity não está em entity_types.
    Resolve os DOIS formatos (type v3 e entity_type legado) e o hazard de
    ObjectId."""
    from bson import ObjectId as _OID

    allowed = set(entity_types)
    eids = [c.get("entity_id") for c in curations if c.get("entity_id")]
    if not eids:
        return [c for c in curations if not c.get("entity_id")]

    variants = list(eids)
    for eid in eids:
        if _OID.is_valid(eid):
            variants.append(_OID(eid))
    docs = db.entities.find(
        {"$or": [{"_id": {"$in": variants}}, {"entity_id": {"$in": eids}}]},
        {"type": 1, "entity_type": 1, "entity_id": 1},
    )
    type_by_key = {}
    for d in docs:
        etype = d.get("type") or d.get("entity_type")
        type_by_key[str(d["_id"])] = etype
        if d.get("entity_id"):
            type_by_key[str(d["entity_id"])] = etype

    return [c for c in curations if type_by_key.get(str(c.get("entity_id"))) in allowed]


def _vector_search_or_fallback(db, projection, query_vector, candidate_limit, fallback_filter):
    """Use Atlas Vector Search when available, otherwise scan every eligible Curation.

    Packed Binary float32 vectors are not guaranteed to be indexable by the
    deployed Atlas vector index. The fallback therefore prioritizes correctness:
    it NEVER truncates candidates by recency. This can be slower than the native
    index, but it cannot silently hide an older high-quality Curation.
    """
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
                return resultados, True
        except Exception as exc:
            logger.warning(
                "$vectorSearch falhou para o índice %r; usando fallback exaustivo: %s",
                vector_index_name,
                exc.__class__.__name__,
            )

    scan_started = time.time()
    resultados = list(db.curations.find(fallback_filter, projection))
    logger.warning(
        "semantic_search_fallback_exhaustive candidates=%s elapsed_ms=%s",
        len(resultados),
        round((time.time() - scan_started) * 1000, 1),
    )
    return resultados, False


router = APIRouter(prefix="/curations", tags=["curations"])


def _pending_category_texts(categories):
    pending = set()
    if isinstance(categories, dict):
        for category, concepts in categories.items():
            if isinstance(concepts, list):
                for concept in concepts:
                    pending.add(f"{category} {concept}")
    return pending


def _compute_backfill_flag(stored_categories, new_embeddings, client_meta, stored_meta):
    client_meta = dict(client_meta or {})
    client_meta.pop("backfill_needed", None)
    base = stored_meta if isinstance(stored_meta, dict) else {}
    meta = {**base, **client_meta}
    pending = _pending_category_texts(stored_categories)
    covered = {
        e.get("text")
        for e in (new_embeddings or [])
        if isinstance(e, dict) and e.get("text") and e.get("vector") is not None
    }
    meta["backfill_needed"] = not pending.issubset(covered)
    return meta


def _repair_curator_identity(doc, stored):
    if "curator_id" not in doc and "curator" not in doc:
        return doc

    stored_cur = stored.get("curator") if isinstance(stored.get("curator"), dict) else {}
    stored_id = stored.get("curator_id")
    if _is_placeholder_identity(stored_id):
        stored_id = stored_cur.get("id")
    if _is_placeholder_identity(stored_id):
        stored_id = None

    payload_cur = doc.get("curator") if isinstance(doc.get("curator"), dict) else {}
    payload_top = doc.get("curator_id")
    payload_emb = payload_cur.get("id")

    if not _is_placeholder_identity(payload_top):
        if _is_placeholder_identity(payload_emb):
            doc["curator"] = {**payload_cur, "id": payload_top}
        return doc
    if not _is_placeholder_identity(payload_emb):
        doc["curator_id"] = payload_emb
        return doc

    if stored_id:
        merged = {**stored_cur}
        for key, value in payload_cur.items():
            if not _is_placeholder_identity(value):
                merged[key] = value
        merged["id"] = stored_id
        doc["curator_id"] = stored_id
        doc["curator"] = merged
    else:
        doc["curator_id"] = None
    return doc


def build_curation_response_payload(curation_doc: dict) -> dict:
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
    auth: dict = Depends(require_role("curator")),
):
    return create_curation_doc(db, curation, auth)


def _parse_iso_param(name: str, raw: str) -> datetime:
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid {name} timestamp format. Use ISO 8601.")


def build_search_query(
    *,
    entity_id: Optional[str] = None,
    curator_id: Optional[str] = None,
    status: Optional[CurationStatus] = None,
    include_deleted: bool = False,
    since: Optional[str] = None,
    created_after: Optional[str] = None,
    city: Optional[str] = None,
    type: Optional[str] = None,
    q: Optional[str] = None,
    unlinked: bool = False,
) -> dict:
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
        query["updatedAt"] = {"$gte": _parse_iso_param("since", since)}
    if created_after:
        query["createdAt"] = {"$gte": _parse_iso_param("created_after", created_after)}
    if unlinked:
        unlinked_cond = {"entity_id": {"$in": [None, ""]}}
        if "$or" in query:
            query = {"$and": [query, unlinked_cond]}
        else:
            query["entity_id"] = unlinked_cond["entity_id"]
    if status:
        query["status"] = status
    elif not include_deleted:
        query["status"] = {"$ne": "deleted"}
    return query


@router.get("/search", response_model=PaginatedResponse)
def search_curations(
    entity_id: Optional[str] = Query(None),
    curator_id: Optional[str] = Query(None),
    status: Optional[CurationStatus] = Query(None),
    include_deleted: bool = Query(False),
    since: Optional[str] = Query(None),
    created_after: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    unlinked: bool = Query(False),
    sort_by: str = Query("updated_at"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    after_id: Optional[str] = Query(None),
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    query = build_search_query(
        entity_id=entity_id,
        curator_id=curator_id,
        status=status,
        include_deleted=include_deleted,
        since=since,
        created_after=created_after,
        city=city,
        type=type,
        q=q,
        unlinked=unlinked,
    )

    if after_id:
        query["_id"] = {"$gt": resolve_after_id(db, "curations", after_id)}
        total = -1
        docs = list(db.curations.find(query, CURATION_RESPONSE_PROJECTION).sort("_id", 1).limit(limit * 2))
        if not docs and isinstance(query["_id"]["$gt"], str):
            transition = dict(query)
            transition["_id"] = {"$gt": ObjectId("0" * 24)}
            docs = list(db.curations.find(transition, CURATION_RESPONSE_PROJECTION).sort("_id", 1).limit(limit * 2))
        items = []
        for doc in docs:
            try:
                items.append(Curation(**doc))
            except ValidationError as exc:
                logger.warning("curadoria malformada pulada na listagem: %s", exc)
        return PaginatedResponse(items=items[:limit], total=total, limit=limit, offset=offset)

    total = db.curations.count_documents(query)
    sort_field = {"updated_at": "updatedAt", "created_at": "createdAt"}.get(sort_by, "updatedAt")
    sort_dir = 1 if sort_order == "asc" else -1
    cursor = (
        db.curations.find(query, CURATION_RESPONSE_PROJECTION)
        .sort([(sort_field, sort_dir), ("_id", 1)])
        .skip(offset)
        .limit(limit)
    )
    items = []
    for doc in cursor:
        try:
            items.append(Curation(**doc))
        except ValidationError as exc:
            logger.warning("curadoria malformada pulada na listagem (offset): %s", exc)
    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/cities")
def list_cities(db: Database = Depends(get_database), auth: dict = Depends(verify_auth)):
    cities = db.curations.distinct("city")
    return sorted([c for c in cities if c])


@router.get("/entities/{entity_id}/curations", response_model=List[Curation])
def get_entity_curations(
    entity_id: str,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    entity = find_entity(db, entity_id)
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    cursor = db.curations.find(
        {"entity_id": entity_id, "status": {"$ne": "deleted"}}, CURATION_RESPONSE_PROJECTION
    ).limit(200)
    return [Curation(**doc) for doc in cursor]


@router.get("/{curation_id}", response_model=Curation)
def get_curation(
    curation_id: str,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    result = find_curation(db, curation_id, projection=CURATION_RESPONSE_PROJECTION)
    if not result:
        raise HTTPException(status_code=404, detail=f"Curation {curation_id} not found")
    return Curation(**result)


@router.patch("/{curation_id}", response_model=Curation)
def update_curation(
    curation_id: str,
    updates: CurationUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("curator")),
):
    current = find_curation(db, curation_id, projection=CURATION_RESPONSE_PROJECTION)
    if not current:
        raise HTTPException(status_code=404, detail="Curation not found")

    current_version = current.get("version", 1)
    if if_match:
        try:
            requested_version = int(if_match.strip('"'))
            if requested_version != current_version:
                raise HTTPException(
                    status_code=409,
                    detail=f"Version conflict: current={current_version}, requested={requested_version}",
                )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid If-Match header format")

    stored_owner = stored_owner_identity(current)
    ownership_action = resolve_ownership_action(stored_owner, current.get("curator_type"), auth)
    if ownership_action == "forbidden":
        raise HTTPException(status_code=403, detail="Cannot modify another curator's curation")

    update_data = {k: v for k, v in updates.model_dump(exclude_unset=True).items() if v is not None}
    if "curator" in update_data and "curator_id" not in update_data:
        curator_obj = update_data.get("curator") or {}
        if isinstance(curator_obj, dict) and curator_obj.get("id"):
            update_data["curator_id"] = curator_obj.get("id")
    if "curator_id" in update_data and "curator" not in update_data:
        current_curator = current.get("curator") or {}
        update_data["curator"] = {
            "id": update_data.get("curator_id"),
            "name": current_curator.get("name") or "Unknown",
            "email": current_curator.get("email"),
        }

    update_data["createdBy"] = (
        current.get("createdBy") or current.get("curator_id") or (current.get("curator") or {}).get("id")
    )
    if "entity_id" in update_data and update_data["entity_id"]:
        entity = find_entity(db, update_data["entity_id"])
        if entity:
            entity = {k: entity.get(k) for k in ("type", "data")}
            update_data.update(denormalize_curation_location(entity))

    update_data["updatedAt"] = datetime.now(timezone.utc)
    update_data["version"] = current_version + 1

    if "categories" in update_data or "embeddings" in update_data:
        compacted = None
        if "embeddings" in update_data:
            compacted, _dropped = _compact_embeddings_for_storage(update_data["embeddings"])
            update_data["embeddings"] = compacted
        categorias_pendencia = (
            update_data["categories"]
            if "categories" in update_data and update_data["categories"] is not None
            else current.get("categories") or {}
        )
        stored_raw = (
            db.curations.find_one(
                {"_id": current["_id"]},
                {"embeddings_metadata": 1, "embeddings.text": 1, "embeddings.vector": {"$slice": 1}},
            )
            or {}
        )
        stored_embeddings = (
            [{**e, "vector": None if "vector" not in e else e["vector"]} for e in stored_raw.get("embeddings") or []]
            if "embeddings" in stored_raw
            else None
        )
        cobertura = compacted if compacted is not None else stored_embeddings
        update_data["embeddings_metadata"] = _compute_backfill_flag(
            categorias_pendencia,
            cobertura,
            update_data.get("embeddings_metadata"),
            stored_raw.get("embeddings_metadata"),
        )

    _normalize_curator_id(update_data)
    _repair_curator_identity(update_data, current)

    if ownership_action == "transfer" and auth.get("user"):
        takeover_owner = auth.get("user")
        owner_profile = db.users.find_one({"email": takeover_owner}) or {}
        update_data["curator_id"] = takeover_owner
        update_data["curator"] = {
            "id": takeover_owner,
            "name": owner_profile.get("name") or takeover_owner,
            "email": takeover_owner,
        }
        update_data["curator_type"] = "human"

    final_owner = update_data.get("curator_id") or (update_data.get("curator") or {}).get("id")
    if not is_admin_auth(auth) and not _is_placeholder_identity(final_owner):
        if final_owner != auth.get("user"):
            raise HTTPException(status_code=403, detail="curator_id must match the authenticated user")

    update_data["updatedBy"] = (
        update_data.get("curator_id")
        or (update_data.get("curator") or {}).get("id")
        or auth.get("user")
        or current.get("updatedBy")
    )

    if "embeddings_metadata" in update_data and "categories" not in update_data and "embeddings" not in update_data:
        meta_client = dict(update_data.get("embeddings_metadata") or {})
        meta_client.pop("backfill_needed", None)
        stored_flag = (db.curations.find_one({"_id": current["_id"]}, {"embeddings_metadata": 1}) or {}).get(
            "embeddings_metadata"
        ) or {}
        if isinstance(stored_flag, dict) and stored_flag.get("backfill_needed"):
            meta_client["backfill_needed"] = True
        update_data["embeddings_metadata"] = meta_client

    write_filter = {"_id": current["_id"]}
    if "version" in current:
        write_filter["version"] = current_version
    else:
        # Legacy documents without a version still participate in CAS: only
        # one concurrent writer may claim the absent-version snapshot.
        write_filter["version"] = {"$exists": False}
    result = db.curations.find_one_and_update(
        write_filter,
        {"$set": update_data},
        projection=CURATION_RESPONSE_PROJECTION,
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=409, detail="Version conflict or curation not found")
    return Curation(**result)


@router.delete("/{curation_id}", status_code=204)
def delete_curation(
    curation_id: str,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("curator")),
):
    alvo = find_curation(db, curation_id, projection={"_id": 1, "curator_id": 1, "curator": 1})
    if not alvo:
        raise HTTPException(status_code=404, detail=f"Curation {curation_id} not found")
    stored_owner = alvo.get("curator_id") or (alvo.get("curator") or {}).get("id")
    if not is_admin_auth(auth) and not _is_placeholder_identity(stored_owner):
        if stored_owner != auth.get("user"):
            raise HTTPException(status_code=403, detail="Cannot delete another curator's curation")
    result = db.curations.update_one(
        {"_id": alvo["_id"]},
        {
            "$set": {
                "status": "deleted",
                "updatedAt": datetime.now(timezone.utc),
                "updatedBy": auth.get("user"),
            },
            "$inc": {"version": 1},
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail=f"Curation {curation_id} not found")


@router.post("/semantic-search", response_model=SemanticSearchResponse)
@limiter.limit("10/minute", key_func=auth_header_key)
def semantic_search_curations(
    request: Request,
    body: SemanticSearchRequest,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("viewer")),
):
    start_time = time.time()
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    client = OpenAI(api_key=openai_api_key)
    query_embed_start = time.time()
    try:
        response = client.embeddings.create(input=body.query, model="text-embedding-3-small", dimensions=1536)
        query_vector = np.asarray(response.data[0].embedding, dtype=np.float32)
    except Exception:
        logger.exception("semantic query embedding generation failed")
        raise HTTPException(status_code=500, detail="Failed to generate embedding")

    query_norm = float(np.linalg.norm(query_vector))
    if query_norm == 0.0:
        raise HTTPException(status_code=500, detail="Failed to generate valid query embedding")
    query_embed_time = time.time() - query_embed_start

    projection = {
        "entity_id": 1,
        "curation_id": 1,
        "categories": 1,
        "curator": 1,
        "notes": 1,
        "embeddings": 1,
    }
    candidate_limit = min(max(body.limit * 20, 200), 2000)
    curations, used_atlas = _vector_search_or_fallback(
        db,
        projection,
        query_vector,
        candidate_limit,
        {"embeddings": {"$exists": True, "$ne": []}},
    )
    candidate_count = len(curations)
    if body.entity_types:
        curations = _filter_by_entity_types(db, curations, body.entity_types)

    results = []
    allowed_categories = set(body.categories) if body.categories else None
    for curation in curations:
        embeddings = curation.get("embeddings", [])
        if not embeddings:
            continue
        matches = []
        similarity_sum = 0.0
        max_similarity = 0.0
        match_count = 0
        for emb in embeddings:
            if not isinstance(emb, dict):
                continue
            if allowed_categories and emb.get("category") not in allowed_categories:
                continue
            try:
                concept_vector = _vector_to_array(emb["vector"])
                concept_norm = float(np.linalg.norm(concept_vector))
                if concept_norm == 0.0:
                    continue
                similarity = float(np.dot(query_vector, concept_vector) / (query_norm * concept_norm))
            except Exception:
                continue
            if similarity >= body.min_similarity:
                rounded_similarity = round(similarity, 4)
                matches.append(
                    {
                        "text": emb.get("text", ""),
                        "category": emb.get("category", ""),
                        "concept": emb.get("concept", ""),
                        "similarity": rounded_similarity,
                    }
                )
                similarity_sum += rounded_similarity
                match_count += 1
                max_similarity = max(max_similarity, rounded_similarity)
        if not matches:
            continue
        matches.sort(key=lambda x: x["similarity"], reverse=True)
        entity_id = curation.get("entity_id")
        if entity_id is None:
            continue
        results.append(
            {
                "entity_id": entity_id,
                "curation": build_curation_response_payload(curation),
                "matches": matches[:10],
                "avg_similarity": round(similarity_sum / match_count, 4),
                "max_similarity": round(max_similarity, 4),
                "match_count": match_count,
            }
        )

    results.sort(key=lambda x: x["max_similarity"], reverse=True)
    results = results[: body.limit]
    if body.include_entity and results:
        entity_ids = [result["entity_id"] for result in results]
        entity_projection = {"name": 1, "entity_type": 1, "location": 1, "contact": 1}
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

    total_time = time.time() - start_time
    search_time = total_time - query_embed_time
    return SemanticSearchResponse(
        results=[SemanticSearchResult(**r) for r in results],
        query=body.query,
        query_embedding_time=round(query_embed_time, 3),
        search_time=round(search_time, 3),
        total_results=len(results),
        search_mode="atlas_vector" if used_atlas else "fallback_exhaustive",
        partial=False,
        candidate_count=candidate_count,
    )


@router.post("/hybrid-search", response_model=HybridSearchResponse)
@limiter.limit("10/minute", key_func=auth_header_key)
def hybrid_search(
    request: Request,
    body: HybridSearchRequest,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("viewer")),
):
    start_time = time.time()
    entity_search_start = time.time()
    entity_results = {}
    entity_filter = {}
    if body.query:
        entity_filter["$text"] = {"$search": body.query}
    if body.location:
        escaped_location = re.escape(body.location)
        entity_filter["$or"] = [
            {"location.city": {"$regex": escaped_location, "$options": "i"}},
            {"location.neighborhood": {"$regex": escaped_location, "$options": "i"}},
            {"location.address": {"$regex": escaped_location, "$options": "i"}},
        ]
    if entity_filter:
        entities = list(db.entities.find(entity_filter).limit(50))
        for entity in entities:
            entity_id = entity.get("_id")
            if entity_id is None:
                continue
            entity_key = str(entity_id)
            entity_results[entity_key] = {
                "entity": entity,
                "entity_score": entity.get("score", 0.5),
                "entity_id_raw": entity_id,
            }
    entity_search_time = time.time() - entity_search_start

    semantic_search_start = time.time()
    semantic_results = {}
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    client = OpenAI(api_key=openai_api_key)
    try:
        response = client.embeddings.create(input=body.query, model="text-embedding-3-small", dimensions=1536)
        query_vector = np.asarray(response.data[0].embedding, dtype=np.float32)
    except Exception:
        logger.exception("hybrid query embedding generation failed")
        raise HTTPException(status_code=500, detail="Failed to generate embedding")

    query_norm = float(np.linalg.norm(query_vector))
    if query_norm == 0.0:
        raise HTTPException(status_code=500, detail="Failed to generate valid query embedding")

    projection = {
        "entity_id": 1,
        "curation_id": 1,
        "categories": 1,
        "curator": 1,
        "notes": 1,
        "embeddings": 1,
    }
    candidate_limit = min(max(body.limit * 20, 200), 2000)
    curations, _used_atlas = _vector_search_or_fallback(
        db,
        projection,
        query_vector,
        candidate_limit,
        {"embeddings": {"$exists": True, "$ne": []}, "entity_id": {"$ne": None, "$exists": True}},
    )
    allowed_categories = set(body.categories) if body.categories else None
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
            if not isinstance(emb, dict):
                continue
            if allowed_categories and emb.get("category") not in allowed_categories:
                continue
            try:
                concept_vector = _vector_to_array(emb["vector"])
                concept_norm = float(np.linalg.norm(concept_vector))
                if concept_norm == 0.0:
                    continue
                similarity = float(np.dot(query_vector, concept_vector) / (query_norm * concept_norm))
            except Exception:
                continue
            if similarity >= body.min_similarity:
                similarities.append(similarity)
                matches.append(
                    ConceptMatch(
                        text=emb.get("text", ""),
                        category=emb.get("category", ""),
                        concept=emb.get("concept", ""),
                        similarity=similarity,
                    )
                )
        if matches:
            matches.sort(key=lambda x: x.similarity, reverse=True)
            semantic_score = max(similarities)
            existing = semantic_results.get(entity_key)
            if existing and existing.get("semantic_score", 0.0) >= semantic_score:
                continue
            semantic_results[entity_key] = {
                "curation": build_curation_response_payload(curation),
                "semantic_score": semantic_score,
                "matches": matches[:10],
                "entity_id_raw": entity_id,
            }
    semantic_search_time = time.time() - semantic_search_start

    combined = {}
    all_entity_ids = set(entity_results.keys()) | set(semantic_results.keys())
    missing_entity_ids = []
    seen_missing = set()
    for entity_id in all_entity_ids:
        if entity_id in entity_results:
            continue
        raw_id = semantic_results.get(entity_id, {}).get("entity_id_raw")
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
        if entity_score > 0 and semantic_score > 0:
            match_type = "hybrid"
        elif semantic_score > 0:
            match_type = "semantic"
        else:
            match_type = "entity"
        combined_score = (1 - body.boost_semantic) * entity_score + body.boost_semantic * semantic_score
        entity = entity_data.get("entity") or entities_by_id.get(entity_id)
        if not entity:
            continue
        output_entity_id = str(entity.get("_id", entity_id))
        combined[entity_id] = {
            "entity_id": output_entity_id,
            "entity": {
                "name": entity.get("name"),
                "entity_type": entity.get("entity_type"),
                "location": entity.get("location"),
                "contact": entity.get("contact"),
            },
            "curation": semantic_data.get("curation"),
            "score": combined_score,
            "match_type": match_type,
            "entity_score": entity_score,
            "semantic_score": semantic_score,
            "semantic_matches": semantic_data.get("matches"),
        }

    results = list(combined.values())
    results.sort(key=lambda x: x["score"], reverse=True)
    results = results[: body.limit]
    total_time = time.time() - start_time
    return HybridSearchResponse(
        results=[HybridSearchResult(**r) for r in results],
        query=body.query,
        entity_search_time=round(entity_search_time, 3),
        semantic_search_time=round(semantic_search_time, 3),
        total_time=round(total_time, 3),
        total_results=len(results),
    )


@router.post("/bulk", response_model=BulkOperationResponse, status_code=200)
def bulk_upsert_curations(
    request: Request,
    payload: BulkCurationCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("curator")),
):
    caller_role = auth.get("role", "curator")
    if not has_role(caller_role, "curator"):
        raise HTTPException(status_code=403, detail="Insufficient role: curator or admin required for bulk import")
    created = 0
    updated = 0
    errors: list = []
    now = datetime.now(timezone.utc)

    unique_eids = list({c.entity_id for c in payload.curations if c.entity_id})
    by_id: dict = {}
    by_slug: dict = {}
    if unique_eids:
        eid_variants = list(unique_eids)
        for eid in unique_eids:
            if ObjectId.is_valid(eid):
                eid_variants.append(ObjectId(eid))
        entity_docs = db.entities.find(
            {"$or": [{"_id": {"$in": eid_variants}}, {"entity_id": {"$in": unique_eids}}]},
            {"type": 1, "data.location": 1, "entity_id": 1},
        )
        for e in sorted(entity_docs, key=lambda e: 0 if isinstance(e["_id"], str) else 1):
            by_id.setdefault(str(e["_id"]), e)
            if e.get("entity_id"):
                by_slug.setdefault(e["entity_id"], e)

    plain_ids, curator_ids = [], []
    for c in payload.curations:
        needs_stored_curator = _is_placeholder_identity(c.curator_id) and _is_placeholder_identity((c.curator or {}).id)
        (curator_ids if needs_stored_curator else plain_ids).append(c.curation_id)
    existing_map: dict = {}
    base_proj = {
        "_id": 1,
        "version": 1,
        "createdBy": 1,
        "createdAt": 1,
        "curator_id": 1,
        "curator": 1,
        "curator_type": 1,
    }

    def _load_existing_group(ids, extra_proj):
        if not ids:
            return
        proj = {**base_proj, **extra_proj}
        for doc in db.curations.find({"_id": {"$in": ids}}, proj):
            existing_map.setdefault(str(doc["_id"]), doc)
        hex_ids = [i for i in ids if ObjectId.is_valid(i)]
        if hex_ids:
            for doc in db.curations.find({"_id": {"$in": [ObjectId(i) for i in hex_ids]}}, proj):
                existing_map.setdefault(str(doc["_id"]), doc)
        for doc in db.curations.find({"curation_id": {"$in": ids}}, proj):
            key = str(doc.get("curation_id") or doc["_id"])
            existing_map.setdefault(key, doc)

    _load_existing_group(plain_ids, {})
    _load_existing_group(curator_ids, {"curator": 1})

    for idx, curation in enumerate(payload.curations):
        try:
            existing = existing_map.get(curation.curation_id)
            entity_for_denorm = (
                by_id.get(curation.entity_id) or by_slug.get(curation.entity_id) if curation.entity_id else None
            )
            if existing:
                stored_owner = stored_owner_identity(existing)
                ownership_action = resolve_ownership_action(stored_owner, existing.get("curator_type"), auth)
                if ownership_action == "forbidden":
                    errors.append(
                        BulkItemError(
                            index=idx,
                            id=curation.curation_id,
                            error="ownership violation: curator_id does not match authenticated user",
                        )
                    )
                    continue
                expected_version = getattr(curation, "expected_version", None)
                if expected_version is not None and existing.get("version", 1) != expected_version:
                    errors.append(
                        BulkItemError(
                            index=idx,
                            id=curation.curation_id,
                            error=(
                                f"version conflict: server has v{existing.get('version', 1)}, "
                                f"payload expects v{expected_version}"
                            ),
                        )
                    )
                    continue
                doc = curation.model_dump(exclude_unset=True)
                for key in ("curation_id", "createdAt", "createdBy", "expected_version"):
                    doc.pop(key, None)
                doc["updatedAt"] = now
                doc["version"] = existing.get("version", 1) + 1
                _normalize_curator_id(doc)
                _repair_curator_identity(doc, existing)
                if ownership_action == "transfer" and auth.get("user"):
                    takeover_owner = auth.get("user")
                    owner_profile = db.users.find_one({"email": takeover_owner}) or {}
                    doc["curator_id"] = takeover_owner
                    doc["curator"] = {
                        "id": takeover_owner,
                        "name": owner_profile.get("name") or takeover_owner,
                        "email": takeover_owner,
                    }
                    doc["curator_type"] = "human"
                doc["updatedBy"] = doc.get("curator_id") or auth.get("user")
                if entity_for_denorm:
                    doc.update(denormalize_curation_location(entity_for_denorm))
                db.curations.update_one({"_id": existing["_id"]}, {"$set": doc})
                updated += 1
            else:
                doc = curation.model_dump()
                _normalize_curator_id(doc)
                owner = doc.get("curator_id") or (doc.get("curator") or {}).get("id")
                if not is_admin_auth(auth) and not _is_placeholder_identity(owner) and owner != auth.get("user"):
                    errors.append(
                        BulkItemError(
                            index=idx,
                            id=curation.curation_id,
                            error="ownership violation: curator_id must match the authenticated user",
                        )
                    )
                    continue
                _repair_curator_identity(doc, {})
                doc["_id"] = curation.curation_id
                doc["createdAt"] = now
                doc["updatedAt"] = now
                doc["version"] = 1
                ensure_catalog_sequence(db, doc)
                doc["createdBy"] = _clean_created_by(curation, doc)
                doc["updatedBy"] = doc.get("curator_id") or auth.get("user")
                if entity_for_denorm:
                    doc.update(denormalize_curation_location(entity_for_denorm))
                db.curations.insert_one(doc)
                created += 1

        except DuplicateKeyError:
            try:
                update_doc = {
                    k: v
                    for k, v in doc.items()
                    if k
                    not in (
                        "_id",
                        "createdAt",
                        "createdBy",
                        "curator",
                        "curator_id",
                        "version",
                        "updatedBy",
                        "entity_id",
                        "city",
                        "type",
                    )
                }
                winner = find_curation(db, curation.curation_id, projection={"_id": 1, "curator": 1, "curator_id": 1})
                if winner:
                    winner_id = winner.get("curator_id")
                    if _is_placeholder_identity(winner_id):
                        winner_id = (winner.get("curator") or {}).get("id")
                    if _is_placeholder_identity(winner_id) and (
                        not _is_placeholder_identity(doc.get("curator_id"))
                        or not _is_placeholder_identity((doc.get("curator") or {}).get("id"))
                    ):
                        update_doc["curator_id"] = doc.get("curator_id")
                        update_doc["curator"] = doc.get("curator")
                res = db.curations.update_one(
                    {"_id": curation.curation_id},
                    {"$set": update_doc, "$inc": {"version": 1}},
                )
                if res.matched_count == 0:
                    raise RuntimeError("vencedor não encontrado no recovery (deletado no meio da corrida)")
                updated += 1
            except Exception as update_exc:
                errors.append(
                    BulkItemError(
                        index=idx,
                        id=curation.curation_id,
                        error=f"Race recovery failed after DuplicateKeyError: {str(update_exc)}",
                    )
                )
        except Exception as exc:
            errors.append(BulkItemError(index=idx, id=curation.curation_id, error=str(exc)))

    return BulkOperationResponse(
        created=created,
        updated=updated,
        skipped=0,
        errors=errors,
        total_received=len(payload.curations),
    )
