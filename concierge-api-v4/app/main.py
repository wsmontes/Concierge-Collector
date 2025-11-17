"""
app/main.py

Purpose: FastAPI application initialization and configuration
Responsibilities:
  - Create FastAPI app instance
  - Configure CORS
  - Register routers
  - Handle startup/shutdown events
  - Provide health check endpoint
Dependencies: FastAPI, uvicorn
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.core.config import settings
from app import database
from app.routes import entities, curations, sync, auth

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


# Lifespan context manager for startup/shutdown events
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifecycle management for the FastAPI application
    
    Startup:
      - Connect to MongoDB
      - Create indexes
    
    Shutdown:
      - Close MongoDB connection
    """
    # Startup
    logger.info("🚀 Starting Concierge API V4...")
    try:
        await database.connect_to_mongo()
        logger.info("✅ Application startup complete")
    except Exception as e:
        logger.error(f"❌ Failed to start application: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("👋 Shutting down Concierge API V4...")
    await database.close_mongo_connection()
    logger.info("✅ Application shutdown complete")


# Create FastAPI app
app = FastAPI(
    title="Concierge API V4",
    description="Modern FastAPI + MongoDB backend for Concierge Collector - Entity-Curation data storage",
    version="4.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(entities.router)
app.include_router(curations.router)
app.include_router(sync.router)


# Health check endpoint
@app.get("/health", tags=["health"])
async def health_check():
    """
    Health check endpoint
    
    Returns:
        Status of the API and database connection
    """
    try:
        # Test database connection
        db = database.get_database()
        await db.command("ping")
        
        return {
            "status": "healthy",
            "version": "4.0.0",
            "database": "connected",
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return {
            "status": "unhealthy",
            "version": "4.0.0",
            "database": "disconnected",
            "error": str(e),
        }


# Root endpoint
@app.get("/", tags=["root"])
async def root():
    """
    Root endpoint with API information
    """
    return {
        "name": "Concierge API V4",
        "version": "4.0.0",
        "description": "Modern FastAPI + MongoDB backend for Concierge Collector",
        "architecture": "Entity-Curation Model",
        "docs": "/docs",
        "redoc": "/redoc",
        "health": "/health",
    }


# Run with: uvicorn app.main:app --reload --port 8000
if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
        log_level=settings.log_level.lower(),
    )
