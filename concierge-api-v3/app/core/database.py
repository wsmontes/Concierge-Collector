"""
MongoDB database connection - PyMongo driver
Follows official MongoDB documentation exactly
"""

from pymongo import MongoClient
from pymongo.database import Database
import logging

from app.core.config import settings
from app.core.index_specs import INDEX_SPECS

logger = logging.getLogger(__name__)

# Global client
_client: MongoClient = None

# Estado da criação de índices no startup — consumido pelo /ready (readiness).
# Falha de índice estrutural NÃO pode manter o deploy "verde" em silêncio
# (incidente 2026-08-12: entities ficou com 4 de 10 índices sem alarme).
index_state = {"created": 0, "failed": 0, "failed_details": []}


def get_index_state() -> dict:
    """Snapshot do estado de índices para o endpoint /ready."""
    return {
        "created": index_state["created"],
        "failed": index_state["failed"],
        "failed_details": list(index_state["failed_details"]),
    }


def connect_to_mongo():
    """Connect to MongoDB - called at startup"""
    global _client

    logger.info("Connecting to MongoDB...")

    # Per MongoDB docs: pass connection string only
    _client = MongoClient(settings.mongodb_url)

    # Test connection
    _client.admin.command("ping")
    logger.info(f"✅ MongoDB connected: {settings.mongodb_db_name}")

    # Create indexes
    _ensure_indexes()


def close_mongo_connection():
    """Close MongoDB connection - called at shutdown"""
    if _client:
        _client.close()
        logger.info("✅ MongoDB closed")


def get_database() -> Database:
    """Get database instance"""
    if _client is None:
        raise RuntimeError("MongoDB not connected")
    return _client[settings.mongodb_db_name]


def _ensure_indexes():
    """Create indexes if they don't exist — one try/except PER INDEX.

    Incidente 2026-08-12: um try/except único em volta de tudo fazia o primeiro
    índice que falhasse (ex.: unique 'externalId' com duplicatas de bulk
    imports) abortar SILENCIOSAMENTE os demais — em produção entities ficou com
    4 de 10 índices e curations só com _id_."""
    db = get_database()

    # ── Curations collection: drop legacy unique index on entity_id ─────────
    try:
        indexes = db.curations.index_information()
        for name, meta in indexes.items():
            if "key" in meta and meta["key"] == [("entity_id", 1)] and meta.get("unique") is True:
                logger.warning(f"Found legacy unique index '{name}' on entity_id - Dropping...")
                db.curations.drop_index(name)
                logger.info("✅ Dropped legacy unique index")
                break
    except Exception as e:
        logger.warning(f"Error checking legacy indexes: {e}")

    # Fonte única das specs: app/core/index_specs.py (mesma lista que o
    # db_rebuild usa no restore). O TTL de capture_sessions fica de fora —
    # é criado pelo lifespan.py.
    specs = [s for s in INDEX_SPECS if s[0] != "capture_sessions"]

    created, failed = 0, 0
    failed_details = []
    for coll_name, keys, kwargs in specs:
        try:
            getattr(db, coll_name).create_index(keys, background=True, **kwargs)
            created += 1
        except Exception as e:
            failed += 1
            failed_details.append({"collection": coll_name, "keys": str(keys), "error": str(e)})
            # ERROR (não warning): índice estrutural ausente degrada consulta —
            # o /ready precisa enxergar e o log do Render precisa alarmar
            logger.error(f"Index creation failed on {coll_name} {keys}: {e}")

    index_state["created"] = created
    index_state["failed"] = failed
    index_state["failed_details"] = failed_details

    logger.info(f"✅ Indexes ready ({created} created, {failed} failed)")
