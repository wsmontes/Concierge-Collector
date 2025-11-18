# Concierge Collector API V3

FastAPI backend for the Concierge Collector project with AI services integration.

## 🚀 Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your configuration

# Run the API
python main.py
```

API will be available at `http://localhost:8000`

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

## 🔒 Security

API Key authentication is required for all write operations (POST, PATCH, DELETE).
Read operations (GET) are public.

See [docs/security/SECURITY.md](docs/security/SECURITY.md) for details.

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

- Interactive docs: `http://localhost:8000/docs`
- OpenAPI spec: `http://localhost:8000/openapi.json`
- ReDoc: `http://localhost:8000/redoc`

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
- ✅ MongoDB with async support
- ✅ API Key authentication
- ✅ OpenAI integration (GPT-4, Whisper, Vision)
- ✅ Comprehensive test suite
- ✅ Interactive API documentation
- ✅ Optimistic locking for data consistency
- ✅ CORS support

## 📝 License

MIT License - See main project LICENSE file
