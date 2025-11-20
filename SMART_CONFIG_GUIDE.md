# 🚀 Smart Configuration Guide

**No more manual configuration between environments!**

## 🎯 Overview

The smart configuration system automatically detects your environment and configures everything appropriately. You only need to set your API keys and MongoDB connection - everything else is automatic!

---

## ✨ What's Automatic

### Environment Detection
- **Local Development**: Detected automatically when running on localhost
- **PythonAnywhere**: Detected via hostname and file system paths
- **Docker**: Detected via `/.dockerenv` file
- **Production**: Explicitly set with `ENVIRONMENT=production`

### Auto-Configured Settings

| Setting | Development | PythonAnywhere | Docker/Production |
|---------|-------------|----------------|-------------------|
| Base URL | `http://localhost:8000` | `https://wsmontes.pythonanywhere.com` | From `API_BASE_URL` env var |
| Frontend URL | `http://localhost:8080` | `https://wsmontes.github.io/...` | From `FRONTEND_URL` env var |
| OAuth Redirect | Local callback | PythonAnywhere callback | Custom callback |
| CORS Origins | Localhost ports | GitHub Pages + PA + localhost | Custom origins |
| Reload | `true` | `false` | `false` |
| Log Level | `DEBUG` | `INFO` | `INFO` |
| DB Pool Size | 5 connections | 10 connections | 10 connections |

---

## 🚀 Quick Start

### 1. Copy the Smart Template

```bash
cd concierge-api-v3
cp .env.smart.example .env
```

### 2. Configure Only What's Required

Edit `.env` and set **only these 5 values**:

```bash
# MongoDB Atlas connection string
MONGODB_URL=mongodb+srv://username:password@cluster.mongodb.net/

# Your API keys
GOOGLE_PLACES_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
API_SECRET_KEY=your_32_char_secret_here

# Google OAuth credentials
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
```

### 3. Run Anywhere

```bash
# Local development - auto-detects!
uvicorn main:app --reload

# PythonAnywhere - auto-detects!
# Just deploy and it works

# Docker - auto-detects!
docker run your-image

# Custom production - set one variable
ENVIRONMENT=production uvicorn main:app
```

**That's it!** No more configuration to change between environments.

---

## 🔧 Using Smart Configuration

### Enable Smart Config

Replace the import in `main.py`:

```python
# Old way
from app.core.config import settings

# New smart way
from app.core.config_smart import settings
```

Or rename the files:

```bash
cd concierge-api-v3/app/core
mv config.py config_old.py
mv config_smart.py config.py
```

### View Configuration on Startup

In development, configuration is automatically displayed:

```
╔══════════════════════════════════════════════════════════════╗
║          Concierge Collector API V3 Configuration            ║
╚══════════════════════════════════════════════════════════════╝

Environment: DEVELOPMENT
Base URL: http://localhost:8000
Frontend URL: http://localhost:8080

MongoDB:
  URL: mongodb+srv://user:***@clus...(85 chars)
  Database: concierge-collector

API:
  Host: 0.0.0.0
  Port: 8000
  Reload: True
  Log Level: DEBUG

CORS Origins:
  - http://localhost:3000
  - http://localhost:5500
  - http://localhost:8080
  - http://127.0.0.1:5500
  - http://127.0.0.1:5501

OAuth:
  Client ID: 123456789012-abc...(20 chars)
  Redirect URI: http://localhost:8000/api/v3/auth/callback

APIs:
  Google Places: ✓ Configured
  OpenAI: ✓ Configured
  Secret Key: ✓ Configured

JWT:
  Access Token Expiry: 60 minutes
  Refresh Token Expiry: 30 days

╚══════════════════════════════════════════════════════════════╝
```

---

## 📋 Environment-Specific Behavior

### Development (Auto-Detected)

**Indicators**:
- Running on localhost
- Not in Docker or PythonAnywhere

**Auto-Configuration**:
```python
api_base_url = "http://localhost:8000"
frontend_url = "http://localhost:8080"
oauth_redirect = "http://localhost:8000/api/v3/auth/callback"
cors_origins = ["http://localhost:3000", "http://localhost:8080", ...]
reload = True
log_level = "DEBUG"
```

**What You Need**:
- Just your API keys and MongoDB URL in `.env`

---

### PythonAnywhere (Auto-Detected)

**Indicators**:
- `/home/wsmontes` directory exists
- Hostname contains "pythonanywhere"
- `PYTHONANYWHERE_SITE` environment variable

**Auto-Configuration**:
```python
api_base_url = "https://wsmontes.pythonanywhere.com"
frontend_url = "https://wsmontes.github.io/Concierge-Collector"
oauth_redirect = "https://wsmontes.pythonanywhere.com/api/v3/auth/callback"
cors_origins = [
    "https://wsmontes.github.io",
    "https://wsmontes.pythonanywhere.com",
    "http://localhost:8080"  # Still allow local testing
]
reload = False
log_level = "INFO"
```

**What You Need**:
- Same `.env` file as development
- Deploy and it auto-configures!

**No need to**:
- Change CORS origins
- Update OAuth redirect URIs
- Disable reload
- Change base URLs

---

### Docker (Auto-Detected)

**Indicators**:
- `/.dockerenv` file exists
- `/run/.containerenv` file exists
- `DOCKER_CONTAINER=true` environment variable

**Auto-Configuration**:
```python
api_base_url = os.getenv("API_BASE_URL", "http://localhost:8000")
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:8080")
cors_origins = ["http://localhost:8080", "http://frontend:8080"]
reload = False
log_level = "INFO"
```

**What You Need**:
```yaml
# docker-compose.yml
environment:
  - MONGODB_URL=mongodb://mongo:27017
  - API_BASE_URL=http://api:8000
  - FRONTEND_URL=http://frontend:8080
  # Other API keys from .env file
```

---

### Custom Production (Explicit)

**Set explicitly**:
```bash
ENVIRONMENT=production
```

**Additional configuration**:
```bash
ENVIRONMENT=production
API_BASE_URL=https://api.yourdomain.com
FRONTEND_URL=https://yourdomain.com
FRONTEND_URL_PRODUCTION=https://yourdomain.com
```

---

## 🎛️ Advanced Overrides

### Override Auto-Detection

If you need to override auto-detected values:

```bash
# Force environment type
ENVIRONMENT=production

# Override URLs
API_BASE_URL=https://custom-api.com
FRONTEND_URL=https://custom-frontend.com

# Override CORS
CORS_ORIGINS=https://custom-frontend.com,https://admin.custom.com

# Override OAuth redirect
GOOGLE_OAUTH_REDIRECT_URI=https://custom-api.com/auth/callback
```

### Use in Code

```python
from app.core.config_smart import settings

# Check environment
if settings.is_development:
    print("Running in development mode")

if settings.is_production:
    print("Running in production mode")

# Get environment-specific config
log_level = settings.get_log_level()
db_pool_config = settings.get_db_pool_config()

# Display configuration
print(settings.display_config())
```

---

## 🔄 Migration from Old Config

### Step 1: Test Smart Config

```bash
# Keep both files temporarily
cd concierge-api-v3/app/core
# config.py (old)
# config_smart.py (new)
```

### Step 2: Update main.py

```python
# Try the new config
from app.core.config_smart import settings
```

### Step 3: Test Locally

```bash
uvicorn main:app --reload
# Should see smart config display on startup
```

### Step 4: Verify Auto-Detection

```python
# In Python console
from app.core.config_smart import settings, EnvironmentDetector

print(f"Detected: {EnvironmentDetector.detect()}")
print(f"Base URL: {EnvironmentDetector.get_base_url()}")
print(settings.display_config())
```

### Step 5: Replace Old Config

```bash
# Once confident
mv config.py config_old.py.backup
mv config_smart.py config.py
```

---

## ✅ Benefits

### Before (Manual Config)

**Development `.env`**:
```bash
ENVIRONMENT=development
API_V3_URL=http://localhost:8000
CORS_ORIGINS=http://localhost:8080
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:8000/api/v3/auth/callback
API_RELOAD=true
```

**Production `.env`**:
```bash
ENVIRONMENT=production
API_V3_URL=https://wsmontes.pythonanywhere.com
CORS_ORIGINS=https://wsmontes.github.io,https://wsmontes.pythonanywhere.com
GOOGLE_OAUTH_REDIRECT_URI=https://wsmontes.pythonanywhere.com/api/v3/auth/callback
API_RELOAD=false
```

**Problems**:
- ❌ Must maintain two different configs
- ❌ Easy to forget changing settings
- ❌ Copy-paste errors between environments
- ❌ Manual CORS configuration

### After (Smart Config)

**Single `.env` (works everywhere)**:
```bash
MONGODB_URL=mongodb+srv://...
GOOGLE_PLACES_API_KEY=...
OPENAI_API_KEY=...
API_SECRET_KEY=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

**Benefits**:
- ✅ Same config works everywhere
- ✅ Auto-detects environment
- ✅ Auto-configures all settings
- ✅ No manual changes needed
- ✅ Reduced human error
- ✅ Faster deployments

---

## 🧪 Testing

### Test Auto-Detection

```bash
# Test development detection
python -c "from app.core.config_smart import EnvironmentDetector; print(EnvironmentDetector.detect())"
# Should output: development

# Test PythonAnywhere detection (when on PA)
python -c "from app.core.config_smart import EnvironmentDetector; print(EnvironmentDetector.detect())"
# Should output: pythonanywhere

# Test with override
ENVIRONMENT=docker python -c "from app.core.config_smart import EnvironmentDetector; print(EnvironmentDetector.detect())"
# Should output: docker
```

### Test Configuration

```bash
# Show full config
python -c "from app.core.config_smart import settings; print(settings.display_config())"

# Test CORS
python -c "from app.core.config_smart import settings; print(settings.cors_origins_list)"

# Test URLs
python -c "from app.core.config_smart import settings; print(f'Base: {settings.get_base_url()}')"
```

---

## 📚 API Reference

### EnvironmentDetector

```python
class EnvironmentDetector:
    @staticmethod
    def detect() -> str:
        """Returns: 'development', 'pythonanywhere', 'docker', or 'production'"""
    
    @staticmethod
    def is_pythonanywhere() -> bool:
        """Check if running on PythonAnywhere"""
    
    @staticmethod
    def is_docker() -> bool:
        """Check if running in Docker"""
    
    @staticmethod
    def is_production() -> bool:
        """Check if in any production environment"""
    
    @staticmethod
    def get_base_url() -> str:
        """Get API base URL for current environment"""
    
    @staticmethod
    def get_frontend_url() -> str:
        """Get frontend URL for current environment"""
```

### Settings Properties

```python
settings.environment  # Current environment
settings.is_development  # bool
settings.is_production  # bool
settings.cors_origins_list  # List[str]
settings.get_log_level()  # str
settings.get_db_pool_config()  # dict
settings.display_config()  # str (formatted display)
```

---

## 🐛 Troubleshooting

### Environment Not Detected Correctly

**Problem**: Shows "development" when on PythonAnywhere

**Solution**: Set explicitly:
```bash
ENVIRONMENT=pythonanywhere
```

### CORS Still Failing

**Problem**: Frontend can't connect even with smart config

**Solution**: Check actual CORS origins:
```python
from app.core.config_smart import settings
print(settings.cors_origins_list)
```

Add custom origins if needed:
```bash
CORS_ORIGINS=https://your-frontend.com,https://wsmontes.github.io
```

### OAuth Redirect Mismatch

**Problem**: Google says redirect_uri doesn't match

**Solution**: Check auto-configured URI:
```python
from app.core.config_smart import settings
print(settings.google_oauth_redirect_uri)
```

Override if needed:
```bash
GOOGLE_OAUTH_REDIRECT_URI=https://exact-uri-from-google-console.com/api/v3/auth/callback
```

---

## 🎉 Result

With smart configuration:
- ✅ Develop locally with zero config
- ✅ Deploy to PythonAnywhere with zero changes
- ✅ Run in Docker with minimal env vars
- ✅ One `.env` file to maintain
- ✅ No more manual URL updates
- ✅ No more CORS configuration headaches

**Just set your API keys once and deploy anywhere!**

---

**Last Updated**: November 20, 2025  
**Version**: 1.0.0  
**Status**: Production Ready
