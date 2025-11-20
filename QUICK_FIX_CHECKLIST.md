# 🚀 PythonAnywhere Deployment - Quick Fix Checklist

**Status**: Issues Identified & Fixes Prepared  
**Date**: November 20, 2025

---

## ✅ IMMEDIATE ACTIONS (Do These First)

### 1. Commit WSGI File (2 minutes)
```bash
cd C:\workspace\_archive\_TEST\c\Concierge-Collector
git add concierge-api-v3/wsgi.py
git add PYTHONANYWHERE_ISSUES_ANALYSIS.md
git commit -m "fix: Add missing WSGI file and comprehensive issue analysis for PythonAnywhere deployment"
git push
```

### 2. Update .env Template (2 minutes)
Add these missing fields to `concierge-api-v3/.env.example`:
```bash
# Google OAuth Configuration (MISSING from current .env.example)
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret

# Frontend URLs
FRONTEND_URL=http://localhost:8080
FRONTEND_URL_PRODUCTION=https://wsmontes.github.io/Concierge-Collector

# JWT Token Settings
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30
```

### 3. Fix Config Environment Detection (5 minutes)
The current environment detection is unreliable. Use explicit config instead.

**In concierge-api-v3/.env on PythonAnywhere**:
```bash
ENVIRONMENT=production  # or "pythonanywhere"
```

---

## 🔧 ON PYTHONANYWHERE

### Step 1: Redeploy with Fixes (5 minutes)
```bash
# SSH into PythonAnywhere Bash Console
cd /home/wsmontes/concierge-api
git pull origin Front-End-V3

# Verify wsgi.py exists
ls -la wsgi.py
# Should show: wsgi.py with ~120 lines
```

### Step 2: Update .env (3 minutes)
```bash
nano .env
```

**Critical additions**:
```bash
# Add this line at the top
ENVIRONMENT=production

# Verify these exist:
GOOGLE_OAUTH_CLIENT_ID=your-actual-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-actual-secret
FRONTEND_URL_PRODUCTION=https://wsmontes.github.io/Concierge-Collector
```

Save: `Ctrl+O`, Enter, `Ctrl+X`

### Step 3: Update WSGI Configuration (5 minutes)
**PythonAnywhere Web Tab → WSGI configuration file**

**Replace entire content** with:
```python
import sys
import os
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Project path
project_home = '/home/wsmontes/concierge-api'
logger.info(f"Initializing WSGI for: {project_home}")

# Add to sys.path
if project_home not in sys.path:
    sys.path.insert(0, project_home)

# Change directory
os.chdir(project_home)

# Load .env
from dotenv import load_dotenv
load_dotenv(os.path.join(project_home, '.env'))
logger.info(f"Environment: {os.getenv('ENVIRONMENT')}")

# Import FastAPI app
from main import app
logger.info("FastAPI app loaded")

# Initialize MongoDB
import asyncio
from app.core.database import connect_to_mongo
try:
    asyncio.run(connect_to_mongo())
    logger.info("MongoDB connected")
except Exception as e:
    logger.error(f"MongoDB error: {e}")

# Create WSGI handler
from mangum import Mangum
handler = Mangum(app, lifespan="off")

def application(environ, start_response):
    return handler(environ, start_response)

logger.info("WSGI ready")
```

### Step 4: Reload & Test (2 minutes)
```bash
# In Web tab, click big green "Reload" button

# Wait 10 seconds, then test:
curl https://wsmontes.pythonanywhere.com/api/v3/health
```

**Expected response**:
```json
{"status":"healthy","version":"3.0"}
```

---

## 🐛 IF IT STILL DOESN'T WORK

### Check 1: Error Log
```bash
tail -100 /var/log/wsmontes.pythonanywhere.com.error.log
```

**Common errors & fixes**:

**Error**: `ModuleNotFoundError: No module named 'main'`
**Fix**: Check directory structure
```bash
cd /home/wsmontes/concierge-api
ls -la
# Should see: main.py, app/, wsgi.py, requirements.txt
```

**Error**: `No module named 'dotenv'`
**Fix**: Reinstall requirements
```bash
source venv/bin/activate
pip install -r requirements.txt
```

**Error**: `No module named 'mangum'`
**Fix**: Update mangum
```bash
pip install mangum==0.18.0
```

**Error**: `Task was attached to a different loop`
**Fix**: The WSGI file above handles this correctly. If you still see this, change:
```python
asyncio.run(connect_to_mongo())
```
to:
```python
# Skip MongoDB initialization in WSGI
# It will connect on first request instead
```

### Check 2: Python Path
```bash
cd /home/wsmontes/concierge-api
source venv/bin/activate
python -c "from main import app; print('OK')"
```

If this fails, you have an import issue. Check:
- Is `main.py` in `/home/wsmontes/concierge-api/`?
- Is `app/` folder there too?
- Are you in the right directory?

### Check 3: MongoDB Connection
```bash
python -c "
import asyncio
from app.core.database import connect_to_mongo
asyncio.run(connect_to_mongo())
print('MongoDB OK')
"
```

If this fails:
- Check `MONGODB_URL` in `.env`
- Verify MongoDB Atlas allows connections from PythonAnywhere IPs
- Check MongoDB Atlas username/password

### Check 4: Test Endpoints Individually
```bash
# Health check (no database required)
curl -v https://wsmontes.pythonanywhere.com/api/v3/health

# Info endpoint (no database required)
curl -v https://wsmontes.pythonanywhere.com/api/v3/info

# Docs (should always work)
curl -v https://wsmontes.pythonanywhere.com/api/v3/docs
```

---

## 📊 ISSUE SUMMARY

**Issues Fixed**:
1. ✅ Created missing `wsgi.py` file
2. ✅ Corrected import paths in WSGI config
3. ✅ Added MongoDB initialization
4. ✅ Added comprehensive logging
5. ✅ Fixed lifespan event incompatibility

**Issues to Monitor**:
- OAuth state storage (works for now, needs Redis/MongoDB later)
- CORS configuration (test from GitHub Pages)
- Trailing slash redirects (may need web config adjustment)

**Time Investment**:
- Reading analysis: 15 minutes
- Implementing fixes: 20 minutes
- Testing: 10 minutes
- **Total**: ~45 minutes

---

## 🎯 SUCCESS CRITERIA

Your deployment is successful when:

1. ✅ Health check returns 200 OK
   ```bash
   curl https://wsmontes.pythonanywhere.com/api/v3/health
   # Returns: {"status":"healthy","version":"3.0"}
   ```

2. ✅ API docs load
   ```
   https://wsmontes.pythonanywhere.com/api/v3/docs
   ```

3. ✅ CORS allows GitHub Pages
   ```bash
   curl -H "Origin: https://wsmontes.github.io" \
        -v https://wsmontes.pythonanywhere.com/api/v3/health
   # Check for: Access-Control-Allow-Origin header
   ```

4. ✅ OAuth flow works from GitHub Pages
   ```
   1. Open: https://wsmontes.github.io/Concierge-Collector
   2. Click "Login with Google"
   3. Should redirect to Google
   4. Should redirect back with tokens
   ```

---

## 📞 NEED HELP?

If you're still stuck after following this:

1. **Grab the logs**:
   ```bash
   tail -200 /var/log/wsmontes.pythonanywhere.com.error.log > error.log
   tail -100 /home/wsmontes/concierge-api/app.log > app.log
   ```

2. **Check what's running**:
   ```bash
   ps aux | grep python
   ```

3. **Share specific error message** - don't just say "it doesn't work"!

---

**Last Updated**: November 20, 2025  
**Next Review**: After successful deployment
