"""
Concierge Collector API V3 - Professional FastAPI Implementation
Main application entry point with PyMongo (sync) support
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.lifespan import lifespan
from app.core.rate_limit import limiter
from app.api import entities, curations, system, places, places_orchestrate, ai, concepts, auth, llm_gateway, openai_compat, capture, curators, og_image


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

# Attach rate limiter to app state and register its exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global exception handler: log the exception, return a generic 500 message.
# No manual CORS headers here — CORSMiddleware already adds them to every
# response (incl. errors), and manually echoing the Origin header would bypass
# the configured allowlist.
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Return a generic 500 without leaking internal details to the client."""
    from fastapi.responses import JSONResponse
    import logging
    logger = logging.getLogger(__name__)

    logger.error(f"[Global Exception Handler] {type(exc).__name__}: {str(exc)}", exc_info=True)

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
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
app.include_router(openai_compat.router, prefix="/api/v3")
app.include_router(capture.router, prefix="/api/v3")
app.include_router(curators.router, prefix="/api/v3")
app.include_router(og_image.router, prefix="/api/v3")

# ── Root redirects to Capture ─────────────────────────────────────────────
@app.get("/", include_in_schema=False)
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/capture/")


# ── Capture mode static files (served at /capture) ───────────────────────────
_CAPTURE_DIR = Path(__file__).resolve().parents[1] / "capture"
if _CAPTURE_DIR.is_dir():
    app.mount("/capture", StaticFiles(directory=str(_CAPTURE_DIR), html=True), name="capture")


if __name__ == "__main__":
    import uvicorn
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False
    )
