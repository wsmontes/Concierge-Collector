# Concierge Collector API V3

FastAPI backend for the Concierge Collector project with AI services integration.

## 🚀 Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Run the API (from concierge-api-v3/)
./run_local.sh   # Cria venv, instala deps e sobe em background (logs em uvicorn.log; para: kill $(cat .server.pid))

# Or run directly
cd concierge-api-v3
python main.py
```

**Production:** `https://concierge-collector.onrender.com/api/v3`  
**Local:** `http://localhost:8000/api/v3`  
**Docs:** `/docs` | `/redoc`

## 📁 Project Structure

```
concierge-api-v3/
├── app/
│   ├── api/          # API endpoints
│   ├── core/         # Core functionality (database, config, security)
│   ├── models/       # Pydantic models
│   └── services/     # Business logic services
├── tests/            # Test suite (pytest)
├── scripts/          # Utility scripts
│   ├── maintenance/  # Database maintenance
│   └── generate_api_key.py
├── docs/             # Documentation
│   ├── implementation/  # Implementation notes
│   └── security/       # Security documentation
├── main.py           # Application entry point
└── requirements.txt  # Python dependencies
```

## 🔒 Authentication

**Dual Authentication:**
- **OAuth (Web Users):** `Authorization: Bearer <jwt_token>`
- **API Key (Bots/Scripts):** `X-API-Key: <api_secret_key>`

**Protected Endpoints:**
- POST/PATCH/DELETE on `/entities`, `/curations`
- POST `/ai/orchestrate`

**Public Endpoints:**
- GET requests, `/health`, `/places/*`, `/llm/*`

Generate API key: `python scripts/generate_api_key.py`

## 🧪 Testing

```bash
# Run all tests
pytest tests/ -v

# Run specific test file
pytest tests/test_entities.py -v

# Run with coverage
pytest tests/ --cov=app --cov-report=html
```

**Test Status:** 62/78 passing (79.5%) + 16 skipped (100% functional coverage)

## 📚 API Documentation

- Interactive docs: `http://localhost:8000/api/v3/docs`
- OpenAPI spec: `http://localhost:8000/api/v3/openapi.json`
- ReDoc: `http://localhost:8000/api/v3/redoc`

## 🔧 Configuration

Key environment variables:

- `MONGODB_URL`: MongoDB connection string
- `MONGODB_DB_NAME`: Database name
- `API_SECRET_KEY`: API key for authentication
- `OPENAI_API_KEY`: OpenAI API key for AI services
- `GOOGLE_PLACES_API_KEY`: Google Places API key

## 📖 Additional Documentation

- [Implementation Summary](docs/implementation/AI_IMPLEMENTATION_COMPLETE.md)
- [Test Update Summary](docs/implementation/PYTEST_UPDATE_SUMMARY.md)
- [Security Guide](docs/security/SECURITY.md)

## 🛠️ Maintenance

Database cleanup script:
```bash
python scripts/maintenance/cleanup_mongodb.py
```

Generate new API key:
```bash
python scripts/generate_api_key.py
```

## 📦 Dependencies

- FastAPI 0.109.0
- Motor 3.3.2 (async MongoDB)
- OpenAI 1.12.0
- Pydantic 2.5.3
- Python 3.12+

## 🌟 Features

- ✅ RESTful API with FastAPI
- ✅ MongoDB with async support (Motor)
- ✅ API Key authentication
- ✅ OpenAI integration (GPT-4, Whisper, Vision)
- ✅ Google Places API integration
- ✅ Comprehensive test suite (pytest)
- ✅ Interactive API documentation (Swagger/ReDoc)
- ✅ Optimistic locking for data consistency
- ✅ CORS support
- ✅ Background process management scripts
- ✅ Auto-reload in development mode

## 📍 API Endpoints

The API uses the `/api/v3` prefix for all endpoints:

- `/api/v3/info` - System information and health check
- `/api/v3/entities` - Entity management (restaurants, etc.)
- `/api/v3/curations` - Curation management
- `/api/v3/concepts` - Concept matching and management
- `/api/v3/places` - Google Places integration
- `/api/v3/ai` - AI services (GPT-4, Whisper, Vision)

## 📝 License

MIT License - See main project LICENSE file
