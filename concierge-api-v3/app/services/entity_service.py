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


def upsert_entity(db: Database, entity: EntityCreate) -> Entity:
    """Create new entity or update if exists (merge de data + version+1)."""
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
