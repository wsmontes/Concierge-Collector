# 🚀 Concierge API V3 - Local Development Guide

## Quick Start

### 1️⃣ Configure Environment

Edit `concierge-api-v3/.env` with your credentials:

```bash
# Required for database
MONGODB_URL=mongodb://localhost:27017
# OR use MongoDB Atlas:
# MONGODB_URL=mongodb+srv://user:pass@cluster.mongodb.net/

# Required for AI features
OPENAI_API_KEY=sk-...

# Required for Places
GOOGLE_PLACES_API_KEY=...

# Required for OAuth
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

### 2️⃣ Start Backend

#### macOS/Linux:
```bash
cd concierge-api-v3
./run_local.sh
```

#### Windows:
```bash
cd concierge-api-v3
run_local.bat
```

### 3️⃣ Open Frontend

Open `index.html` with Live Server (VSCode extension) or:

```bash
# In root directory
python3 -m http.server 5500
```

The frontend will automatically detect the local backend at `http://localhost:8000`.

---

## 🌐 How It Works

### Automatic Environment Detection

The system automatically detects where it's running:

| Environment | Backend URL | Frontend URL |
|-------------|-------------|--------------|
| **Local** | `http://localhost:8000` | `http://127.0.0.1:5500` |
| **Render** | `https://concierge-collector.onrender.com` | `https://wsmontes.github.io` |

### Backend Detection
In `concierge-api-v3/app/core/config.py`:
- Checks `HOSTNAME` and `RENDER_SERVICE_NAME` environment variables
- Auto-configures OAuth redirect URIs
- Sets CORS origins

### Frontend Detection
In `scripts/config.js`:
- Checks `window.location.hostname`
- Switches API base URL automatically
- No code changes needed

---

## 📋 Requirements

### MongoDB
- **Local**: Install MongoDB Community Server
- **Cloud**: Use MongoDB Atlas (free tier available)

### API Keys (Optional)
- **OpenAI**: For AI transcription/concept extraction
- **Google Places**: For location search
- **Google OAuth**: For authentication

---

## 🔧 Troubleshooting

### Backend won't start
```bash
# Check Python version (3.9+)
python3 --version

# Reinstall dependencies
cd concierge-api-v3
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Frontend can't connect
1. Verify backend is running at `http://localhost:8000/api/v3/health`
2. Check browser console for errors
3. Verify CORS origins in `.env` include `http://127.0.0.1:5500`

### MongoDB connection failed
- API will start but only Places endpoints will work
- Check MongoDB is running: `mongosh` or `mongo`
- Verify `MONGODB_URL` in `.env`

---

## 📚 API Documentation

Once running, access:
- **Swagger UI**: http://localhost:8000/api/v3/docs
- **ReDoc**: http://localhost:8000/api/v3/redoc
- **Health Check**: http://localhost:8000/api/v3/health

---

## 🔄 Development Workflow

1. **Edit backend code** → Server auto-reloads (uvicorn --reload)
2. **Edit frontend code** → Live Server auto-refreshes
3. **No configuration changes needed** → Works locally and on Render

---

## 🚢 Deploy to Render

Push to GitHub → Render auto-deploys from environment variables configured in dashboard.

No changes needed in code!
