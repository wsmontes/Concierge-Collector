# 🔄 Automatic Environment Detection

> **Status:** Ativo — comportamento documentado conforme runtime atual em 2026-02-18.

This document explains how the Concierge Collector automatically adapts to different environments without code changes.

## 🎯 Design Philosophy

**Zero Configuration Switching**: The same codebase works seamlessly in:
- Local development (`localhost`)
- Production deployment (Render.com)
- GitHub Pages (static frontend)

**No Manual Toggles**: The system auto-detects its environment and configures itself accordingly.

---

## 🔍 How Detection Works

### Backend Detection (Python)

Location: `concierge-api-v3/app/core/config.py`

```python
def model_post_init(self, __context):
    """Called after model initialization - auto-detect environment"""
    hostname = os.getenv('HOSTNAME', '')
    render_service = os.getenv('RENDER_SERVICE_NAME', '')
    
    is_pythonanywhere = 'pythonanywhere' in hostname.lower() or os.path.exists('/home/wsmontes')
    is_render = bool(render_service) or 'render' in hostname.lower()
    
    # Auto-configure OAuth redirect URI
    if not self.google_oauth_redirect_uri:
        if is_render:
            object.__setattr__(self, 'google_oauth_redirect_uri', 
                             "https://concierge-collector.onrender.com/api/v3/auth/callback")
        elif is_pythonanywhere:
            # Legacy environment fallback (deprecated)
            object.__setattr__(self, 'google_oauth_redirect_uri', 
                             "https://concierge-collector.onrender.com/api/v3/auth/callback")
        else:
            object.__setattr__(self, 'google_oauth_redirect_uri',
                             "http://localhost:8000/api/v3/auth/callback")
```

**Environment Variables Used:**
- `RENDER_SERVICE_NAME` - Set by Render.com automatically
- `HOSTNAME` - System hostname
- File existence checks (legacy compatibility, e.g., `/home/wsmontes` for PythonAnywhere)

**What Gets Auto-Configured:**
- OAuth redirect URIs
- CORS origins (from env variable)
- API base URL
- Database connections

---

### Frontend Detection (JavaScript)

Location: `scripts/core/config.js`

```javascript
// Detect environment
const isGitHubPages = window.location.hostname.includes('github.io');
const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const isPythonAnywhere = window.location.hostname.includes('pythonanywhere.com');
const isRenderProduction = window.location.hostname.includes('onrender.com');

// Determine API base URL based on environment
const getApiBaseUrl = () => {
    if (isRenderProduction) {
        return 'https://concierge-collector.onrender.com/api/v3';
    } else if (isPythonAnywhere || isGitHubPages) {
        return 'https://wsmontes.pythonanywhere.com/api/v3';
    } else if (isLocalhost) {
        return 'http://localhost:8000/api/v3';
    } else {
        return 'http://localhost:8000/api/v3';  // Default fallback
    }
};
```

**Operational Note (important):**
- Render host (`*.onrender.com`) usa API Render
- Localhost usa API local
- GitHub Pages e host PythonAnywhere ainda seguem fallback legado para PythonAnywhere no código atual

**Detection Methods:**
- `window.location.hostname` - Current page URL
- String matching on known domains

**What Gets Auto-Configured:**
- API base URL (`http://localhost:8000` vs `https://...onrender.com`)
- OAuth redirect URIs
- Frontend URLs
- CORS settings

---

## 📋 Environment-Specific Behavior

### Local Development

| Component | Value | Source |
|-----------|-------|--------|
| Backend URL | `http://localhost:8000/api/v3` | `window.location.hostname === 'localhost'` |
| Frontend URL | `http://127.0.0.1:5500` | Live Server default |
| OAuth Redirect | `http://localhost:8000/api/v3/auth/callback` | Backend auto-detect |
| CORS Origins | All `localhost` + `127.0.0.1` variants | `.env` file |
| MongoDB | Local or Atlas (from `.env`) | `MONGODB_URL` |

### Production (Render.com)

| Component | Value | Source |
|-----------|-------|--------|
| Backend URL | `https://concierge-collector.onrender.com/api/v3` | `RENDER_SERVICE_NAME` env var |
| Frontend URL | `https://concierge-collector-web.onrender.com` | Render dashboard config |
| OAuth Redirect | `https://concierge-collector.onrender.com/api/v3/auth/callback` | Backend auto-detect |
| CORS Origins | Production domains | Render env vars |
| MongoDB | MongoDB Atlas | Render env vars |

### GitHub Pages / Legacy Host Behavior

| Component | Value | Source |
|-----------|-------|--------|
| Frontend URL | `https://wsmontes.github.io/...` | GitHub Pages |
| API URL (current code path) | `https://wsmontes.pythonanywhere.com/api/v3` | `isGitHubPages || isPythonAnywhere` |
| Classification | Legacy compatibility path | `scripts/core/config.js` |

---

## 🔧 Configuration Files

### Backend: `.env` (Local Only - Git Ignored)

```bash
# Local development configuration
MONGODB_URL=mongodb://localhost:27017
GOOGLE_OAUTH_CLIENT_ID=your-dev-client-id
GOOGLE_OAUTH_REDIRECT_URI=  # Auto-detected if empty
```

### Backend: Render Environment Variables (Production)

Set in Render Dashboard → Environment:
```
MONGODB_URL=mongodb+srv://...
GOOGLE_OAUTH_CLIENT_ID=your-prod-client-id
RENDER_SERVICE_NAME=concierge-collector  # Auto-set by Render
```

### Frontend: No Configuration Needed

The frontend automatically detects its environment from `window.location.hostname`.

---

## 🎯 Benefits

### ✅ For Developers
- Clone and run with one command (`./setup_local.sh`)
- No environment switching in code
- Same codebase for dev and prod

### ✅ For Deployment
- Push to GitHub → Render auto-deploys
- No manual configuration steps
- Environment variables managed in dashboard

### ✅ For Maintenance
- One codebase to maintain
- No "production" vs "development" branches
- Changes work everywhere automatically

---

## 🔍 Troubleshooting

### Backend connects to wrong database
**Check:** `MONGODB_URL` in `.env` (local) or Render env vars (production)

### Frontend can't reach API
**Check:** 
1. Is backend running? Visit `http://localhost:8000/api/v3/health`
2. Browser console for CORS errors
3. `scripts/core/config.js` detection logic - log `window.location.hostname`
4. If running on GitHub Pages, current code path points to PythonAnywhere legacy URL

### OAuth redirects to wrong URL
**Check:**
1. Backend logs show detected environment
2. Google OAuth console has correct redirect URIs for both local and production
3. `.env` doesn't override `GOOGLE_OAUTH_REDIRECT_URI` (leave empty for auto-detect)

### CORS errors
**Check:**
1. Backend `.env` includes your frontend URL in `CORS_ORIGINS`
2. Format: `["http://localhost:5500","http://127.0.0.1:5500",...]`

---

## 📚 Related Documentation

- [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) - Local setup guide
- [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment
- [OAUTH_SETUP_GUIDE.md](OAUTH_SETUP_GUIDE.md) - OAuth configuration
