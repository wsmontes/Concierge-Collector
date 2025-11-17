"""
System endpoints - Health check and API info
Professional FastAPI implementation
"""

from fastapi import APIRouter, Depends
from datetime import datetime, timezone

from app.models.schemas import HealthResponse, APIInfo
from app.core.database import get_database
from motor.motor_asyncio import AsyncIOMotorDatabase
from app import __version__

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthResponse)
async def health_check(db: AsyncIOMotorDatabase = Depends(get_database)):
    """Health check endpoint with database connectivity test"""
    try:
        # Test database connection
        await db.command("ping")
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
    
    return HealthResponse(
        status="healthy",
        timestamp=datetime.now(timezone.utc),
        database=db_status
    )


@router.get("/info", response_model=APIInfo)
async def get_info():
    """Get API information"""
    return APIInfo(
        name="Concierge Collector API",
        version=__version__,
        description="Professional FastAPI implementation with MongoDB"
    )
