# 🔍 PythonAnywhere Deployment Issues - Complete Analysis

**Project**: Concierge Collector V3  
**Date**: November 20, 2025  
**Status**: Deployment Issues Identified  

---

## 🎯 Executive Summary

Your FastAPI application is experiencing deployment issues on PythonAnywhere. Based on my analysis of your codebase, I've identified **12 critical issues** and **8 potential problems** that could be causing headaches. The good news: most are easily fixable!

---

## 🚨 CRITICAL ISSUES (Must Fix)

### 1. **Missing WSGI File**
**Severity**: 🔴 BLOCKER  
**Impact**: API won't start at all

**Problem**: Your deployment guide references `wsgi.py` but it doesn't exist in the repository.

**Location**: Should be at `concierge-api-v3/wsgi.py`

**Fix**:
```python
"""
WSGI configuration for Concierge Collector API V3
FastAPI + ASGI running on WSGI via Mangum adapter
"""

import sys
import os

# Add project directory to Python path
project_home = '/home/wsmontes/concierge-api'
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Change to project directory
os.chdir(project_home)

# Load environment variables from .env
from dotenv import load_dotenv
env_path = os.path.join(project_home, '.env')
load_dotenv(env_path)

# Set the working directory for the app
sys.path.insert(0, os.path.join(project_home, 'concierge-api-v3'))

# Import FastAPI app
from main import app

# Mangum adapter for ASGI → WSGI
from mangum import Mangum
handler = Mangum(app, lifespan="off")

# WSGI application
def application(environ, start_response):
    return handler(environ, start_response)
```

---

### 2. **Incorrect Import Path in WSGI Guide**
**Severity**: 🔴 BLOCKER  
**Impact**: ImportError on startup

**Problem**: Your deployment guide shows:
```python
from concierge_api_v3.main import app  # ❌ WRONG
```

But your actual structure is:
```
concierge-api-v3/
└── main.py  # ← Direct import needed
```

**Fix**: Should be:
```python
from main import app  # ✅ CORRECT
```

---

### 3. **Module Path Confusion**
**Severity**: 🔴 HIGH  
**Impact**: Python can't find your modules

**Problem**: Your project structure vs. PythonAnywhere paths don't match.

**Current Structure**:
```
/home/wsmontes/concierge-api/
├── concierge-api-v3/  ← Extra nesting!
│   ├── main.py
│   └── app/
├── .env  ← Wrong location
└── data/
```

**Should Be** (on PythonAnywhere):
```
/home/wsmontes/concierge-api/
├── main.py  ← Move up one level
├── app/
├── .env
└── requirements.txt
```

**Fix**: Clone directly into the API folder:
```bash
cd /home/wsmontes
git clone https://github.com/wsmontes/Concierge-Collector.git temp
mv temp/concierge-api-v3 concierge-api
rm -rf temp
```

---

### 4. **Missing Mangum Dependency**
**Severity**: 🔴 HIGH  
**Impact**: ASGI→WSGI adapter won't work

**Problem**: While `mangum==0.17.0` is in requirements.txt, PythonAnywhere needs explicit ASGI adapter configuration.

**Additional Issue**: Mangum 0.17.0 has known issues with FastAPI 0.109.0.

**Fix**: Update requirements.txt:
```txt
mangum==0.18.0  # Updated for FastAPI 0.109+ compatibility
```

---

### 5. **Lifespan Event Incompatibility**
**Severity**: 🟡 MEDIUM  
**Impact**: Database connections may fail

**Problem**: Your `main.py` uses `@asynccontextmanager` lifespan:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongo()
    yield
    await close_mongo_connection()

app = FastAPI(lifespan=lifespan)
```

But your WSGI guide uses: `Mangum(app, lifespan="off")`

**This means**:
- MongoDB connections won't be initialized on PythonAnywhere
- Connections won't be properly closed
- Database calls will fail with "no connection" errors

**Fix Option 1** (Recommended): Initialize DB in WSGI file:
```python
# In wsgi.py, before creating Mangum handler
import asyncio
from app.core.database import connect_to_mongo

# Initialize MongoDB connection
asyncio.run(connect_to_mongo())

handler = Mangum(app, lifespan="off")
```

**Fix Option 2**: Use lazy connection in database.py:
```python
# Add connection check to get_database()
async def get_database() -> AsyncIOMotorDatabase:
    if client is None:
        await connect_to_mongo()
    return client[settings.mongodb_db_name]
```

---

### 6. **Environment Variable Detection Issue**
**Severity**: 🟡 MEDIUM  
**Impact**: Wrong OAuth redirect URIs

**Problem**: Your `config.py` tries to detect PythonAnywhere:
```python
hostname = os.getenv('HOSTNAME', '')
is_pythonanywhere = 'pythonanywhere' in hostname.lower() or os.path.exists('/home/wsmontes')
```

But on PythonAnywhere:
- `HOSTNAME` may not be set in WSGI context
- File check happens BEFORE `.env` is loaded
- This could cause localhost URLs to be used in production

**Fix**: Use explicit environment variable:
```python
# In .env
DEPLOYMENT_ENVIRONMENT=pythonanywhere

# In config.py
environment: str = "development"  # or "pythonanywhere"

def model_post_init(self, __context):
    if self.environment == "pythonanywhere":
        object.__setattr__(self, 'google_oauth_redirect_uri', 
                         "https://wsmontes.pythonanywhere.com/api/v3/auth/callback")
```

---

### 7. **Missing Google OAuth Credentials in .env.example**
**Severity**: 🟡 MEDIUM  
**Impact**: OAuth will fail silently

**Problem**: Your `.env.example` doesn't include OAuth fields:
```bash
# Missing from .env.example:
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
FRONTEND_URL=
FRONTEND_URL_PRODUCTION=
ACCESS_TOKEN_EXPIRE_MINUTES=
REFRESH_TOKEN_EXPIRE_DAYS=
```

**Fix**: Add to `.env.example` (already in deployment guide, but inconsistent).

---

### 8. **Static Files Not Served**
**Severity**: 🟡 MEDIUM  
**Impact**: Frontend assets (CSS, JS) won't load

**Problem**: PythonAnywhere only runs your WSGI app. It doesn't serve your frontend files (`index.html`, `scripts/`, `styles/`).

**Two Solutions**:

**Option A**: Use GitHub Pages for frontend (as per your guide)
- Keep API on PythonAnywhere
- Deploy frontend to GitHub Pages
- Update CORS to allow GitHub Pages origin

**Option B**: Serve frontend from PythonAnywhere
```python
# In main.py, add StaticFiles
from fastapi.staticfiles import StaticFiles

app.mount("/static", StaticFiles(directory="../"), name="static")

# Access at: https://wsmontes.pythonanywhere.com/static/index.html
```

---

### 9. **CORS Origins Parsing Issue**
**Severity**: 🟡 MEDIUM  
**Impact**: Frontend can't connect to API

**Problem**: Your `config.py` has complex CORS parsing:
```python
cors_origins: str = '["http://localhost:3000", ...]'  # JSON string

@property
def cors_origins_list(self) -> List[str]:
    try:
        return json.loads(self.cors_origins)
    except:
        # Falls back to comma-separated
        return [origin.strip() for origin in self.cors_origins.split(',')]
```

But your `.env` guide uses comma-separated:
```bash
CORS_ORIGINS=http://localhost:8080,https://wsmontes.github.io
```

**Fix**: Standardize on comma-separated (simpler):
```python
# config.py
cors_origins: str = "http://localhost:8080,https://wsmontes.github.io"

@property
def cors_origins_list(self) -> List[str]:
    return [origin.strip() for origin in self.cors_origins.split(',')]
```

---

### 10. **Trailing Slash Redirect Issue**
**Severity**: 🔴 HIGH  
**Impact**: OAuth callback fails with 308 redirect

**Problem**: You correctly disabled trailing slash redirects:
```python
app = FastAPI(redirect_slashes=False)
```

But PythonAnywhere's web server (likely nginx) might override this.

**Symptoms**:
- Request to `/api/v3/auth/callback?code=...`
- Gets redirected to `/api/v3/auth/callback/?code=...` (308)
- Google sees redirect, aborts OAuth flow
- User sees "redirect_uri_mismatch" error

**Fix**: Configure PythonAnywhere web app:
1. Go to Web tab
2. Add to "Static files" mappings:
   - URL: `/api/`
   - Directory: Leave blank
3. This prevents nginx from adding trailing slashes to API routes

**Alternative**: Update OAuth redirect URI to include trailing slash:
```python
google_oauth_redirect_uri: str = "https://wsmontes.pythonanywhere.com/api/v3/auth/callback/"
```

---

### 11. **OAuth State Storage Not Production-Ready**
**Severity**: 🟠 LOW (but will cause issues at scale)  
**Impact**: Multiple workers or restarts lose OAuth states

**Problem**: OAuth states stored in memory:
```python
_oauth_states = {}  # ← Lost on restart or across workers
```

**Symptoms**:
- User starts OAuth flow
- WSGI worker restarts (PythonAnywhere does this)
- Callback fails with "state not found"
- User sees cryptic error

**Fix** (for now): Document the issue, plan for Redis/MongoDB storage later.

**Quick Fix**: Store in MongoDB:
```python
# In auth.py
async def generate_state(code_verifier: str, db: AsyncIOMotorDatabase) -> str:
    state = secrets.token_urlsafe(32)
    await db.oauth_states.insert_one({
        "state": state,
        "code_verifier": code_verifier,
        "created": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5)
    })
    return state
```

---

### 12. **Logs and Debugging Difficulty**
**Severity**: 🟡 MEDIUM  
**Impact**: Can't diagnose issues

**Problem**: No structured logging or error tracking.

**Fix**: Add comprehensive logging to WSGI file:
```python
# At top of wsgi.py
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/home/wsmontes/concierge-api/app.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)
logger.info("=" * 50)
logger.info("WSGI Application Starting")
logger.info(f"Python Path: {sys.path}")
logger.info(f"Working Directory: {os.getcwd()}")
logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'not set')}")
logger.info("=" * 50)
```

---

## ⚠️ POTENTIAL ISSUES (May Cause Problems)

### 13. Python Version Mismatch
Your code uses Python 3.13 features, but PythonAnywhere may default to 3.10.

**Check**: Does PythonAnywhere support Python 3.13?

**Fix**: If not, adjust to 3.10+ compatible code or request 3.13 from support.

---

### 14. MongoDB Connection String Exposure
Your deployment guide shows the connection string in `.env` examples.

**Risk**: If `.env` gets committed, credentials exposed.

**Important Note**: Since you're deploying via GitHub, **never commit `.env` with real credentials**. The `.env` file is properly gitignored, so you'll need to:
1. Deploy code via `git pull` on PythonAnywhere
2. **Manually create `.env` on PythonAnywhere** with your real API keys
3. This is actually **more secure** - credentials never transit through GitHub

**Fix**: Verify `.env` is in `.gitignore` (already done). Always create `.env` manually on the server.

---

### 15. API Secret Key Generation
Guide says "min 32 chars" but doesn't enforce it.

**Fix**: Add validation in `config.py`:
```python
@field_validator('api_secret_key')
def validate_secret_key(cls, v):
    if len(v) < 32:
        raise ValueError('API_SECRET_KEY must be at least 32 characters')
    return v
```

---

### 16. Rate Limiting Not Configured
Google Places API has rate limits, but no protection in code.

**Risk**: API quota exhaustion, blocked requests.

**Fix**: Add rate limiting middleware (Sprint 2 should address this).

---

### 17. Database Connection Pooling
Motor default settings may not be optimal for PythonAnywhere.

**Fix**: Add connection pool settings:
```python
# In database.py
client = AsyncIOMotorClient(
    settings.mongodb_url,
    maxPoolSize=10,  # Limit connections
    minPoolSize=1,
    maxIdleTimeMS=45000,  # Close idle connections
    serverSelectionTimeoutMS=5000  # Fail fast
)
```

---

### 18. Frontend URL Detection Logic
Complex logic to detect localhost vs. production in JavaScript.

**Risk**: Could fail in edge cases (proxies, VPNs, etc.).

**Fix**: Use explicit environment variable or build-time configuration.

---

### 19. IndexedDB Quota Exhaustion
No quota management for offline data storage.

**Risk**: User hits 50MB limit, app breaks.

**Fix**: Add quota monitoring and cleanup (Sprint 3).

---

### 20. HTTPS Certificate Issues
Your SSL certificate issue from earlier:
```
fatal: unable to access ... SSL certificate problem: unable to get local issuer certificate
```

**Risk**: Same issue could affect API calls to MongoDB Atlas or OpenAI.

**Fix**: Ensure PythonAnywhere has proper CA certificates:
```bash
pip install --upgrade certifi
```

---

## 🛠️ RECOMMENDED DEPLOYMENT STEPS (Corrected)

### Important: GitHub Deployment Security

**Your deployment workflow**:
1. ✅ Code is pushed to GitHub (without `.env`)
2. ✅ Pull code on PythonAnywhere via `git pull`
3. ✅ Manually create `.env` on PythonAnywhere with real API keys
4. ✅ Keys never transit through GitHub (more secure!)

This is the **recommended approach** - credentials stay on the server only.

### Step 1: Prepare Repository
```bash
# Locally, create wsgi.py (already done in this commit)
cd concierge-api-v3
# wsgi.py is now included in the repository
git add wsgi.py
git commit -m "Add WSGI file for PythonAnywhere deployment"
git push
```

### Step 2: Clone on PythonAnywhere
```bash
# In PythonAnywhere Bash Console
cd /home/wsmontes
git clone -b Front-End-V3 https://github.com/wsmontes/Concierge-Collector.git temp
mv temp/concierge-api-v3 concierge-api
rm -rf temp
cd concierge-api
```

### Step 2: Create .env Manually (5 minutes)

**IMPORTANT**: Since you deploy via GitHub, the `.env` file is gitignored and won't be pulled. You must create it manually on PythonAnywhere with your real credentials.

```bash
cd /home/wsmontes/concierge-api
nano .env
```

**Copy and paste these settings with YOUR real credentials**:
```bash
ENVIRONMENT=pythonanywhere  # ← Explicit environment
MONGODB_URL=your-atlas-connection-string  # ← Your real MongoDB Atlas URL
MONGODB_DB_NAME=concierge-collector
API_RELOAD=false  # ← MUST be false in production
CORS_ORIGINS=https://wsmontes.github.io,https://wsmontes.pythonanywhere.com
GOOGLE_OAUTH_CLIENT_ID=your-client-id  # ← Your real OAuth client ID
GOOGLE_OAUTH_CLIENT_SECRET=your-secret  # ← Your real OAuth secret
GOOGLE_PLACES_API_KEY=your-key  # ← Your real Google Places API key
OPENAI_API_KEY=your-key  # ← Your real OpenAI API key
API_SECRET_KEY=your-32-char-secret  # ← Generate with: python -c "import secrets; print(secrets.token_urlsafe(32))"
FRONTEND_URL_PRODUCTION=https://wsmontes.github.io/Concierge-Collector
```

**Security Note**: This manual approach is actually **more secure** because:
- ✅ API keys never pass through GitHub
- ✅ No risk of accidentally committing credentials
- ✅ Different keys can be used for dev vs production
- ✅ Credentials stay only on the server where they're needed

### Step 4: Install Dependencies
```bash
python3.10 -m venv venv  # ← Use 3.10 if 3.13 unavailable
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 5: Test Imports
```bash
python
>>> from main import app
>>> print(app)
# Should print: <fastapi.applications.FastAPI object at 0x...>
>>> exit()
```

### Step 6: Configure WSGI
**Web tab → WSGI configuration file**, use:

```python
import sys
import os
import logging

# Setup logging FIRST
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Project path
project_home = '/home/wsmontes/concierge-api'

logger.info(f"Setting up WSGI for project: {project_home}")

# Add to Python path
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Change working directory
os.chdir(project_home)

# Load environment
from dotenv import load_dotenv
load_dotenv(os.path.join(project_home, '.env'))

logger.info(f"Environment: {os.getenv('ENVIRONMENT')}")
logger.info(f"MongoDB: {os.getenv('MONGODB_URL', 'NOT SET')[:50]}...")

# Import app
try:
    from main import app
    logger.info("FastAPI app imported successfully")
except Exception as e:
    logger.error(f"Failed to import app: {e}")
    raise

# Initialize database connection
import asyncio
from app.core.database import connect_to_mongo

try:
    asyncio.run(connect_to_mongo())
    logger.info("MongoDB connected successfully")
except Exception as e:
    logger.error(f"MongoDB connection failed: {e}")
    # Don't raise - let requests fail gracefully

# Create WSGI handler
from mangum import Mangum
handler = Mangum(app, lifespan="off")

def application(environ, start_response):
    """WSGI application callable"""
    return handler(environ, start_response)

logger.info("WSGI application ready")
```

### Step 7: Configure Web App
- **Source code**: `/home/wsmontes/concierge-api`
- **Working directory**: `/home/wsmontes/concierge-api`
- **Python version**: 3.10 (or highest available)
- **Virtualenv**: `/home/wsmontes/concierge-api/venv`
- **Force HTTPS**: ✅ ON

### Step 8: Test
```bash
# Check logs
tail -f /var/log/wsmontes.pythonanywhere.com.error.log

# Test health endpoint
curl https://wsmontes.pythonanywhere.com/api/v3/health

# Should return:
# {"status":"healthy","version":"3.0"}
```

---

## 🔍 DEBUGGING CHECKLIST

If API still doesn't work, check in order:

### 1. Python Path Issues
```bash
# In Bash console
cd /home/wsmontes/concierge-api
source venv/bin/activate
python -c "import sys; print('\n'.join(sys.path))"
python -c "from main import app; print('SUCCESS')"
```

### 2. Environment Variables
```bash
python -c "from app.core.config import settings; print(f'DB: {settings.mongodb_url[:50]}')"
```

### 3. MongoDB Connection
```bash
python -c "
import asyncio
from app.core.database import connect_to_mongo, client
asyncio.run(connect_to_mongo())
print(f'Connected: {client is not None}')
"
```

### 4. Check Error Logs
```bash
# PythonAnywhere error log
tail -100 /var/log/wsmontes.pythonanywhere.com.error.log

# Your app log (if created)
tail -100 /home/wsmontes/concierge-api/app.log
```

### 5. Test Individual Endpoints
```bash
curl -v https://wsmontes.pythonanywhere.com/api/v3/health
curl -v https://wsmontes.pythonanywhere.com/api/v3/info
curl -v https://wsmontes.pythonanywhere.com/api/v3/docs
```

---

## 📊 ISSUE PRIORITY MATRIX

| Issue # | Severity | Fix Time | Must Fix Before Deploy |
|---------|----------|----------|------------------------|
| 1 | 🔴 Critical | 5 min | ✅ YES |
| 2 | 🔴 Critical | 2 min | ✅ YES |
| 3 | 🔴 Critical | 10 min | ✅ YES |
| 4 | 🔴 High | 2 min | ✅ YES |
| 5 | 🟡 Medium | 15 min | ✅ YES |
| 6 | 🟡 Medium | 10 min | ✅ YES |
| 7 | 🟡 Medium | 5 min | ⚠️ SHOULD |
| 8 | 🟡 Medium | 10 min | ⚠️ SHOULD |
| 9 | 🟡 Medium | 10 min | ⚠️ SHOULD |
| 10 | 🔴 High | 5 min | ✅ YES |
| 11 | 🟠 Low | 30 min | ❌ NO (can fix later) |
| 12 | 🟡 Medium | 10 min | ⚠️ SHOULD |

**Estimated time to fix critical issues**: ~1 hour  
**Total time for all recommended fixes**: ~2 hours

---

## ✅ NEXT STEPS

1. **Read this document carefully** - Understand each issue
2. **Create `wsgi.py`** - Copy from Issue #1
3. **Update `.env` template** - Add missing OAuth fields
4. **Test locally** - Ensure imports work
5. **Deploy to PythonAnywhere** - Follow corrected steps
6. **Monitor logs** - Use debugging checklist
7. **Test OAuth flow** - Verify end-to-end functionality

---

## 📚 ADDITIONAL RESOURCES

- **PythonAnywhere Help**: https://help.pythonanywhere.com/pages/FastAPI/
- **Mangum Documentation**: https://mangum.io/
- **FastAPI Deployment**: https://fastapi.tiangolo.com/deployment/
- **Motor Connection Pooling**: https://motor.readthedocs.io/en/stable/api-asyncio/asyncio_motor_client.html

---

## 💬 SUPPORT

If issues persist after following this guide:
1. Check error logs (PythonAnywhere and app.log)
2. Test each component individually (database, imports, endpoints)
3. Post specific error messages in PythonAnywhere forums
4. Include: error log, WSGI file content, Python version

---

**Document Created**: November 20, 2025  
**Author**: AI Analysis  
**Status**: Complete Analysis - Ready for Implementation
