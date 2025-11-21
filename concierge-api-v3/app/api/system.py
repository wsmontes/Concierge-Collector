"""
System endpoints - Health check and API info
"""

from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from pymongo.database import Database

from app.models.schemas import HealthResponse, APIInfo
from app.core.database import get_database
from app import __version__

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
def health_check(db: Database = Depends(get_database)):
    """Health check with database connectivity test"""
    try:
        db.command("ping")
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
    
    return HealthResponse(
        status="healthy",
        timestamp=datetime.now(timezone.utc),
        database=db_status
    )


@router.get("/info", response_model=APIInfo)
def get_info():
    """Get API information"""
    return APIInfo(
        name="Concierge Collector API",
        version=__version__,
        description="Professional FastAPI implementation with MongoDB"
    )
