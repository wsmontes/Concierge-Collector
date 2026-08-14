"""
Entity endpoints - CRUD operations
"""

import re

from fastapi import APIRouter, HTTPException, Header, Query, Depends, Request
from typing import Optional
from datetime import datetime, timezone
from bson import ObjectId
import logging

from pymongo.errors import DuplicateKeyError
from pymongo.database import Database

from app.models.schemas import (
    Entity,
    EntityCreate,
    EntityUpdate,
    PaginatedResponse,
    BulkEntityCreate,
    BulkOperationResponse,
    BulkItemError,
)
from app.core.database import get_database
from app.core.query_utils import resolve_after_id
from app.models.user import has_role
from app.core.security import (
    verify_auth,
)

logger = logging.getLogger(__name__)

# ============================================================================
# BUSCA ACENTO-INSENSÍVEL
# ============================================================================
# O acervo é PT-BR/EN ("São Paulo", "Café", "Maní") e o usuário digita sem
# acento no celular ("sao paulo"). Regex simples não faz folding de acento —
# cada letra é expandida para uma classe com suas variantes acentuadas.
_ACCENT_VARIANTS = {
    "a": "[aàáâãä]",
    "e": "[eèéêë]",
    "i": "[iìíîï]",
    "o": "[oòóôõö]",
    "u": "[uùúûü]",
    "c": "[cç]",
    "n": "[nñ]",
    "A": "[AÀÁÂÃÄ]",
    "E": "[EÈÉÊË]",
    "I": "[IÌÍÎÏ]",
    "O": "[OÒÓÔÕÖ]",
    "U": "[UÙÚÛÜ]",
    "C": "[CÇ]",
    "N": "[NÑ]",
}
_ACCENT_TRANS = str.maketrans(_ACCENT_VARIANTS)


def _accent_insensitive_pattern(text: str) -> str:
    """Escapa o texto e expande letras acentuáveis em classes de caracteres,
    para regex Mongo case/accent-insensitive ('sao paulo' casa 'São Paulo')."""
    return re.escape(text).translate(_ACCENT_TRANS)


router = APIRouter(prefix="/entities", tags=["entities"])


@router.post("", response_model=Entity, status_code=201)
def create_entity(
    entity: EntityCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
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

        db.entities.update_one({"_id": entity.entity_id}, {"$set": doc})

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


def entity_query(entity_id: str) -> dict:
    """Resolve entidades por _id em ambos os formatos coexistentes no banco:
    ObjectId (bulk imports), string (criadas via API) ou campo entity_id (slug)."""
    from bson import ObjectId

    # ordem DETERMINÍSTICA: _id string exato → slug → ObjectId (hex válido)
    # resolve o doc certo quando um slug 24-hex coexiste com um ObjectId
    q = [{"_id": entity_id}, {"entity_id": entity_id}]
    if ObjectId.is_valid(entity_id):
        q.append({"_id": ObjectId(entity_id)})
    return {"$or": q}


def find_entity(db: Database, entity_id: str):
    """Resolução DETERMINÍSTICA por probes sequenciais (_id string → slug →
    _id ObjectId) — o $or do Mongo não garante ordem entre branches."""
    doc = db.entities.find_one({"_id": entity_id})
    if doc:
        return doc
    doc = db.entities.find_one({"entity_id": entity_id})
    if doc:
        return doc
    if ObjectId.is_valid(entity_id):
        return db.entities.find_one({"_id": ObjectId(entity_id)})
    return None


@router.get("/{entity_id}", response_model=Entity)
def get_entity(entity_id: str, db: Database = Depends(get_database)):
    """Get entity by ID"""
    result = find_entity(db, entity_id)

    if not result:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")

    return Entity(**result)


@router.patch("/{entity_id}", response_model=Entity)
def update_entity(
    entity_id: str,
    updates: EntityUpdate,
    if_match: Optional[str] = Header(None, alias="If-Match"),
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """Update entity with optimistic locking"""
    if not if_match:
        raise HTTPException(status_code=428, detail="If-Match header required")

    try:
        current_version = int(if_match.strip('"'))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid If-Match")

    update_data = {k: v for k, v in updates.model_dump(exclude_unset=True).items() if v is not None}
    update_data["updatedAt"] = datetime.now(timezone.utc)
    update_data["version"] = current_version + 1

    # CAS ordenado: string _id primeiro (determinístico), depois slug, depois
    # ObjectId — 1 round-trip no caso comum; o filtro de version garante o
    # doc certo mesmo com twins
    candidates = [{"_id": entity_id}, {"entity_id": entity_id}]
    if ObjectId.is_valid(entity_id):
        candidates.append({"_id": ObjectId(entity_id)})
    result = None
    for candidate in candidates:
        result = db.entities.find_one_and_update(
            {**candidate, "version": current_version},
            {"$set": update_data},
            return_document=True,
        )
        if result:
            break

    if not result:
        raise HTTPException(status_code=409, detail="Version conflict or not found")

    return Entity(**result)


@router.delete("/{entity_id}", status_code=204)
def delete_entity(
    entity_id: str,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """Delete entity"""
    resolved = find_entity(db, entity_id)
    if not resolved:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")
    result = db.entities.delete_one({"_id": resolved["_id"]})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail=f"Entity {entity_id} not found")

    return None


@router.get("", response_model=PaginatedResponse)
def list_entities(
    type: Optional[str] = Query(None),
    name: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="Filter by entity status (active/archived/...)"),
    city: Optional[str] = Query(
        None,
        description=(
            "Regex case-insensitive em data.address.street e data.address.city "
            "(o bulk import guarda a cidade dentro do street; o campo city só "
            "existe nas entities v3). Sem índice — scan de ~21k docs, ~100ms, "
            "para não custar storage do Atlas."
        ),
    ),
    q: Optional[str] = Query(
        None,
        description="Alias de name — regex case-insensitive no nome (paridade com /curations/search).",
    ),
    since: Optional[str] = Query(None, description="ISO timestamp - only return entities updated after this time"),
    ids: Optional[str] = Query(
        None,
        description=(
            "Comma-separated entity ids (_id string, hex ObjectId ou slug). "
            "Usado pelo pull do collector: busca SÓ as entidades vinculadas "
            "a curadorias locais em vez de paginar as ~21k do acervo "
            "(108 requests → 1)."
        ),
    ),
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
    # isinstance: nos unit tests a função é chamada direto e os defaults
    # são objetos Query (truthy) — só strings viram filtro
    search_name = q if isinstance(q, str) and q else name
    if search_name:
        query["name"] = {"$regex": _accent_insensitive_pattern(search_name), "$options": "i"}
    if status:
        query["status"] = status
    if isinstance(city, str) and city.strip():
        pattern = _accent_insensitive_pattern(city.strip()[:100])
        query["$or"] = [
            {"data.address.street": {"$regex": pattern, "$options": "i"}},
            {"data.address.city": {"$regex": pattern, "$options": "i"}},
        ]

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query["updatedAt"] = {"$gte": since_dt}
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid since timestamp format. Use ISO 8601.")

    if isinstance(ids, str) and ids:
        # ids explícitos: $in com variantes string E ObjectId (hex válido) —
        # cobre _id string, _id ObjectId e slug (campo entity_id), o mesmo
        # padrão do pre-fetch do bulk_upsert. Limite de segurança no tamanho.
        # isinstance: chamadas DIRETAS (testes) recebem o default Query(...)
        # como objeto — sem o guard, .split() estoura.
        id_list = [i.strip() for i in ids.split(",") if i.strip()][:500]
        variants = list(id_list)
        for eid in id_list:
            if ObjectId.is_valid(eid):
                variants.append(ObjectId(eid))
        query["$or"] = [
            {"_id": {"$in": variants}},
            {"entity_id": {"$in": id_list}},
        ]

    # count_documents is only needed for offset-based callers; skip it for cursor mode
    if after_id:
        # Cursor por _id com TRANSIÇÃO DE SEGMENTO: strings ordenam antes de
        # ObjectId no Mongo, então um $gt contra string nunca alcança os _ids
        # ObjectId (471 entities ficavam invisíveis). resolve_after_id só
        # desambigua hex-que-é-ObjectId (probe); página VAZIA no fim do
        # segmento de strings tenta o segmento ObjectId.
        query["_id"] = {"$gt": resolve_after_id(db, "entities", after_id)}
        total = -1  # unknown / not computed — saves a full collection scan
        docs = list(db.entities.find(query).sort("_id", 1).limit(limit))
        if not docs and isinstance(query["_id"]["$gt"], str):
            transition = dict(query)
            transition["_id"] = {"$gt": ObjectId("0" * 24)}
            docs = list(db.entities.find(transition).sort("_id", 1).limit(limit))
        items = []
        for doc in docs:
            doc["_id"] = str(doc["_id"])
            items.append(Entity(**doc))
        return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)

    total = db.entities.count_documents(query)
    cursor = db.entities.find(query).sort("_id", 1).skip(offset).limit(limit)

    items = []
    for doc in cursor:
        try:
            doc["_id"] = str(doc["_id"])
            items.append(Entity(**doc))
        except Exception as e:
            # doc malformado não pode 500ar a página (sync ficaria preso)
            logger.warning("entity malformada pulada na listagem: %s", e)
            continue

    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.post("/bulk", response_model=BulkOperationResponse, status_code=200)
def bulk_upsert_entities(
    request: Request,
    payload: BulkEntityCreate,
    db: Database = Depends(get_database),
    auth: dict = Depends(verify_auth),
):
    """Bulk upsert entities (create or update) — max 500 per call.

    Each item is processed independently. Errors are collected per item and
    returned in the response so the caller can decide how to retry.

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
            # Unique index collision (e.g. duplicate place_id) — update existing
            try:
                db.entities.update_one({"_id": entity.entity_id}, {"$set": doc})
            except Exception:
                pass
            updated += 1
        except Exception as exc:
            errors.append(BulkItemError(index=idx, id=entity.entity_id, error=str(exc)))

    return BulkOperationResponse(
        created=created,
        updated=updated,
        skipped=0,
        errors=errors,
        total_received=len(payload.entities),
    )
