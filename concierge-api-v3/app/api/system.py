"""
System endpoints - Health check and API info
"""

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from datetime import datetime, timezone
from pymongo.database import Database

from app.models.schemas import HealthResponse, ReadyResponse, APIInfo
from app.core.database import get_database, get_index_state
from app import __version__

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health_check(db: Database = Depends(get_database)):
    """Health check with database connectivity test"""
    try:
        db.command("ping")
        db_status = "connected"
    except Exception:
        # Não vazar detalhes internos do Mongo (strings de conexão, erros de
        # auth) em um endpoint público — status genérico é suficiente.
        db_status = "error"

    return HealthResponse(status="healthy", timestamp=datetime.now(timezone.utc), database=db_status)


@router.get("/ready", response_model=ReadyResponse)
def readiness_check(db: Database = Depends(get_database)):
    """Readiness check — 503 quando Mongo inacessível OU índice falhou.

    /health é LIVENESS e permanece 200 sempre (contrato do health check do
    Render — não apontar o Render para cá, senão restart loop). /ready é a
    readiness para monitoramento automático: o deploy não pode parecer
    saudável com índice estrutural ausente (incidente 2026-08-12).
    """
    try:
        db.command("ping")
        db_status = "connected"
    except Exception:
        db_status = "error"

    indexes = get_index_state()
    ok = db_status == "connected" and indexes.get("failed", 0) == 0
    payload = ReadyResponse(status="ready" if ok else "not_ready", database=db_status, indexes=indexes)
    if not ok:
        return JSONResponse(status_code=503, content=payload.model_dump())
    return payload


@router.get("/info", response_model=APIInfo)
def get_info():
    """Get API information"""
    return APIInfo(
        name="Concierge Collector API",
        version=__version__,
        description="Professional FastAPI implementation with MongoDB",
    )
