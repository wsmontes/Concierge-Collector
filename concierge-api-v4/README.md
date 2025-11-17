# Concierge API V4

Modern FastAPI + MongoDB backend for Concierge Collector application.

## Architecture

**Entity-Curation Model:**
- **Entities**: Restaurants, hotels, venues (universal storage)
- **Curations**: Curator reviews, concepts, recommendations
- **Metadata**: Extensible array for Google Places, Michelin, embeddings

## Tech Stack

- **FastAPI 0.104+**: Modern async Python web framework
- **MongoDB 7.0+**: Document database with flexible schema
- **Motor**: Async MongoDB driver
- **Pydantic 2.5+**: Data validation and settings
- **JWT Authentication**: Secure API access

## Setup

```bash
# Install dependencies
poetry install

# Copy environment config
cp .env.example .env

# Edit .env with your MongoDB connection string
# MONGODB_URL=mongodb://localhost:27017

# Run development server
poetry run uvicorn app.main:app --reload --port 8000

# Run tests
poetry run pytest

# Run with coverage
poetry run pytest --cov=app --cov-report=html
```

## Docker Setup

```bash
# Build and start services (API + MongoDB)
docker-compose up -d

# View logs
docker-compose logs -f api

# Stop services
docker-compose down
```

## API Documentation

Once running, access:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **Health Check**: http://localhost:8000/health

## Project Structure

```
concierge-api-v4/
├── app/
│   ├── main.py              # FastAPI app initialization
│   ├── models.py            # Pydantic models (Entity, Curation)
│   ├── database.py          # MongoDB connection and operations
│   ├── auth.py              # JWT authentication
│   ├── core/
│   │   ├── config.py        # Settings management
│   │   └── security.py      # Security utilities
│   └── routes/
│       ├── entities.py      # Entity CRUD endpoints
│       ├── curations.py     # Curation CRUD endpoints
│       └── sync.py          # Sync endpoints (Collector ↔ Concierge)
├── tests/
│   ├── test_entities.py
│   ├── test_curations.py
│   └── test_sync.py
├── pyproject.toml           # Poetry dependencies
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Key Features

- ✅ Async/await for high performance
- ✅ JWT authentication for Collector and Concierge
- ✅ Optimistic locking via version field
- ✅ Flexible metadata array for extensibility
- ✅ Comprehensive test coverage (70%+)
- ✅ Docker deployment ready
- ✅ OpenAPI/Swagger documentation

## API Endpoints

### Entities
- `GET /entities` - List/filter entities
- `GET /entities/{entity_id}` - Get single entity
- `POST /entities` - Create entity
- `PUT /entities/{entity_id}` - Update entity
- `DELETE /entities/{entity_id}` - Delete entity

### Curations
- `GET /curations` - List/filter curations
- `GET /curations/{curation_id}` - Get single curation
- `POST /curations` - Create curation
- `PUT /curations/{curation_id}` - Update curation
- `DELETE /curations/{curation_id}` - Delete curation

### Sync
- `POST /sync/pull` - Collector pulls changes from server
- `POST /sync/push` - Collector pushes changes to server
- `POST /sync/from-concierge` - Concierge sends embeddings/analysis

## Development

```bash
# Format code
poetry run black app/ tests/

# Lint
poetry run ruff check app/ tests/

# Type check
poetry run mypy app/
```

## License

Proprietary - Concierge Platform
