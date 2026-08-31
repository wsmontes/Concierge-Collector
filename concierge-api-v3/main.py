"""
Concierge Collector API V3 - Professional FastAPI Implementation
Main application entry point with PyMongo (sync) support
"""

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.feature_flags import collection_flag_dependency
from app.core.lifespan import lifespan
from app.core.rate_limit import limiter
from app.core.security import require_role
from app.core.observability import install_log_redaction, request_context_middleware
from app.core.provider_response_sanitization import places_provider_response_middleware
from app.api import (
    entities,
    curations,
    system,
    places,
    ai,
    concepts,
    auth,
    cms_auth,
    llm_gateway,
    openai_compat,
    capture,
    catalog,
    internal_curations,
    internal_consumer_usage,
    curators,
    og_image,
    metrics,
    collection_associations,
    distribution,
)

app = FastAPI(
    title="Concierge Collector API V3",
    version="3.0.0",
    description="Professional async API with MongoDB support for entity and curation management",
    lifespan=lifespan,
    docs_url="/api/v3/docs",
    redoc_url="/api/v3/redoc",
    openapi_url="/api/v3/openapi.json",
    redirect_slashes=False,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
install_log_redaction()
app.middleware("http")(request_context_middleware)
app.middleware("http")(places_provider_response_middleware)


def _cors_origins_safe(origins=None):
    """Return explicit credentialed CORS origins; wildcard is fail-closed."""
    if origins is None:
        origins = list(settings.cors_origins_list)
        admin_origin = (settings.cms_admin_origin or "").strip()
        if admin_origin and admin_origin not in origins:
            origins.append(admin_origin)
    if "*" in origins:
        raise RuntimeError(
            "CORS_ORIGINS contém '*' — inseguro com allow_credentials=True; "
            "liste origins explícitas (ou vazio para API-only)"
        )
    return origins


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins_safe(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def sanitized_http_exception_handler(request: Request, exc: HTTPException):
    """Preserve domain/client errors while redacting unexpected server 5xx details."""
    safe_feature_disabled = (
        exc.status_code == 503
        and isinstance(exc.detail, dict)
        and exc.detail.get("code") == "feature_disabled"
        and isinstance(exc.detail.get("flag"), str)
    )
    if exc.status_code < 500 or safe_feature_disabled:
        return await http_exception_handler(request, exc)

    from fastapi.responses import JSONResponse
    import logging

    logger = logging.getLogger(__name__)
    logger.error(
        "[HTTP Exception] Redacted server error status=%s path=%s",
        exc.status_code,
        request.url.path,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": "Internal server error"},
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Return a generic 500 without leaking internal details to the client."""
    from fastapi.responses import JSONResponse
    import logging

    logger = logging.getLogger(__name__)
    logger.error(f"[Global Exception Handler] {type(exc).__name__}: {str(exc)}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# Provider-backed/internal-data routers receive a live authorization gate at
# the mount boundary. The LLM Gateway keeps its public /health endpoint and
# applies live auth per paid endpoint.
_live_viewer = [Depends(require_role("viewer"))]
_cms_auth_enabled = [Depends(collection_flag_dependency("cms_auth"))]
_catalog_scan_enabled = [Depends(collection_flag_dependency("catalog_scan"))]
_collector_associations_enabled = [Depends(collection_flag_dependency("collector_association_read"))]
_distribution_enabled = [Depends(collection_flag_dependency("collections_distribution"))]

app.include_router(system.router, prefix="/api/v3")
app.include_router(metrics.router, prefix="/api/v3")
app.include_router(cms_auth.router, prefix="/api/v3", dependencies=_cms_auth_enabled)
app.include_router(
    collection_associations.router,
    prefix="/api/v3",
    dependencies=_collector_associations_enabled,
)
app.include_router(distribution.router, prefix="/api/v3", dependencies=_distribution_enabled)
app.include_router(catalog.router, prefix="/api/v3", dependencies=_catalog_scan_enabled)
app.include_router(internal_curations.router, prefix="/api/v3")
app.include_router(internal_consumer_usage.router, prefix="/api/v3")
app.include_router(auth.router, prefix="/api/v3")
app.include_router(entities.router, prefix="/api/v3")
app.include_router(curations.router, prefix="/api/v3", dependencies=_live_viewer)
app.include_router(places.router, prefix="/api/v3", dependencies=_live_viewer)
app.include_router(ai.router, prefix="/api/v3")
app.include_router(concepts.router, prefix="/api/v3")
app.include_router(llm_gateway.router, prefix="/api/v3")
app.include_router(openai_compat.router, prefix="/api/v3", dependencies=_live_viewer)
app.include_router(capture.router, prefix="/api/v3")
app.include_router(curators.router, prefix="/api/v3")
app.include_router(og_image.router, prefix="/api/v3")


@app.get("/", include_in_schema=False)
async def root():
    from fastapi.responses import RedirectResponse

    return RedirectResponse(url="/capture/")


_CAPTURE_DIR = Path(__file__).resolve().parents[1] / "capture"
if _CAPTURE_DIR.is_dir():
    app.mount("/capture", StaticFiles(directory=str(_CAPTURE_DIR), html=True), name="capture")


if __name__ == "__main__":
    import uvicorn
    import os

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
