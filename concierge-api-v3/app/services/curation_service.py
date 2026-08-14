"""
Curation write service — ÚNICA fronteira de escrita de curations.

Extraído de app/api/curations.py (ago/2026, auditoria): o AI Orchestrator
fazia db.curations.insert_one() direto, pulando entity check, denormalização,
timestamps/version, normalização de curator, IDOR de ownership e o guard de
twins. Agora o router E o orchestrator passam por create_curation_doc.
"""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import HTTPException, status
from pydantic import ValidationError  # noqa: F401  (paridade com o router)
from pymongo.database import Database
from pymongo.errors import DuplicateKeyError

from app.api.entities import find_entity
from app.core.security import is_admin_auth
from app.models.schemas import Curation, CurationCreate
from app.services.curation_denorm import denormalize_curation_location

logger = logging.getLogger(__name__)

CURATION_RESPONSE_PROJECTION = {
    "embeddings": 0,
    "embeddings_metadata": 0,
}


def _normalize_curator_id(doc):
    """Sincroniza top-level: curator.id embutido REAL é autoritativo e o
    placeholder 'unknown'/'' (sync sem usuário) não fica no curator_id.
    O reparo completo (contra o valor armazenado) é _repair_curator_identity
    (que segue em curations.py — lógica de update/bulk)."""
    curator = doc.get("curator") or {}
    cur_id = doc.get("curator_id")
    if (not cur_id or str(cur_id).lower() == "unknown") and curator.get("id"):
        doc["curator_id"] = curator["id"]
    return doc


def _is_placeholder_identity(value):
    """Placeholder de identidade do sync offline: None, '' ou 'unknown'
    (case-insensitive). Qualquer outro valor é identidade real."""
    return value is None or str(value).strip().lower() in ("", "unknown")


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


def create_curation_doc(db: Database, curation: CurationCreate, auth: dict) -> Curation:
    """Cria uma curation com TODAS as regras de domínio (mesmo caminho do
    POST /curations): entity check, denormalização, timestamps/version,
    normalização de curator, IDOR de ownership e guard de twins."""
    # Verify entity exists (skip for orphaned curations) — find_entity
    # resolve ObjectId/string/slug (os 471 ObjectId não-linkáveis)
    entity = None
    if curation.entity_id:
        entity = find_entity(db, curation.entity_id)
        if not entity:
            raise HTTPException(status_code=404, detail=f"Entity {curation.entity_id} not found")

    # Prepare document
    doc = curation.model_dump()
    if curation.entity_id and entity:
        doc.update(denormalize_curation_location(entity))
    doc["_id"] = curation.curation_id
    doc["createdAt"] = datetime.now(timezone.utc)
    doc["updatedAt"] = datetime.now(timezone.utc)
    doc["version"] = 1
    _normalize_curator_id(doc)

    # ── IDOR: a curadoria é atribuída ao curator_id do corpo — só o próprio
    # usuário autenticado (ou admin via API key/role) pode criar em seu nome.
    # Placeholder de identidade (sync offline, 'unknown'/'') passa: curadoria
    # sem dono, nunca atribuída a terceiro.
    owner = doc.get("curator_id") or (doc.get("curator") or {}).get("id")
    if not is_admin_auth(auth) and not _is_placeholder_identity(owner):
        if owner != auth.get("user"):
            raise HTTPException(
                status_code=403,
                detail="curator_id must match the authenticated user",
            )

    doc["createdBy"] = _clean_created_by(curation, doc)
    doc["updatedBy"] = doc.get("curator_id")

    # Twin guard: um doc ObjectId com o mesmo id pode existir (índice único
    # é type-aware) — insert às cegas criaria um duplicado silencioso
    if find_curation(db, curation.curation_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Curation {curation.curation_id} already exists",
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
                detail=f"Curation {curation.curation_id} already exists",
            )
        raise

    # Return created curation
    result = db.curations.find_one({"_id": curation.curation_id}, CURATION_RESPONSE_PROJECTION)
    return Curation(**result)
