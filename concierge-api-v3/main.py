"""
Concierge Collector API V3 - Professional FastAPI Implementation
Main application entry point with PyMongo (sync) support
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import settings
from app.core.database import connect_to_mongo, close_mongo_connection
from app.api import entities, curations, system, places, places_orchestrate, ai, concepts, auth, llm_gateway


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Startup
    try:
        connect_to_mongo()
    except Exception as e:
        print(f"⚠️  MongoDB connection failed (continuing without it): {e}")
        print("⚠️  Only Places API endpoints will work")
    yield
    # Shutdown
    close_mongo_connection()


# Create FastAPI application
app = FastAPI(
    title="Concierge Collector API V3",
    version="3.0.0",
    description="Professional async API with MongoDB support for entity and curation management",
    lifespan=lifespan,
    docs_url="/api/v3/docs",  # Swagger UI
    redoc_url="/api/v3/redoc",  # ReDoc
    openapi_url="/api/v3/openapi.json",  # OpenAPI schema
    redirect_slashes=False  # CRITICAL: Disable automatic trailing slash redirects for OAuth
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add exception handler to ensure CORS headers are included in error responses
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Ensure CORS headers are present even on error responses"""
    from fastapi.responses import JSONResponse
    import logging
    logger = logging.getLogger(__name__)
    
    logger.error(f"[Global Exception Handler] {type(exc).__name__}: {str(exc)}")
    
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {str(exc)}"},
        headers={
            "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        }
    )

# Include routers with /api/v3 prefix
app.include_router(system.router, prefix="/api/v3")
app.include_router(auth.router, prefix="/api/v3")
app.include_router(entities.router, prefix="/api/v3")
app.include_router(curations.router, prefix="/api/v3")
app.include_router(places.router, prefix="/api/v3")
app.include_router(places_orchestrate.router, prefix="/api/v3")
app.include_router(ai.router, prefix="/api/v3")
app.include_router(concepts.router, prefix="/api/v3")
app.include_router(llm_gateway.router, prefix="/api/v3")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
