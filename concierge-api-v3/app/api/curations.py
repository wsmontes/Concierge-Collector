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
from app.core.rate_limit import limiter
from app.core.security import is_admin_auth, require_role
from app.models.user import has_role
from app.services.curation_denorm import denormalize_curation_location
from app.services.curation_service import (
    CURATION_RESPONSE_PROJECTION,
    create_curation_doc,
    find_curation,
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
            # texto sem vetor é EXATAMENTE o que o backfill precisa gerar —
            # marca o drop (senão o filtro do backfill nunca re-selecionaria)
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
    # drop parcial PRESERVA os vetores válidos e sinaliza backfill — o filtro
    # do backfill inclui embeddings_metadata.backfill_needed: True, então os
    # textos dropados são regenerados sem destruir o que está bom
    return out, dropped


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
    return list(db.curations.find(fallback_filter, projection).sort("updatedAt", -1).limit(candidate_limit))


router = APIRouter(prefix="/curations", tags=["curations"])


def _pending_category_texts(categories):
    """Textos 'category concept' derivados de categories (mesmo formato dos
    geradores de embeddings) — a ÚNICA fonte de pendência. Guarda contra
    categories não-dict."""
    pending = set()
    if isinstance(categories, dict):
        for category, concepts in categories.items():
            if isinstance(concepts, list):
                for concept in concepts:
                    pending.add(f"{category} {concept}")
    return pending


def _compute_backfill_flag(stored_categories, new_embeddings, client_meta, stored_meta):
    """Regra ÚNICA da flag backfill_needed: True se QUALQUER texto pendente de
    categories não está coberto pelos novos embeddings. O cliente NUNCA
    controla a flag (o servidor é a autoridade) e metadata não-dict não
    quebra o merge."""
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
    """Regra ÚNICA server-side de identidade do curator (bulk update + PATCH).

    Identidade REAL prevalece sobre placeholder em TODOS os campos:
    - payload sem identidade real (top-level e embutida placeholders) →
      identidade ARMAZENADA prevalece; name/email reais nunca são destruídos
      por placeholder do payload (payload {id:'unknown', name:'unknown',
      email:null} do sync offline é o caso real — syncManagerV3.js);
    - top-level real + embutida placeholder → embutida sincroniza com a
      top-level (um id embutido '' some da busca por curator.id e re-infecta
      o próximo push);
    - top-level placeholder não sombreia embutida real (estado legado
      'unknown' no curator_id não mata o reparo);
    - nada real em lugar nenhum → placeholder não persiste no curator_id
      (objeto embutido fica como o payload mandou — comportamento de create).
    Sem menção a identidade no doc, nada muda.
    """
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
        # top-level real é autoritativo — embutida placeholder não envenena
        if _is_placeholder_identity(payload_emb):
            doc["curator"] = {**payload_cur, "id": payload_top}
        return doc
    if not _is_placeholder_identity(payload_emb):
        # embutida real é autoritativo (o normalize já sincronizou top-level)
        doc["curator_id"] = payload_emb
        return doc

    # payload todo placeholder: armazenado prevalece
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
    auth: dict = Depends(require_role("curator")),  # Support both API key and JWT
):
    """Create a new curation

    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header

    Delega para o curation_service (fronteira única de escrita — o AI
    Orchestrator usa o mesmo caminho).
    """
    return create_curation_doc(db, curation, auth)


@router.get("/search", response_model=PaginatedResponse)
def search_curations(
    entity_id: Optional[str] = Query(None),
    curator_id: Optional[str] = Query(None),
    status: Optional[CurationStatus] = Query(None),
    include_deleted: bool = Query(False),
    since: Optional[str] = Query(
        None,
        description="ISO timestamp - only return curations updated after this time",
    ),
    city: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Busca por texto em restaurant_name"),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    after_id: Optional[str] = Query(
        None,
        description=(
            "Cursor-based pagination: return items with _id > after_id "
            "(O(log n), preferred over offset for large sets)"
        ),
    ),
    db: Database = Depends(get_database),
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
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
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
        # janela 2x: skips de docs malformados não podem esvaziar a página
        # (o cliente para em página vazia e avançaria o watermark)
        docs = list(db.curations.find(query, CURATION_RESPONSE_PROJECTION).sort("_id", 1).limit(limit * 2))
        if not docs and isinstance(query["_id"]["$gt"], str):
            transition = dict(query)
            transition["_id"] = {"$gt": ObjectId("0" * 24)}
            docs = list(db.curations.find(transition, CURATION_RESPONSE_PROJECTION).sort("_id", 1).limit(limit * 2))
        items = []
        for doc in docs:
            try:
                items.append(Curation(**doc))
            except ValidationError as e:
                # doc legado não pode derrubar a página NEM esvaziá-la: o
                # cliente para em página vazia e avança o watermark — um
                # skip silencioso causaria invisibilidade permanente
                logger.warning("curadoria malformada pulada na listagem: %s", e)
        return PaginatedResponse(items=items[:limit], total=total, limit=limit, offset=offset)

    total = db.curations.count_documents(query)
    cursor = db.curations.find(query, CURATION_RESPONSE_PROJECTION).sort("_id", 1).skip(offset).limit(limit)

    items = []
    for doc in cursor:
        try:
            items.append(Curation(**doc))
        except ValidationError as e:
            # doc de formato legado (curator/curation_id ausentes) não pode
            # derrubar a página inteira com 500 (modo offset)
            logger.warning("curadoria malformada pulada na listagem (offset): %s", e)

    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.get("/cities")
def list_cities(db: Database = Depends(get_database)):
    """Retorna lista distinta de cidades para o dropdown de filtro.
    Usa MongoDB distinct() com índice implícito — O(1) na prática."""
    cities = db.curations.distinct("city")
    return sorted([c for c in cities if c])


@router.get("/entities/{entity_id}/curations", response_model=List[Curation])
def get_entity_curations(entity_id: str, db: Database = Depends(get_database)):
    """Get all curations for an entity"""
    # Verify entity exists
    entity = find_entity(db, entity_id)
    if not entity:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")

    # Get curations (exclude deleted by default)
    projection = CURATION_RESPONSE_PROJECTION

    cursor = db.curations.find({"entity_id": entity_id, "status": {"$ne": "deleted"}}, projection).limit(200)
    curations = []
    for doc in cursor:
        curations.append(Curation(**doc))

    return curations


@router.get("/{curation_id}", response_model=Curation)
def get_curation(curation_id: str, db: Database = Depends(get_database)):
    """Get curation by ID"""
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
    auth: dict = Depends(require_role("curator")),  # Support both API key and JWT
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
                    detail=f"Version conflict: current={current_version}, requested={requested_version}",
                )
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid If-Match header format")

    # ── IDOR (ownership): só o dono (ou admin via API key/role) edita a
    # curadoria. DEPOIS do If-Match — 404/409/400 têm prioridade. O dono é a
    # identidade ARMAZENADA; placeholder (legado sem dono) é editável por
    # qualquer curator logado.
    stored_owner = current.get("curator_id") or (current.get("curator") or {}).get("id")
    if not is_admin_auth(auth) and not _is_placeholder_identity(stored_owner):
        if stored_owner != auth.get("user"):
            raise HTTPException(
                status_code=403,
                detail="Cannot modify another curator's curation",
            )

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
            "email": current_curator.get("email"),
        }

    # Preserve original creator forever (backfill once for legacy records)
    if current.get("createdBy"):
        update_data["createdBy"] = current.get("createdBy")
    else:
        update_data["createdBy"] = current.get("curator_id") or (current.get("curator") or {}).get("id")

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
    if "categories" in update_data or "embeddings" in update_data:
        # Fronteira de escrita: vetores compactados + flag de pendência
        # computada a partir das CATEGORIES.
        compacted = None
        if "embeddings" in update_data:
            compacted, _dropped = _compact_embeddings_for_storage(update_data["embeddings"])
            update_data["embeddings"] = compacted
        # categories do PATCH prevalecem — INCLUSIVE {} (clear legítimo não é
        # falsy: limpar conceitos não pode re-estampar pendência do snapshot)
        if "categories" in update_data and update_data["categories"] is not None:
            categorias_pendencia = update_data["categories"]
        else:
            # categories já veio no current (o projection não a exclui)
            categorias_pendencia = current.get("categories") or {}
        # embeddings armazenados (presença de vetor) cobrem a pendência quando
        # o PATCH é só-categories — sem isso, qualquer edição de conceito
        # re-estamparia True em docs já totalmente embutidos
        stored_raw = (
            db.curations.find_one(
                {"_id": current["_id"]},
                {
                    "embeddings_metadata": 1,
                    "embeddings.text": 1,
                    "embeddings.vector": {"$slice": 1},
                },
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

    # Regra única de identidade (mesma do bulk): identidade REAL prevalece;
    # placeholder ('unknown'/'') nunca persiste por cima do valor real
    # armazenado e id embutido placeholder não envenena top-level real
    _normalize_curator_id(update_data)
    _repair_curator_identity(update_data, current)

    # ── IDOR (atribuição): a identidade REAL final escrita só pode ser a do
    # próprio usuário (ou admin); placeholder (sync offline) passa. Sem chaves
    # de identidade no payload, nada a checar.
    final_owner = update_data.get("curator_id") or (update_data.get("curator") or {}).get("id")
    if not is_admin_auth(auth) and not _is_placeholder_identity(final_owner):
        if final_owner != auth.get("user"):
            raise HTTPException(
                status_code=403,
                detail="curator_id must match the authenticated user",
            )

    # Last writer becomes the last updater — DEPOIS do reparo: placeholder
    # nunca persiste no updatedBy
    update_data["updatedBy"] = (
        update_data.get("curator_id")
        or (update_data.get("curator") or {}).get("id")
        or auth.get("user")
        or current.get("updatedBy")
    )

    # Cliente NUNCA controla a flag: PATCH só de embeddings_metadata tem a
    # chave removida (o servidor é a autoridade)
    if "embeddings_metadata" in update_data and "categories" not in update_data and "embeddings" not in update_data:
        meta_client = dict(update_data.get("embeddings_metadata") or {})
        meta_client.pop("backfill_needed", None)
        # PRESERVA a flag armazenada (o cliente não pode apagar pendência) —
        # lê do BANCO: a projeção do current exclui embeddings_metadata
        stored_flag = (db.curations.find_one({"_id": current["_id"]}, {"embeddings_metadata": 1}) or {}).get(
            "embeddings_metadata"
        ) or {}
        if isinstance(stored_flag, dict) and stored_flag.get("backfill_needed"):
            meta_client["backfill_needed"] = True
        update_data["embeddings_metadata"] = meta_client

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
        return_document=True,
    )

    if not result:
        raise HTTPException(status_code=409, detail="Version conflict or curation not found")

    return Curation(**result)


@router.delete("/{curation_id}", status_code=204)
def delete_curation(
    curation_id: str,
    db: Database = Depends(get_database),
    auth: dict = Depends(require_role("curator")),  # Support both API key and JWT
):
    """Delete curation (Soft Delete)

    Marks the curation as 'deleted' instead of removing from DB.
    **Authentication Required:** Include `Authorization: Bearer <token>` OR `X-API-Key: <key>` header
    """
    # Projeção inclui identidade — o owner check abaixo precisa dela
    alvo = find_curation(db, curation_id, projection={"_id": 1, "curator_id": 1, "curator": 1})
    if not alvo:
        raise HTTPException(status_code=404, detail=f"Curation {curation_id} not found")

    # ── IDOR (ownership): só o dono (ou admin) deleta. DEPOIS do 404.
    stored_owner = alvo.get("curator_id") or (alvo.get("curator") or {}).get("id")
    if not is_admin_auth(auth) and not _is_placeholder_identity(stored_owner):
        if stored_owner != auth.get("user"):
            raise HTTPException(
                status_code=403,
                detail="Cannot delete another curator's curation",
            )

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
@limiter.limit("10/minute")
def semantic_search_curations(
    request: Request,
    body: SemanticSearchRequest,
    db: Database = Depends(get_database),
):
    """Semantic search for curations using concept embeddings

    Generates embedding for the query and finds curations with similar concepts
    using cosine similarity between vectors.

    Endpoint público (documentado), mas limitado a 10/min por IP — cada busca
    gera um embedding pago na OpenAI.

    **Example queries:**
    - "casual japanese food"
    - "romantic dinner with wine"
    - "outdoor seating italian restaurant"
    - "business lunch downtown"
    """
    start_time = time.time()

    # 1. Generate query embedding
    openai_api_key = os.getenv("OPENAI_API_KEY")
    if not openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    client = OpenAI(api_key=openai_api_key)

    query_embed_start = time.time()
    try:
        response = client.embeddings.create(input=body.query, model="text-embedding-3-small", dimensions=1536)
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

    candidate_limit = min(max(body.limit * 20, 200), 2000)
    curations = _vector_search_or_fallback(
        db,
        projection,
        query_vector,
        candidate_limit,
        {"embeddings": {"$exists": True, "$ne": []}},
    )

    # 3. Calculate similarities for each curation
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
                continue  # entrada corrompida não pode derrubar a busca
            # Filter by category if specified
            if allowed_categories and emb.get("category") not in allowed_categories:
                continue

            # Calculate cosine similarity
            try:
                concept_vector = _vector_to_array(emb["vector"])
                concept_norm = float(np.linalg.norm(concept_vector))
                if concept_norm == 0.0:
                    continue
                similarity = float(np.dot(query_vector, concept_vector) / (query_norm * concept_norm))
            except Exception:
                continue

            # Filter by threshold
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
            "match_count": match_count,
        }

        results.append(result_data)

    # 5. Sort by max_similarity (best match first)
    results.sort(key=lambda x: x["max_similarity"], reverse=True)

    # 6. Limit results
    results = results[: body.limit]

    if body.include_entity and results:
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
        query=body.query,
        query_embedding_time=round(query_embed_time, 3),
        search_time=round(search_time, 3),
        total_results=len(results),
    )


@router.post("/hybrid-search", response_model=HybridSearchResponse)
@limiter.limit("10/minute")
def hybrid_search(request: Request, body: HybridSearchRequest, db: Database = Depends(get_database)):
    """Busca híbrida: combina busca tradicional de entities + busca semântica de curations

    Executa ambas as buscas EM PARALELO e combina os resultados de forma inteligente:
    - Entities que batem por nome/localização recebem entity_score
    - Curations que batem semanticamente recebem semantic_score
    - Score final = (1 - boost_semantic) * entity_score + boost_semantic * semantic_score

    Endpoint público (documentado), mas limitado a 10/min por IP — cada busca
    gera um embedding pago na OpenAI.

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
    if body.query:
        entity_filter["$text"] = {"$search": body.query}

    # Location filter
    if body.location:
        escaped_location = re.escape(body.location)
        entity_filter["$or"] = [
            {"location.city": {"$regex": escaped_location, "$options": "i"}},
            {"location.neighborhood": {"$regex": escaped_location, "$options": "i"}},
            {"location.address": {"$regex": escaped_location, "$options": "i"}},
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
        response = client.embeddings.create(input=body.query, model="text-embedding-3-small", dimensions=1536)
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

    candidate_limit = min(max(body.limit * 20, 200), 2000)
    curations = _vector_search_or_fallback(
        db,
        projection,
        query_vector,
        candidate_limit,
        {
            "embeddings": {"$exists": True, "$ne": []},
            "entity_id": {"$ne": None, "$exists": True},
        },
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
                continue  # entrada corrompida não pode derrubar a busca
            # Filter by category if specified
            if allowed_categories and emb.get("category") not in allowed_categories:
                continue

            # Calculate cosine similarity
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
        combined_score = (1 - body.boost_semantic) * entity_score + body.boost_semantic * semantic_score

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
                "contact": entity.get("contact"),
            },
            "curation": semantic_data.get("curation"),
            "score": combined_score,
            "match_type": match_type,
            "entity_score": entity_score,
            "semantic_score": semantic_score,
            "semantic_matches": semantic_data.get("matches"),
        }

    # ========== 4. RANKEAR E LIMITAR ==========
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
        raise HTTPException(
            status_code=403,
            detail="Insufficient role: curator or admin required for bulk import",
        )
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
            {
                "$or": [
                    {"_id": {"$in": eid_variants}},
                    {"entity_id": {"$in": unique_eids}},
                ]
            },
            {
                "type": 1,
                "data.location": 1,
                "entity_id": 1,
            },  # entity_id NA projeção (senão o slug nunca casa)
        )
        # strings ANTES de ObjectIds (prioridade documentada do repo) —
        # setdefault: o primeiro escreve, o outro não sobrescreve
        for e in sorted(entity_docs, key=lambda e: 0 if isinstance(e["_id"], str) else 1):
            # DOIS dicts: str(_id) e slug nunca se sobrescrevem (colisão
            # slug==str(_id) de outra entity denormalizaria cidade errada)
            by_id.setdefault(str(e["_id"]), e)
            if e.get("entity_id"):
                by_slug.setdefault(e["entity_id"], e)

    # Pré-fetch de existência das curadorias (mesma estratégia do pre-fetch
    # de entities): sem isso, o loop faz até 2 probes SEQUENCIAIS por item —
    # ~1000 round trips num lote de 500. Prioridade de resolução idêntica à
    # do find_curation: _id string exato → _id ObjectId → campo curation_id
    # (setdefault: o primeiro escreve). Dois grupos de projeção: 'curator'
    # inteiro só para payloads SEM identidade real (o reparo pode precisar
    # do armazenado) — sync logado não paga o subdoc no lote todo.
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
        # ownership por item (auditoria ago/2026): curator.id embutido é
        # necessário quando o curator_id top-level é placeholder
        "curator": 1,
    }

    def _load_existing_group(ids, extra_proj):
        """Carga em lote de um grupo de ids no existing_map."""
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

            # Denormalize city/type from entity (pre-fetched batch) — _id
            # exato tem prioridade sobre o slug
            entity_for_denorm = None
            if curation.entity_id:
                entity_for_denorm = by_id.get(curation.entity_id) or by_slug.get(curation.entity_id)

            if existing:
                # ── OWNERSHIP (auditoria ago/2026): curator comum só atualiza
                # a PRÓPRIA curation; admin (API key/role) age em qualquer uma
                if not is_admin_auth(auth):
                    stored_owner = existing.get("curator_id") or (existing.get("curator") or {}).get("id")
                    if not _is_placeholder_identity(stored_owner) and stored_owner != auth.get("user"):
                        errors.append(
                            BulkItemError(
                                index=idx,
                                id=curation.curation_id,
                                error="ownership violation: curator_id does not match authenticated user",
                            )
                        )
                        continue

                doc = curation.model_dump(exclude_unset=True)
                doc.pop("curation_id", None)
                doc.pop("createdAt", None)
                doc.pop("createdBy", None)
                doc["updatedAt"] = now
                doc["version"] = existing.get("version", 1) + 1
                _normalize_curator_id(doc)  # embutida real sincroniza top-level ANTES do reparo
                _repair_curator_identity(doc, existing)
                # DEPOIS do reparo: placeholder nunca persiste no updatedBy
                doc["updatedBy"] = doc.get("curator_id") or auth.get("user")
                if entity_for_denorm:
                    doc.update(denormalize_curation_location(entity_for_denorm))

                # atualiza o doc ESPECÍFICO que a existência achou (twin
                # ObjectId/string nunca é tocado por engano)
                db.curations.update_one({"_id": existing["_id"]}, {"$set": doc})
                updated += 1
            else:
                doc = curation.model_dump()
                _normalize_curator_id(doc)  # ANTES do createdBy/updatedBy
                # IDOR de create: curator comum não cria em nome de terceiro
                # (mesma regra do POST /curations individual)
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
                _repair_curator_identity(doc, {})  # create: placeholder não persiste no curator_id
                doc["_id"] = curation.curation_id
                doc["createdAt"] = now
                doc["updatedAt"] = now
                doc["version"] = 1
                doc["createdBy"] = _clean_created_by(curation, doc)
                doc["updatedBy"] = doc.get("curator_id") or auth.get("user")
                if entity_for_denorm:
                    doc.update(denormalize_curation_location(entity_for_denorm))
                db.curations.insert_one(doc)
                created += 1

        except DuplicateKeyError:
            # Race: outro request inseriu entre o find_one e o insert_one.
            # Duplicate ⇒ colisão de _id (não existe outro índice único em
            # curations). VENCEDOR é autoritativo em identidade, entidade e
            # versão: $inc atômico mantém a versão monotônica sem TOCTOU de
            # leitura+escrita, e entity_id/city/type do loser não re-linkam a
            # curadoria para outra entity. matched_count==0 (vencedor deletado
            # no meio da corrida) é erro explícito — nunca contabilizar como
            # salvo: o cliente descarta a cópia local pelo contador de erros.
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
                winner = find_curation(
                    db,
                    curation.curation_id,
                    projection={"_id": 1, "curator": 1, "curator_id": 1},
                )
                if winner:
                    winner_id = winner.get("curator_id")
                    if _is_placeholder_identity(winner_id):
                        winner_id = (winner.get("curator") or {}).get("id")
                    if _is_placeholder_identity(winner_id) and (
                        not _is_placeholder_identity(doc.get("curator_id"))
                        or not _is_placeholder_identity((doc.get("curator") or {}).get("id"))
                    ):
                        # vencedor sem identidade real: a do loser (real)
                        # sobrevive — senão o doc fica órfão de curator
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
