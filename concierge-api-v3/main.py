"""
Concierge Collector API V3 - Professional FastAPI Implementation
Main application entry point with PyMongo (sync) support
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from contextlib import asynccontextmanager
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.core.config import settings
from app.core.database import connect_to_mongo, close_mongo_connection
from app.api import entities, curations, system, places, places_orchestrate, ai, concepts, auth, llm_gateway, openai_compat, places_router, capture

# ---------------------------------------------------------------------------
# Rate limiter — keyed by client IP
# Default limits (can be overridden per-endpoint with @limiter.limit):
#   - Read endpoints: 300 requests / minute
#   - Write/AI endpoints: 60 requests / minute
#   - Bulk endpoints: 20 requests / minute
# ---------------------------------------------------------------------------
limiter = Limiter(key_func=get_remote_address, default_limits=["300/minute"])


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
app.include_router(places_router.router, prefix="/api/v3")
app.include_router(places_orchestrate.router, prefix="/api/v3")
app.include_router(ai.router, prefix="/api/v3")
app.include_router(concepts.router, prefix="/api/v3")
app.include_router(llm_gateway.router, prefix="/api/v3")
app.include_router(openai_compat.router, prefix="/api/v3")
app.include_router(capture.router, prefix="/api/v3")

# ── Splash page: choose between Collector and Capture ────────────────────────
@app.get("/", include_in_schema=False)
async def splash():
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content="""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Concierge</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  --limestone: #F5F2EC;
  --surface: #FFFFFF;
  --ink: #1A1817;
  --olive: #5C6B4A;
  --olive-dim: #4A573C;
  --stone: #D4CFC7;
  --muted: #8B8680;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{
  font-family:'DM Sans',-apple-system,sans-serif;
  font-weight:400;
  color:var(--ink);
  background:var(--limestone);
  min-height:100dvh;
  display:flex;justify-content:center;align-items:center;
  -webkit-font-smoothing:antialiased;padding:24px
}
.splash{
  text-align:center;
  max-width:420px;
  width:100%
}
.splash__wordmark{
  font-family:'Cormorant Garamond','Times New Roman',serif;
  font-weight:600;
  font-size:36px;
  color:var(--ink);
  letter-spacing:-0.02em;
  margin-bottom:4px
}
.splash__sub{
  font-size:15px;
  color:var(--muted);
  margin-bottom:48px;
  line-height:1.5
}
.splash__cards{
  display:flex;flex-direction:column;gap:14px;margin-bottom:48px
}
.splash__card{
  display:flex;align-items:center;gap:16px;
  padding:20px 24px;
  border-radius:16px;
  background:var(--surface);
  border:1px solid var(--stone);
  text-decoration:none;
  color:var(--ink);
  text-align:left;
  transition:border-color .2s,box-shadow .2s,transform .15s;
  box-shadow:0 1px 3px rgba(0,0,0,.04),0 4px 12px rgba(0,0,0,.04)
}
.splash__card:hover{
  border-color:var(--olive);
  box-shadow:0 2px 6px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.08);
  transform:translateY(-1px)
}
.splash__card-icon{
  flex-shrink:0;
  width:48px;height:48px;
  border-radius:12px;
  display:flex;align-items:center;justify-content:center;
  font-size:22px
}
.splash__card-icon--capture{
  background:color-mix(in srgb,var(--olive) 12%,transparent);
  color:var(--olive)
}
.splash__card-icon--collector{
  background:color-mix(in srgb,var(--muted) 10%,transparent);
  color:var(--muted)
}
.splash__card-title{
  font-weight:600;font-size:17px;margin-bottom:2px
}
.splash__card-desc{
  font-size:13px;color:var(--muted);line-height:1.4
}
.splash__footer{
  font-size:12px;color:var(--muted)
}
.splash__footer a{color:var(--muted);text-decoration:underline}
@media(prefers-reduced-motion:reduce){.splash__card{transition:none}}
</style>
</head>
<body>
<div class="splash">
  <h1 class="splash__wordmark">Concierge</h1>
  <p class="splash__sub">Restaurant knowledge, captured.</p>

  <div class="splash__cards">
    <a href="/capture" class="splash__card">
      <span class="splash__card-icon splash__card-icon--capture">&#127908;</span>
      <span>
        <div class="splash__card-title">Capture</div>
        <div class="splash__card-desc">Fale sobre restaurantes &mdash; a IA identifica e organiza.</div>
      </span>
    </a>

    <a href="/app" class="splash__card">
      <span class="splash__card-icon splash__card-icon--collector">&#9776;</span>
      <span>
        <div class="splash__card-title">Collector</div>
        <div class="splash__card-desc">Navegue, filtre e edite suas curadorias.</div>
      </span>
    </a>
  </div>

  <p class="splash__footer"><a href="/auth/google">Sign in with Google</a></p>
</div>
</body>
</html>""")


# ── Legacy Collector (served at /app from project root) ──────────────────────
_LEGACY_DIR = Path(__file__).resolve().parents[1]
if _LEGACY_DIR.is_dir():
    app.mount("/app", StaticFiles(directory=str(_LEGACY_DIR), html=True), name="legacy")


# ── Capture mode static files (served at /capture) ───────────────────────────
_CAPTURE_DIR = Path(__file__).resolve().parents[1] / "capture"
if _CAPTURE_DIR.is_dir():
    app.mount("/capture", StaticFiles(directory=str(_CAPTURE_DIR), html=True), name="capture")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
