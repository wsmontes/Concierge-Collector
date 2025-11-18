"""
Concierge Collector API V3 - Professional FastAPI Implementation
Main application entry point with async MongoDB support
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import connect_to_mongo, close_mongo_connection
from app.api import entities, curations, system, places, ai


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Startup
    await connect_to_mongo()
    yield
    # Shutdown
    await close_mongo_connection()


# Create FastAPI application
app = FastAPI(
    title="Concierge Collector API V3",
    version="3.0.0",
    description="Professional async API with MongoDB support for entity and curation management",
    lifespan=lifespan,
    docs_url="/api/v3/docs",  # Swagger UI
    redoc_url="/api/v3/redoc",  # ReDoc
    openapi_url="/api/v3/openapi.json"  # OpenAPI schema
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers with /api/v3 prefix
app.include_router(system.router, prefix="/api/v3")
app.include_router(entities.router, prefix="/api/v3")
app.include_router(curations.router, prefix="/api/v3")
app.include_router(places.router, prefix="/api/v3")
app.include_router(ai.router, prefix="/api/v3")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
