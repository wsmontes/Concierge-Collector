"""
Entity write service — ÚNICA fronteira de escrita de entities.

Extraído de app/api/entities.py (ago/2026, auditoria): o AI Orchestrator
gravava direto no Mongo (update_one upsert) pulando o merge de data, os
timestamps e o version+1 do domínio. Agora o router E o orchestrator
passam por este mesmo caminho.
"""

from datetime import datetime, timezone

from pymongo.database import Database

from app.models.schemas import Entity, EntityCreate
from app.services.curation_denorm import denormalize_curation_location


def entity_identity_variants(entity_doc: dict, requested_id: str | None = None) -> list[str]:
    """All string identities that a Curation may legitimately store in entity_id."""
    variants: set[str] = set()
    if requested_id is not None and str(requested_id).strip():
        variants.add(str(requested_id))
    if entity_doc.get("_id") is not None:
        variants.add(str(entity_doc["_id"]))
    if entity_doc.get("entity_id") is not None and str(entity_doc["entity_id"]).strip():
        variants.add(str(entity_doc["entity_id"]))
    return list(variants)


def refresh_linked_curation_projections(
    db: Database,
    entity_doc: dict,
    requested_id: str | None = None,
) -> int:
    """Refresh denormalized Curation city/type from the canonical Entity.

    `restaurant_name` is deliberately untouched: it is captured working-name
    provenance, not a projection of canonical Entity identity.
    """
    if not entity_doc:
        return 0

    variants = entity_identity_variants(entity_doc, requested_id=requested_id)
    if not variants:
        return 0

    projection = denormalize_curation_location(entity_doc)
    result = db.curations.update_many(
        {"entity_id": {"$in": variants}},
        {"$set": projection},
    )
    return int(getattr(result, "modified_count", 0) or 0)


def upsert_entity(db: Database, entity: EntityCreate) -> Entity:
    """Create new entity or update if exists (merge de data + version+1)."""
    existing = db.entities.find_one({"_id": entity.entity_id})

    if existing:
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
        refresh_linked_curation_projections(db, result, requested_id=entity.entity_id)
        return Entity(**result)

    doc = entity.model_dump()
    doc["_id"] = entity.entity_id
    doc["createdAt"] = datetime.now(timezone.utc)
    doc["updatedAt"] = datetime.now(timezone.utc)
    doc["version"] = 1

    db.entities.insert_one(doc)

    result = db.entities.find_one({"_id": entity.entity_id})
    return Entity(**result)
