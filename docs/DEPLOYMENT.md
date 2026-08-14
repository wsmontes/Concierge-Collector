# Deployment Guide - Concierge Collector

## 🚀 Live Production Deployment

### Production URLs
- **Frontend:** https://concierge-collector-web.onrender.com
- **API:** https://concierge-collector.onrender.com/api/v3
- **API Documentation:** https://concierge-collector.onrender.com/api/v3/docs
- **Health Check:** https://concierge-collector.onrender.com/api/v3/health

**Platform:** Render.com  
**Branch:** `main` (auto-deploy enabled, but unreliable — verify and trigger manually after each push)  
**Python Version:** 3.13.4

### Render Services

Both services are configured manually in the Render dashboard — there is no `render.yaml`/Dockerfile/Procfile (infra is not versioned).

| Service | Render ID | Type | Root | Build / Start | URL |
|---|---|---|---|---|---|
| **Concierge-Collector** (API) | `srv-d4fngpjuibrs73bo70vg` | Web Service | `concierge-api-v3` | `pip install -r requirements.txt` / `uvicorn main:app --host 0.0.0.0 --port $PORT` | https://concierge-collector.onrender.com (API `/api/v3`; health `GET /api/v3/health`) |
| **Concierge-Collector-Web** (Frontend) | `srv-d4fnrlje5dus7397lii0` | Static Site | `/` | no build / publish `.` | https://concierge-collector-web.onrender.com |

---

## 📋 Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitHub Repository                        │
│              wsmontes/Concierge-Collector                   │
│                       Branch: main                           │
└─────────────────┬───────────────────────────────────────────┘
                  │ (push triggers auto-deploy)
                  │
        ┌─────────┴─────────┐
        │                   │
        ▼                   ▼
┌───────────────┐   ┌──────────────────┐
│  Render.com   │   │   Render.com     │
│  Static Site  │   │   Web Service    │
├───────────────┤   ├──────────────────┤
│ Frontend      │   │ Backend API      │
│ HTML/CSS/JS   │   │ FastAPI/Python   │
│ Port: 443     │   │ Port: 10000      │
└───────┬───────┘   └────────┬─────────┘
        │                    │
        │                    ▼
        │            ┌───────────────┐
        │            │ MongoDB Atlas │
        │            │ Cloud Database│
        │            └───────────────┘
        │
        └──────── OAuth Flow ────────►
                  Google OAuth 2.0
```

---

## 📋 Deployment Configuration

### Backend (Web Service)
- **Platform:** Render.com Web Service
- **Runtime:** Python 3.13.4
- **Root Directory:** `concierge-api-v3`
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`

### Frontend (Static Site)
- **Platform:** Render.com Static Site
- **Branch:** `main`
- **Root Directory:** `/` (repository root)
- **Build Command:** _(empty - no build needed)_
- **Publish Directory:** `.`

---

## 🔑 Environment Variables (API Service)

Required environment variables for the API service:

```bash
# MongoDB
MONGODB_URL=mongodb+srv://...
MONGODB_DB_NAME=concierge-collector

# OpenAI
OPENAI_API_KEY=sk-proj-...

# Google OAuth
GOOGLE_OAUTH_CLIENT_ID=1020272767566-....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...

# API Security
API_SECRET_KEY=<generate-with-secrets.token_urlsafe(32)>

# Environment
ENVIRONMENT=production
```

**Note:** `GOOGLE_OAUTH_REDIRECT_URI` is auto-detected based on environment. No need to set it manually.

---

## 🧪 Testing Before Deployment

### Run Backend Tests
```bash
cd concierge-api-v3
pytest tests/ -v
```

**Critical Tests:**
- `test_ai_orchestrate.py` - Catches async/await bugs
- `test_integration_transcription.py` - End-to-end workflow
- All tests should pass without 500 errors

### Pre-Deployment Checklist
- [ ] All pytest tests pass
- [ ] No 500 errors in test output
- [ ] Manual test of transcription workflow locally
- [ ] Environment variables verified on Render

See [`../concierge-api-v3/TESTING_GUIDE.md`](../concierge-api-v3/TESTING_GUIDE.md) for detailed testing instructions.

---

## 🔒 Security Best Practices

### Environment Variables Management

**✅ DO:**
- Store all secrets in Render.com Environment Variables (never in code)
- Use different credentials for development and production
- Rotate API keys regularly (every 90 days)
- Use MongoDB Atlas IP whitelist (allow Render.com IPs)
- Generate strong `API_SECRET_KEY` with at least 32 characters

**❌ DON'T:**
- Commit `.env` files to git (protected by `.gitignore`)
- Share credentials via email, Slack, or other insecure channels
- Use the same MongoDB credentials across environments
- Hardcode secrets in source code
- Expose admin endpoints without authentication

### Protected Files (via .gitignore)

```
✅ Protected from git:
- .env (all variants)
- *.pem, *.key, *.crt
- secrets/
- credentials/
```

### MongoDB Security

1. **Enable MongoDB Atlas Network Access:**
   - Add Render.com IP ranges to Atlas whitelist
   - Or use "Allow access from anywhere" (0.0.0.0/0) with strong credentials

2. **Use Database User (not admin):**
   - Create dedicated user: `wmontes_db_user`
   - Grant only necessary permissions (readWrite on specific database)

3. **Connection String Format:**
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?appName=<appname>
   ```

### Google OAuth Security

1. **Authorized JavaScript Origins:**
   - Only add your actual domains
   - Include both `http://localhost` (dev) and production URLs
   
2. **Authorized Redirect URIs:**
   - Must match exactly what backend sends
   - Format: `https://<domain>/api/v3/auth/callback`

3. **Client Secret Protection:**
   - Never commit to git
   - Store only in Render Environment Variables
   - Rotate if exposed

### CORS Configuration

The `CORS_ORIGINS` variable must include:
- All frontend domains (including subdomains)
- Development URLs (localhost with various ports)
- No wildcards in production (security risk)

**Example:**
```
CORS_ORIGINS=http://localhost:3000,http://localhost:8080,https://concierge-collector-web.onrender.com,https://concierge-collector.onrender.com
```

---

## 🔐 Google OAuth Configuration

### Google Cloud Console Setup
1. Go to: https://console.cloud.google.com/apis/credentials
2. Select OAuth 2.0 Client ID: `concierge_API`
3. Configure authorized URIs:

**Authorized JavaScript origins:**
```
http://localhost:8080
https://concierge-collector-web.onrender.com
https://concierge-collector.onrender.com
```

**Authorized redirect URIs:**
```
http://localhost:8000/api/v3/auth/callback
https://concierge-collector.onrender.com/api/v3/auth/callback
```

---

## 🏠 Local Development

### Prerequisites
- Python 3.13.4
- MongoDB Atlas account
- OpenAI API key
- Google OAuth credentials

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/wsmontes/Concierge-Collector.git
   cd Concierge-Collector
   ```

2. Copy environment file:
   ```bash
   cd concierge-api-v3
   cp .env.example .env
   ```

3. Edit `.env` with your credentials

4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

5. Run the API:
   ```bash
   python -m uvicorn main:app --reload --port 8000
   ```

6. Open frontend (use Live Server or similar):
   - Open `index.html` in browser via localhost:8080 or similar

### Local URLs
- **API:** http://localhost:8000/api/v3
- **API Docs:** http://localhost:8000/api/v3/docs
- **Frontend:** http://localhost:8080 (or your Live Server port)

---

## 📝 Deployment Notes

### Auto-Detection Features
The application automatically detects the environment and configures:
- API base URLs (frontend config)
- OAuth redirect URIs (backend config)
- CORS origins
- Debug/reload settings

### Branch Strategy
- **Production Branch:** `main` (verified against the live Render API on 2026-08-14)
- Pushes to `main` trigger automatic deployment on Render.com, but auto-deploy is **unreliable** — after each push, verify the deployment in the Render dashboard and trigger it manually if needed (see `scripts/python-tools/render_deployment_manager.py`)

### Python Version
Specified in `runtime.txt` at repository root:
```
3.13.4
```

---

## 🔄 CI/CD Pipeline

Render.com auto-deploy (may not trigger reliably — verify deployments manually after each push):
1. Detects push to `main` branch
2. Builds backend (installs requirements)
3. Deploys backend with `uvicorn`
4. Deploys frontend static files
5. Both services are live within 2-3 minutes

GitHub Actions runs **tests only** (no deployment) — see `docs/TESTING.md` for the CI workflows.

---

## 🐛 Troubleshooting

### OAuth Errors
- Verify URIs in Google Cloud Console match exactly
- Wait 5-10 minutes after changing OAuth settings
- Clear browser cache

### API Connection Issues
- Check health endpoint: `/api/v3/health`
- Verify environment variables are set on Render
- Check Render logs for errors

### Build Failures
- Verify Python version in `runtime.txt`
- Check `requirements.txt` for dependency conflicts
- Review Render build logs

---

## 📚 Additional Documentation
- **API Reference:** [API/README.md](API/README.md)
- **Documentation Index:** [docs/README.md](README.md)
- **Archive (old sync guides):** [archive/old-sync-guides/](archive/old-sync-guides/)
