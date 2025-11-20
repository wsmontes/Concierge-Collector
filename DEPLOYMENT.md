# Deployment Guide - Concierge Collector

## 🚀 Live Deployment (Render.com)

### Production URLs
- **API:** https://concierge-collector.onrender.com/api/v3
- **Frontend:** https://concierge-collector-web.onrender.com
- **API Docs:** https://concierge-collector.onrender.com/api/v3/docs
- **Health Check:** https://concierge-collector.onrender.com/api/v3/health

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
- **Branch:** `Front-End-V3`
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
- **Main Branch:** `Front-End-V3` (production)
- All commits to this branch trigger automatic deployment on Render.com

### Python Version
Specified in `runtime.txt` at repository root:
```
3.13.4
```

---

## 🔄 CI/CD Pipeline

Render.com automatically:
1. Detects push to `Front-End-V3` branch
2. Builds backend (installs requirements)
3. Deploys backend with `uvicorn`
4. Deploys frontend static files
5. Both services are live within 2-3 minutes

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
- **API Reference:** [API-REF/README.md](API-REF/README.md)
- **API Documentation:** [docs/](docs/)
- **Archive (old deployment docs):** [archive/deployment-docs/](archive/deployment-docs/)
