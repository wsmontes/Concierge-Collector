<!--
Purpose: Provide the operational overview of Concierge Collector and act as the single entry point for setup, execution, and active documentation.
Main responsibilities: Describe current architecture, minimum local run flow, and point to official active guides.
Dependencies: index.html, scripts/, styles/, concierge-api-v3/, docs/README.md, docs/API/README.md, setup_local.sh.
-->

# Concierge Collector

Restaurant curation platform with a web frontend and FastAPI V3 backend, including semantic search, Places integration, and AI services.

## Current status

- Static frontend at repository root ([index.html](index.html)).
- Main backend in [concierge-api-v3](concierge-api-v3).
- Production API URL: `https://concierge-collector.onrender.com/api/v3`.
- Default local API URL: `http://localhost:8000/api/v3`.

## Local quick start

### 1) Backend setup

```bash
./setup_local.sh
```

Or manually:

```bash
cd concierge-api-v3
cp .env.example .env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
./run_local.sh
```

### 2) Start frontend

Open [index.html](index.html) using VS Code Live Server, or run:

```bash
python3 -m http.server 5500
```

Expected local frontend: `http://127.0.0.1:5500`  
Expected local API: `http://localhost:8000/api/v3`

## Project structure

```text
Concierge-Collector/
├── index.html              # Frontend entry point
├── scripts/                # JS modules (core, services, UI, utilities)
├── styles/                 # Frontend styles
├── concierge-api-v3/       # FastAPI V3 backend
│   ├── app/                # Routes, models, services, core
│   ├── tests/              # Backend tests
│   └── requirements.txt
├── docs/                   # Active official docs + historical docs
└── data/                   # Support data and exports
```

## Main environment variables

Configure [concierge-api-v3/.env.example](concierge-api-v3/.env.example) as `.env`:

- `MONGODB_URL`
- `MONGODB_DB_NAME`
- `API_SECRET_KEY`
- `OPENAI_API_KEY` (optional, AI features)
- `GOOGLE_PLACES_API_KEY` (optional, Places)
- `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` (optional, OAuth)

## Active documentation

- Master index: [docs/README.md](docs/README.md)
- API: [docs/API/README.md](docs/API/README.md)
- Local development: [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)
- Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- OAuth: [docs/OAUTH_SETUP_GUIDE.md](docs/OAUTH_SETUP_GUIDE.md)
- Environment detection: [docs/ENVIRONMENT_DETECTION.md](docs/ENVIRONMENT_DETECTION.md)

## Testing

Backend:

```bash
cd concierge-api-v3
source venv/bin/activate
pytest tests/ -v
```

Official testing guide: [docs/testing/COLLECTOR_V3_TEST_GUIDE.md](docs/testing/COLLECTOR_V3_TEST_GUIDE.md)

## Production operation

- API: `https://concierge-collector.onrender.com/api/v3`
- Swagger: `https://concierge-collector.onrender.com/api/v3/docs`
- Health: `https://concierge-collector.onrender.com/api/v3/health`

## Notes

- This README is operational and links only to active documentation.
- Historical/superseded documents remain in [docs/archive](docs/archive) and [archive](archive).
