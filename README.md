# 🏨 Concierge Collector

**Professional restaurant curation platform** for hospitality professionals to collect, organize, and share dining recommendations.

---

## 🚀 Quick Start

### Frontend (Static Site)
```bash
# Open index.html directly in browser or serve with:
python -m http.server 8000
# Access: http://localhost:8000
```

### Backend API
```bash
cd concierge-api-v3
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

---

## 📁 Project Structure

```
Concierge-Collector/
├── index.html              # Main frontend application
├── scripts/                # Frontend JavaScript modules
│   ├── modules/           # Core modules (recording, concepts, etc)
│   ├── services/          # API & sync services
│   ├── ui/                # UI components
│   └── utils/             # Utilities
├── styles/                # CSS stylesheets
├── concierge-api-v3/      # Backend FastAPI service
│   ├── app/              # API routes & services
│   ├── tests/            # Backend tests
│   └── requirements.txt  # Python dependencies
└── docs/                  # Documentation
    ├── api/              # API specs & OpenAPI
    ├── development/      # Dev guides & setup
    └── deployment/       # Deployment & troubleshooting
```

---

## 🔧 Configuration

### Environment Variables
Copy `.env.example` to `.env` and configure:

**Backend API:**
- `MONGODB_URL` - MongoDB connection string
- `API_SECRET_KEY` - JWT secret
- `OPENAI_API_KEY` - OpenAI API key
- `GOOGLE_PLACES_API_KEY` - Google Places API key

**OAuth (optional):**
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`

**Deployment:**
- `RENDER_API_KEY` - Render.com API key (for monitoring)

---

## 📚 Documentation

- **[API Documentation](docs/api/README.md)** - REST API specs & OpenAPI schema
- **[Development Guide](docs/development/)** - Setup, OAuth, security
- **[Deployment Guide](docs/deployment/)** - Production setup & troubleshooting
- **[Render Deployment Manager](docs/RENDER_DEPLOYMENT_MANAGER_GUIDE.md)** - Monitor deployments

---

## 🧪 Testing

### Backend Tests
```bash
cd concierge-api-v3
source venv/bin/activate
PYTHONPATH=. pytest tests/ -v
```

---

## 🚢 Deployment

**Frontend:** Static site on Render.com  
**Backend:** FastAPI service on Render.com  
**Database:** MongoDB Atlas

Auto-deploy configured from `Front-End-V3` branch.

---

## 🛠️ Tech Stack

**Frontend:**
- Vanilla JavaScript (ES6+)
- Tailwind CSS
- IndexedDB (local storage)

**Backend:**
- Python 3.12
- FastAPI
- MongoDB (Motor async driver)
- OpenAI GPT-4
- Google Places API

---

## 📄 License

Proprietary - All rights reserved

---

## 🤝 Contributing

This is a private project. For access or questions, contact the maintainer.
