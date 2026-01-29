# Concierge Collector V3

**Professional restaurant curation platform with AI-powered concept extraction and offline-first architecture.**

[![Status](https://img.shields.io/badge/status-production-success)]()
[![Deployment](https://img.shields.io/badge/deployment-render.com-blue)]()
[![API](https://img.shields.io/badge/API-live-brightgreen)](https://concierge-collector.onrender.com/api/v3/docs)
[![Architecture](https://img.shields.io/badge/architecture-service--based-orange)]()

---

## 🎯 Overview

Concierge Collector is a modern restaurant curation platform that helps users discover, import, and curate restaurants with intelligent automation and offline-first capabilities.

### 🌐 Live Production

- **Frontend**: https://concierge-collector-web.onrender.com
- **API**: https://concierge-collector.onrender.com/api/v3
- **API Docs**: https://concierge-collector.onrender.com/api/v3/docs
- **Health Check**: https://concierge-collector.onrender.com/api/v3/health

### Key Features

✅ **Google OAuth Authentication** - Secure user authorization with Google Sign-In  
✅ **Automated Google Places Import** - Intelligent restaurant discovery with duplicate detection  
✅ **AI Concept Extraction** - Automatic categorization from reviews (cuisine, mood, occasion)  
✅ **Offline-First Architecture** - Full functionality without internet connection  
✅ **MongoDB V3 API** - FastAPI backend deployed on Render.com  
✅ **Service-Based Frontend** - Modular, maintainable vanilla JavaScript  
✅ **Automatic Deployment** - CI/CD from GitHub `Front-End-V3` branch  

---

## 🚀 Quick Start

### 🏠 Local Development (One Command)

```bash
./setup_local.sh  # Automated setup wizard
```

Then start the backend:
```bash
cd concierge-api-v3
./run_local.sh    # macOS/Linux
# or
run_local.bat     # Windows
```

**Frontend auto-detects local backend!** Just open `index.html` with Live Server.

📚 **Detailed guide**: [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md)

---

### 🌐 Production Deployment

The system **automatically** works on Render.com with zero code changes:
- Backend detects Render environment variables
- Frontend detects production hostname
- OAuth redirects auto-configure

See [DEPLOYMENT.md](DEPLOYMENT.md) for production setup.

---

### Prerequisites

- **Python 3.13.4** (for API)
- **MongoDB** (local or Atlas)
- **Google OAuth 2.0 Client** (optional - for authentication)
- **Google Places API Key** (optional - for restaurant import)
- **OpenAI API Key** (optional - for AI concept extraction)

### Manual Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/wsmontes/Concierge-Collector.git
   cd Concierge-Collector
   ```

2. **Set up API V3 (Backend)**
   ```bash
   cd concierge-api-v3
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```
   
   > **Note:** Only the backend (`concierge-api-v3/`) needs Python/venv. The frontend is pure HTML+JavaScript.

3. **Configure environment**
   ```bash
   # Already created by setup script, or:
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Run tests** (optional)
   ```bash
   pytest
   ```

5. **Start the API**
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

6. **Open the frontend**
   ```bash
   cd ..
   # Open index.html with Live Server (VSCode extension)
   # Or: python3 -m http.server 5500
   ```

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) | **🏠 Local development quick start** |
| [DEPLOYMENT.md](DEPLOYMENT.md) | **🚀 Production deployment guide (Render.com)** |
| [API-REF/API_DOCUMENTATION_V3.md](API-REF/API_DOCUMENTATION_V3.md) | API V3 reference |
| [docs/OAUTH_SETUP_GUIDE.md](docs/OAUTH_SETUP_GUIDE.md) | Google OAuth configuration |
| [docs/COLLECTOR_MODERNIZATION_PLAN.md](docs/COLLECTOR_MODERNIZATION_PLAN.md) | Full 20-day modernization plan |
| [archive/deployment-docs/](archive/deployment-docs/) | Legacy deployment documentation |

---

## 🏗️ Architecture

### Backend: FastAPI + MongoDB

```
concierge-api-v3/
├── main.py                    # FastAPI application entry point
├── app/
│   ├── api/                  # REST endpoints
│   │   ├── entities.py       # Entity CRUD operations
│   │   ├── curations.py      # Curation CRUD operations
│   │   └── system.py         # Health checks, API info
│   ├── core/                 # Core utilities
│   │   ├── config.py         # Settings with Pydantic
│   │   └── database.py       # MongoDB async connection
│   └── models/               # Data models
│       └── schemas.py        # Pydantic v2 schemas
└── tests/                    # 28 pytest tests (100% passing)
```

**Tech Stack**:
- FastAPI 0.109.0 (async ASGI framework)
- Motor 3.3.2 (MongoDB async driver)
- Pydantic 2.5.3 (data validation)
- Pytest 7.4.3 (testing)

### Frontend: Service-Based Vanilla JavaScript

```
scripts/
├── services/                 # Service layer (Sprint 1)
│   ├── googlePlaces/
│   │   ├── PlacesService.js      # Google Places API wrapper
│   │   ├── PlacesCache.js        # Intelligent caching with TTL
│   │   └── PlacesFormatter.js    # Data transformation
│   └── V3DataTransformer.js      # MongoDB ↔ IndexedDB compatibility
├── modules/                  # Feature modules
│   ├── placesModule.js       # Google Places UI orchestrator
│   ├── dataStorage.js        # IndexedDB wrapper with Dexie
│   └── [30+ other modules]   # Various features
└── config.js                 # Application configuration
```

**Tech Stack**:
- Vanilla JavaScript (ES6+)
- Dexie.js 3.2.2 (IndexedDB wrapper)
- Tailwind CSS (inline styling)
- ModuleWrapper pattern (custom module system)

---

## 🎨 Key Components

### PlacesService (Google Places Integration)
- Nearby search, text search, place details, geocoding
- Rate limiting (100ms between calls)
- Promise-based async interface
- Automatic error handling with retry

### PlacesCache (Intelligent Caching)
- In-memory caching with 15-minute TTL
- Hit/miss tracking and statistics
- LRU eviction strategy
- Automatic cleanup every 5 minutes

### PlacesFormatter (Data Transformation)
- Google Place → MongoDB Entity conversion
- Concept extraction from types and reviews
- Cuisine mapping (14+ cuisines)
- Display info formatting for UI

### V3DataTransformer (Data Compatibility)
- Bidirectional MongoDB ↔ IndexedDB transformation
- Field mapping: `_id` ↔ `sync.serverId`
- Date conversion: ISO 8601 ↔ Date objects
- Roundtrip validation for integrity

---

## 🔄 Development Workflow

### Sprint-Based Development

Currently following a 20-day modernization plan:

**✅ Sprint 1: Cleanup & Foundation** (3 days, COMPLETE)
- Removed Michelin module (PostgreSQL AWS dependency)
- Refactored Google Places to service architecture
- Implemented V3 data transformation layer

**📋 Sprint 2: Google Places Automation** (5 days, PLANNED)
- Auto-entity creation with deduplication
- AI-powered concept extraction
- Bulk import with progress tracking

**📋 Sprint 3: Sync & IndexedDB** (4 days, PLANNED)
- SyncManager with conflict resolution
- Optimistic locking support
- Offline queue with retry

**📋 Sprint 4: Frontend Modernization** (7 days, PLANNED)
- Vite build system
- Web Components
- StateManager with Proxy
- CSS optimization

See [docs/COLLECTOR_MODERNIZATION_PLAN.md](docs/COLLECTOR_MODERNIZATION_PLAN.md) for full details.

---

## 🧪 Testing

### API Tests
```bash
cd concierge-api-v3
pytest
```

**Coverage**: 28/28 tests passing (100%)
- System health checks: 2/2
- Entity operations: 13/13
- Curation operations: 12/12
- Integration tests: 1/1

### Frontend Tests
⏳ Coming in Sprint 4 (target: 60% coverage)

---

## 📊 Project Status

| Metric | Status | Target |
|--------|--------|--------|
| API Test Coverage | ✅ 100% | 100% |
| Sprint 1 Progress | ✅ Complete | Complete |
| Service Architecture | ✅ 4 services | 10+ services |
| Bundle Size | ⏳ ~2MB | < 500KB |
| Load Time | ⏳ ~5s | < 3s |

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for detailed metrics.

---

## 🤝 Contributing

### Development Principles

1. **Clean Architecture**: SOLID principles, separation of concerns
2. **Service-Based**: Focused services over monolithic modules
3. **Documentation First**: Every file has header explaining purpose
4. **Test Coverage**: Maintain 100% API coverage, target 60% frontend
5. **No Breaking Changes**: Always maintain backward compatibility

### Code Standards

- **Header Comments**: All files must explain purpose, responsibilities, dependencies
- **ModuleWrapper Pattern**: Use for all new modules
- **Service Layer**: Delegate complex logic to services
- **Error Handling**: Comprehensive try/catch with logging
- **Type Safety**: Consider TypeScript for new code (post-Sprint 4)

### Submission Process

1. Create feature branch from `V3`
2. Follow existing patterns and conventions
3. Update CHANGELOG.md with architectural reasoning
4. Add tests if modifying API
5. Submit PR with clear description

---

## 🐛 Known Issues

### High Priority
- Google Places API quota needs monitoring
- IndexedDB corruption recovery could be improved

### Medium Priority
- Mobile responsiveness needs testing
- Safari compatibility untested

### Low Priority
- Console warnings in development mode
- Some modules use old patterns

See GitHub Issues for full list.

---

## 📜 License

[Add your license here]

---

## 🙏 Acknowledgments

- **FastAPI**: Modern Python web framework
- **Dexie.js**: Excellent IndexedDB wrapper
- **Tailwind CSS**: Utility-first CSS framework
- **Google Places API**: Restaurant data source

---

## 📧 Contact

**Repository**: [Concierge-Collector](https://github.com/wsmontes/Concierge-Collector)  
**Branch**: V3  
**Owner**: [@wsmontes](https://github.com/wsmontes)

---

## 🗺️ Roadmap

### Current Sprint: Sprint 1 ✅ COMPLETE
Foundation cleanup, service architecture, V3 transformation

### Next Sprint: Sprint 2 📋 PLANNED  
Google Places automation, AI concept extraction, bulk import

### Future Features
- 🔄 Offline sync with conflict resolution (Sprint 3)
- ⚡ Modern build system with Vite (Sprint 4)
- 🎨 Web Components architecture (Sprint 4)
- 📱 PWA capabilities (post-Sprint 4)
- 🌍 i18n/l10n support (post-Sprint 4)
- 📊 Analytics integration (post-Sprint 4)

---

**Made with ❤️ and professional software engineering practices**

*Last Updated: November 17, 2025*
