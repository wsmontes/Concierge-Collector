# Technical Implementation Plan - Curator Interface Redesign

**Data:** 18 de Novembro, 2025  
**Versão:** 1.0  
**Baseado em:** [CURATOR_INTERFACE_REDESIGN.md](./CURATOR_INTERFACE_REDESIGN.md)

---

## 📋 Índice

1. [Arquitetura Técnica](#arquitetura-técnica)
2. [Estrutura de Dados](#estrutura-de-dados)
3. [Módulos e Services](#módulos-e-services)
4. [Implementação por Fase](#implementação-por-fase)
5. [API Endpoints](#api-endpoints)
6. [Database Schema](#database-schema)
7. [Testing Strategy](#testing-strategy)

---

## 🏗️ Arquitetura Técnica

### Stack Atual

**Backend:**
- FastAPI 0.109.0 (Python 3.11+)
- MongoDB Atlas (Motor async driver)
- OpenAI API (GPT-4, Whisper, Vision)
- Google Places API

**Frontend:**
- Vanilla JavaScript (ES6+)
- Dexie.js 3.2.2 (IndexedDB)
- Tailwind CSS (inline)
- ModuleWrapper pattern (DI)

**Data Flow:**
```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                          │
│  (HTML + TailwindCSS + Vanilla JS)                          │
└────────────┬────────────────────────────────┬───────────────┘
             │                                │
             ▼                                ▼
┌─────────────────────┐          ┌─────────────────────────┐
│   Frontend Services │          │   Frontend Modules      │
│  - PlacesService    │          │  - PlacesSearchModule   │
│  - ApiService       │          │  - CurationEditorModule │
│  - DataStore        │          │  - EntityDetailModule   │
│  - SyncManager      │          │  - DashboardModule      │
└──────────┬──────────┘          └──────────┬──────────────┘
           │                                 │
           └────────────┬────────────────────┘
                        │
                        ▼
           ┌─────────────────────────┐
           │   IndexedDB (Dexie)     │
           │  - entities             │
           │  - curations            │
           │  - curators             │
           │  - recentViews          │
           │  - favorites            │
           └─────────┬───────────────┘
                     │
                     ▼ (Sync)
           ┌─────────────────────────┐
           │  FastAPI Backend V3     │
           │  + MongoDB Atlas        │
           └─────────┬───────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌─────────────┐ ┌──────────┐ ┌──────────────┐
│ Google      │ │ OpenAI   │ │ MongoDB      │
│ Places API  │ │ APIs     │ │ Collections: │
└─────────────┘ └──────────┘ │ - entities   │
                              │ - curations  │
                              │ - categories │
                              └──────────────┘
```

### Design Patterns

**1. ModuleWrapper Pattern** (Dependency Injection)
```javascript
const MyModule = ModuleWrapper.defineClass('MyModule', class {
    constructor() {
        this.log = Logger.module('MyModule');
    }
    
    async initialize() {
        // Setup
    }
});

// Usage
window.MyModule = await new MyModule().initialize();
```

**2. Service Layer Pattern**
- Services são stateless, focados em uma API/recurso
- Modules são stateful, orquestram UI + services
- DataStore é singleton, gerencia cache local

**3. Offline-First Pattern**
- Operações sempre em IndexedDB primeiro
- Sync assíncrono em background
- Optimistic UI updates

---

## 💾 Estrutura de Dados

### IndexedDB Schema (Dexie v7+)

```javascript
// dataStore.js - Version 8 (nova)
this.db.version(8).stores({
    // Entities (objective data)
    entities: '++id, entity_id, type, name, status, externalId, createdAt, updatedAt, sync.status',
    
    // Curations (subjective opinions)
    curations: '++id, curation_id, entity_id, curator_id, status, createdAt, updatedAt, sync.status',
    
    // Curators
    curators: '++id, curator_id, name, email, status, lastActive',
    
    // Working Set Management (NOVO)
    recentViews: '++id, entity_id, curator_id, viewedAt, source',
    favorites: '++id, entity_id, curator_id, addedAt, notes',
    
    // System
    drafts: '++id, type, data, curator_id, createdAt, lastModified',
    syncQueue: '++id, type, action, local_id, entity_id, data, createdAt, retryCount',
    settings: 'key',
    cache: 'key, expires'
});
```

### Entity Structure (MongoDB + IndexedDB)

```typescript
interface Entity {
    _id: string;                    // MongoDB ObjectId
    entity_id: string;              // Unique identifier (e.g., "rest_mani_sp")
    type: EntityType;               // "restaurant" | "bar" | "hotel" | "cafe" | "other"
    name: string;                   // Entity name
    status: EntityStatus;           // "active" | "inactive" | "draft"
    externalId?: string;            // Google Place ID, Michelin ID, etc.
    
    // Objective data
    data: {
        location?: {
            lat: number;
            lng: number;
            address: string;
            city?: string;
            country?: string;
        };
        contacts?: {
            phone?: string;
            website?: string;
            email?: string;
        };
        media?: {
            photos: string[];       // URLs
            videos?: string[];
        };
        googlePlaces?: {
            rating: number;
            user_ratings_total: number;
            price_level: number;
            opening_hours?: any;
        };
    };
    
    // Metadata from multiple sources
    metadata: MetadataSource[];
    
    // Sync info
    sync?: {
        status: 'synced' | 'pending' | 'conflict' | 'error';
        lastSyncedAt?: Date;
        serverId?: string;
    };
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    createdBy?: string;             // curator_id
    updatedBy?: string;
    version: number;                // Optimistic locking
}

interface MetadataSource {
    type: string;                   // "google_places" | "ai_extraction" | "michelin"
    source: string;                 // Place ID, import batch ID, etc.
    importedAt: Date;
    data: {
        [category: string]: string[];  // Dynamic categories with concepts
    };
}
```

### Curation Structure

```typescript
interface Curation {
    _id: string;
    curation_id: string;            // Unique identifier
    entity_id: string;              // Reference to entity
    
    // Curator info
    curator: {
        id: string;
        name: string;
        email?: string;
    };
    
    // Subjective opinion
    notes: {
        public?: string;            // Visible to all
        private?: string;           // Only curator sees
    };
    
    // Concepts organized by categories (from MongoDB)
    categories: {
        [categoryName: string]: string[];  // Dynamic!
        // Example:
        // "Cuisine": ["Italian", "Contemporary"],
        // "Menu": ["Fresh Pasta", "Pumpkin Ravioli"]
    };
    
    // Audio/transcription
    audio?: {
        url?: string;
        duration?: number;
        transcription?: string;
    };
    
    // Metadata
    sources: string[];              // ["personal_visit", "audio_recording"]
    visitDate?: Date;
    
    // Status
    status: 'draft' | 'published';
    
    // Sync
    sync?: {
        status: 'synced' | 'pending' | 'conflict' | 'error';
        lastSyncedAt?: Date;
    };
    
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    version: number;
}
```

### Recent Views (NEW)

```typescript
interface RecentView {
    id?: number;                    // Auto-increment (IndexedDB)
    entity_id: string;
    curator_id: string;
    viewedAt: Date;
    source: 'search' | 'detail' | 'list' | 'link';
    context?: {
        searchQuery?: string;
        fromCuration?: string;
    };
}
```

### Favorites (NEW)

```typescript
interface Favorite {
    id?: number;
    entity_id: string;
    curator_id: string;
    addedAt: Date;
    notes?: string;                 // Personal notes about why favorited
    priority?: number;              // 1-5 for sorting
}
```

---

## 🧩 Módulos e Services

### Novos Módulos a Criar

#### 1. PlacesSearchModule
**Arquivo:** `scripts/modules/placesSearchModule.js`

**Responsabilidades:**
- UI de busca do Google Places
- Auto-save de entities no MongoDB/IndexedDB
- Filtros (type, distance, nearby)
- Results display com status de curation
- Integration com PlacesService + ApiService

**API Pública:**
```javascript
class PlacesSearchModule {
    async initialize()
    async openSearch(options)           // Abre modal/tela de busca
    async search(query, filters)        // Executa busca
    async nearbySearch(location, filters) // Busca nearby
    async selectEntity(entity_id)       // Usuario clica em result
    async quickCurate(entity_id)        // Shortcut para curar
    close()                             // Fecha interface
}
```

**Dependências:**
- `PlacesService` (Google Places API)
- `ApiService` (Save entities to backend)
- `DataStore` (Local cache)
- `UIManager` (Show/hide)

**Fluxo:**
```
1. User types "Maní São Paulo"
2. PlacesService.searchByText(query)
3. Results returned (20-50 entities)
4. For each result:
   - Transform Google Places → Entity schema
   - ApiService.createEntity(entity) → MongoDB
   - DataStore.createEntity(entity) → IndexedDB
   - (Auto-save, silent, background)
5. Display results with status badges
6. User clicks "View Details" → EntityDetailModule
7. User clicks "Create Curation" → CurationEditorModule
```

#### 2. CurationEditorModule
**Arquivo:** `scripts/modules/curationEditorModule.js`

**Responsabilidades:**
- Recording UI (CTA principal - 90% dos casos)
- Transcription (Whisper integration)
- Concept extraction (GPT-4)
- Dynamic category form (from MongoDB)
- Notes (public/private)
- Draft/Publish management

**API Pública:**
```javascript
class CurationEditorModule {
    async initialize()
    async createCuration(entity_id)     // New curation
    async editCuration(curation_id)     // Edit existing
    async startRecording()              // Recording flow
    async stopRecording()
    async transcribe(audioBlob)         // Whisper API
    async extractConcepts(text)         // GPT-4 + MongoDB categories
    async saveDraft()
    async publish()
    async discard()
    close()
}
```

**Dependências:**
- `AudioRecorder` (existing)
- `ApiService` (AI endpoints + curation CRUD)
- `DataStore` (Local save)
- `CategoryService` (NEW - fetch categories from backend)

**Fluxo Recording (90%):**
```
1. User clicks "🔴 START RECORDING"
2. AudioRecorder.start()
3. User talks (max 5min)
4. AudioRecorder.stop() → audioBlob
5. ApiService.transcribe(audioBlob) → Whisper API
   - Returns: { text, duration }
6. Display transcription (editable)
7. ApiService.extractConcepts(text, entity.type) → GPT-4
   - Backend fetches categories from MongoDB
   - Returns: { Cuisine: [...], Menu: [...], ... }
8. Populate dynamic form with extracted concepts
9. User reviews/edits
10. saveDraft() or publish()
```

**Fluxo Manual (10%):**
```
1. User clicks "Skip Recording"
2. Shows textarea for manual transcription
3. User types review
4. Clicks "Extract Concepts" → same GPT-4 flow
   OR
5. Clicks "Fill Manually" → goes to form empty
```

#### 3. EntityDetailModule
**Arquivo:** `scripts/modules/entityDetailModule.js`

**Responsabilidades:**
- Display entity objective data
- Display all curations (multi-curator)
- Highlight user's curation
- CTA: Create/Edit My Curation
- Add to Favorites

**API Pública:**
```javascript
class EntityDetailModule {
    async initialize()
    async showEntity(entity_id)
    async loadAllCurations(entity_id)
    async createMyCuration()            // → CurationEditorModule
    async editMyCuration(curation_id)
    async addToFavorites()
    async viewCuration(curation_id)     // Other curator's
    close()
}
```

#### 4. DashboardModule (My Curations)
**Arquivo:** `scripts/modules/dashboardModule.js`

**Responsabilidades:**
- Display stats (X curations, Y drafts, Z recent)
- Tabs: My Curations, Recently Viewed, Favorites
- Filters and sorting
- Quick actions (Search, Sync)

**API Pública:**
```javascript
class DashboardModule {
    async initialize()
    async loadStats()
    async showTab(tabName)              // 'curations' | 'recent' | 'favorites'
    async loadMyCurations(filters)
    async loadRecentViews()
    async loadFavorites()
    async openSearch()                  // → PlacesSearchModule
    async openEntity(entity_id)         // → EntityDetailModule
}
```

#### 5. WorkingSetManager (NEW Service)
**Arquivo:** `scripts/services/workingSetManager.js`

**Responsabilidades:**
- Track recent views (add to recentViews table)
- Manage favorites (CRUD)
- Cleanup old views (keep last 100 or 7 days)
- Query working set efficiently

**API Pública:**
```javascript
class WorkingSetManager {
    async trackView(entity_id, source, context)
    async getRecentViews(curator_id, limit)
    async addFavorite(entity_id, notes)
    async removeFavorite(entity_id)
    async getFavorites(curator_id)
    async isInWorkingSet(entity_id)
    async cleanupOldViews()             // Cron job
}
```

#### 6. CategoryService (NEW Service)
**Arquivo:** `scripts/services/categoryService.js`

**Responsabilidades:**
- Fetch categories from backend por entity type
- Cache categories (1h TTL like backend)
- Provide to concept extraction
- Validate concepts against categories

**API Pública:**
```javascript
class CategoryService {
    async initialize()
    async getCategories(entity_type)    // "restaurant" → ["Cuisine", "Menu", ...]
    async validateConcept(category, concept)
    clearCache()
}
```

### Módulos Existentes a Modificar

#### DataStore (dataStore.js)
**Adicionar:**
- `recentViews` table methods
- `favorites` table methods
- Query helpers para working set

```javascript
// New methods
async addRecentView(entity_id, curator_id, source, context)
async getRecentViews(curator_id, limit = 100)
async addFavorite(entity_id, curator_id, notes)
async removeFavorite(entity_id, curator_id)
async getFavorites(curator_id)
async getCuratorWorkingSet(curator_id)  // Curations + Recent + Favorites
```

#### ApiService (apiService.js)
**Adicionar:**
- Endpoints de categories
- Bulk entity creation (for search results)

```javascript
// New methods
async getCategories(entity_type)
async bulkCreateEntities(entities)      // Batch save from Places search
```

#### UIManager (uiManager.js)
**Modificar:**
- Remover lógica de `hideAllSections`
- Adicionar gerenciamento de modals/views
- Suporte para tabs

```javascript
// Refactor to
async showView(viewName)                // 'dashboard' | 'search' | 'detail' | 'editor'
async showModal(modalName, options)
async hideModal(modalName)
getCurrentView()
```

---

## 🚀 Implementação por Fase

### FASE 1: Infraestrutura (Semana 1, Dias 1-2)

**Objetivo:** Preparar base técnica sem quebrar nada

**Tasks:**
1. **Database Schema Update**
   - [ ] Adicionar `recentViews` table (dataStore.js version 8)
   - [ ] Adicionar `favorites` table
   - [ ] Migration automática (Dexie handles)
   - [ ] Testes: Create, read, query

2. **WorkingSetManager Service**
   - [ ] Create `scripts/services/workingSetManager.js`
   - [ ] Implement trackView, addFavorite, etc.
   - [ ] Add to ModuleWrapper initialization
   - [ ] Unit tests

3. **CategoryService**
   - [ ] Create `scripts/services/categoryService.js`
   - [ ] Fetch from `/api/v3/categories` (NEW endpoint needed!)
   - [ ] 1h cache with TTL
   - [ ] Fallback para hardcoded list se backend fail

4. **Backend: Categories Endpoint**
   - [ ] `GET /api/v3/categories?entity_type=restaurant`
   - [ ] Returns: `{ entity_type, categories: [...], cache_ttl }`
   - [ ] Populate MongoDB `categories` collection se vazio

**Files Modified:**
- `scripts/dataStore.js` (+100 lines)
- `scripts/services/workingSetManager.js` (NEW, ~200 lines)
- `scripts/services/categoryService.js` (NEW, ~150 lines)
- `concierge-api-v3/app/api/categories.py` (NEW, ~100 lines)

**Testing:**
```bash
# Backend
pytest tests/test_categories_endpoint.py

# Frontend (manual)
- Open console
- window.WorkingSetManager.trackView('test_id', 'manual')
- window.WorkingSetManager.getRecentViews('curator_1')
- window.CategoryService.getCategories('restaurant')
```

---

### FASE 2: Places Search (Semana 1, Dias 3-5)

**Objetivo:** Implementar busca de entities com auto-save

**Tasks:**
1. **PlacesSearchModule - UI**
   - [ ] Create `scripts/modules/placesSearchModule.js`
   - [ ] HTML template (modal ou full-screen)
   - [ ] Search bar + filters (type, distance)
   - [ ] Nearby button
   - [ ] Results grid/list

2. **PlacesSearchModule - Logic**
   - [ ] Integration com PlacesService (existing)
   - [ ] Transform Google Places → Entity schema
   - [ ] Auto-save entities (background)
   - [ ] Status badges (curated/not curated)
   - [ ] Click handlers (View Details, Quick Curate)

3. **Bulk Entity Save**
   - [ ] ApiService.bulkCreateEntities(entities[])
   - [ ] Backend: `POST /api/v3/entities/bulk`
   - [ ] Handles duplicates (by externalId)
   - [ ] Returns: { created: N, skipped: M, errors: [] }

4. **Auto-Save Flow**
   - [ ] PlacesSearchModule.search() returns results
   - [ ] For each result: transform + save (silent)
   - [ ] Show progress: "Auto-saving 23 entities..."
   - [ ] Handle errors gracefully (log, não falha UI)

**Files Created:**
- `scripts/modules/placesSearchModule.js` (~500 lines)
- HTML in `index.html` or template

**Files Modified:**
- `scripts/apiService.js` (+50 lines)
- `concierge-api-v3/app/api/entities.py` (+bulk endpoint, ~80 lines)

**Testing:**
```javascript
// Console
window.PlacesSearchModule.openSearch()
// Type "pizza São Paulo"
// Verify: 20-50 entities saved to MongoDB + IndexedDB
// Verify: Results show status badges
// Click "View Details" → should open EntityDetailModule (stub ok)
```

---

### FASE 3: Dashboard (Semana 2, Dias 1-2)

**Objetivo:** My Curations view com tabs

**Tasks:**
1. **DashboardModule - UI**
   - [ ] Create `scripts/modules/dashboardModule.js`
   - [ ] Stats cards (curations, drafts, recent, favorites)
   - [ ] Tabs: My Curations, Recently Viewed, Favorites
   - [ ] Filters: All, Published, Drafts
   - [ ] Sorting: Recent, Name, City

2. **DashboardModule - Data Queries**
   - [ ] loadMyCurations(): Query curations by curator_id
   - [ ] loadRecentViews(): Query recentViews + join entities
   - [ ] loadFavorites(): Query favorites + join entities
   - [ ] Efficient queries (indexed fields)

3. **Entity Cards**
   - [ ] Component para entity card
   - [ ] Shows: name, type, location
   - [ ] Status badge (published/draft)
   - [ ] Actions: View, Edit Curation
   - [ ] Reusable across tabs

4. **Navigation**
   - [ ] Replace old "entities-section" com Dashboard
   - [ ] Update UIManager.showView()
   - [ ] Set Dashboard as default view

**Files Created:**
- `scripts/modules/dashboardModule.js` (~400 lines)

**Files Modified:**
- `scripts/uiManager.js` (refactor views)
- `index.html` (novo HTML para dashboard)

**Testing:**
```javascript
// Should show:
// - Stats: X curations, Y drafts, Z recent, W favorites
// - Tab My Curations: list of curated entities
// - Tab Recent: entities viewed in last 7 days
// - Tab Favorites: empty initially
```

---

### FASE 4: Entity Detail View (Semana 2, Dias 3-4)

**Objetivo:** Visualizar entity + all curations

**Tasks:**
1. **EntityDetailModule - UI**
   - [ ] Create `scripts/modules/entityDetailModule.js`
   - [ ] Entity Info section (objective data)
   - [ ] Location map (Google Maps embed)
   - [ ] Photos gallery
   - [ ] Metadata display (sources)

2. **Curations Display**
   - [ ] Load all curations for entity
   - [ ] Highlight user's curation
   - [ ] Show other curators' curations (collapsed)
   - [ ] Expandable to read full curation

3. **Actions**
   - [ ] CTA: "Create My Curation" (if não tem)
   - [ ] Button: "Edit My Curation" (if tem)
   - [ ] Button: "Add to Favorites"
   - [ ] Link: "View on Google Maps"

4. **Navigation**
   - [ ] Open from PlacesSearchModule results
   - [ ] Open from Dashboard entity cards
   - [ ] Back button returns to previous view

**Files Created:**
- `scripts/modules/entityDetailModule.js` (~350 lines)

**Files Modified:**
- `scripts/modules/placesSearchModule.js` (add navigation)
- `scripts/modules/dashboardModule.js` (add navigation)

**Testing:**
```javascript
// From search results, click entity
// Should show:
// - Entity name, type, address, photos
// - Google Places rating
// - Metadata (source: Google Places)
// - Section: "You haven't curated this yet"
// - Button: "Create My Curation"
```

---

### FASE 5: Curation Editor (Semana 3, Dias 1-5)

**Objetivo:** Core feature - recording + concepts + notes

**Tasks:**
1. **CurationEditorModule - Base**
   - [ ] Create `scripts/modules/curationEditorModule.js`
   - [ ] Entity context card (top)
   - [ ] Modal ou full-screen view
   - [ ] State management (draft, recording, transcribing, etc.)

2. **Recording Flow (Priority!)**
   - [ ] Integration com AudioRecorder (existing)
   - [ ] Circular timer UI (00:00 / 05:00)
   - [ ] Waveform animation (visual feedback)
   - [ ] CTA grande: "🔴 START RECORDING"
   - [ ] Stop, play, re-record

3. **Transcription**
   - [ ] ApiService.transcribe(audioBlob) → Whisper
   - [ ] Show progress: "⏳ Transcribing..."
   - [ ] Display transcription (editable textarea)
   - [ ] Button: "🔄 Re-transcribe" se editou

4. **Concept Extraction**
   - [ ] Fetch categories: CategoryService.getCategories(entity.type)
   - [ ] ApiService.extractConcepts(text, entity.type) → GPT-4
   - [ ] Show progress: "⏳ Extracting concepts..."
   - [ ] Populate dynamic form com conceitos extraídos

5. **Dynamic Concepts Form**
   - [ ] Iterate over categories (from backend)
   - [ ] For each category: section with chips/tags
   - [ ] Editable: Remove tag (X), Add tag (+)
   - [ ] Validation: Concepts belong to category
   - [ ] NO hardcoded categories!

6. **Notes**
   - [ ] Public notes textarea
   - [ ] Private notes textarea
   - [ ] Character count (optional)

7. **Metadata**
   - [ ] Visit date picker (optional)
   - [ ] Source dropdown (personal_visit, audio, etc.)

8. **Save Actions**
   - [ ] Save Draft: DataStore + SyncQueue
   - [ ] Publish: Update status + sync
   - [ ] Discard: Confirm dialog

9. **Manual Entry Flow (10%)**
   - [ ] Button: "Skip Recording"
   - [ ] Textarea for manual transcription
   - [ ] Same extraction flow

**Files Created:**
- `scripts/modules/curationEditorModule.js` (~800 lines)

**Files Modified:**
- `scripts/apiService.js` (add AI endpoints wrappers)
- `scripts/services/categoryService.js` (use in extraction)

**Testing:**
```javascript
// From entity detail, click "Create My Curation"
// Should open editor with:
// - Entity context card
// - Recording CTA (large, prominent)
// - All other sections collapsed/hidden
// 
// Test Recording Flow:
// 1. Click "START RECORDING"
// 2. Grant mic permission
// 3. Speak for 10 seconds
// 4. Click "STOP"
// 5. Verify: Audio plays back
// 6. Verify: "Transcribing..." appears
// 7. Verify: Transcription text appears
// 8. Verify: "Extracting concepts..." appears
// 9. Verify: Form populates with concepts
// 10. Edit concepts (add/remove)
// 11. Fill notes
// 12. Click "Publish"
// 13. Verify: Saved to DataStore + synced to MongoDB
```

---

### FASE 6: Cleanup & Polish (Semana 4)

**Objetivo:** Remover código legacy, otimizar, polish

**Tasks:**
1. **Remove Legacy Sections**
   - [ ] Delete `quick-actions-section` HTML
   - [ ] Delete `recording-section` (substituído)
   - [ ] Delete `transcription-section` (substituído)
   - [ ] Refactor `concepts-section` (agora CurationEditor)

2. **UIManager Refactor**
   - [ ] Remove hideAllSections() logic
   - [ ] Implement showView() router
   - [ ] Modal management
   - [ ] Clean up dead code

3. **Navigation Polish**
   - [ ] Persistent top nav bar
   - [ ] Breadcrumbs (optional)
   - [ ] Back button handling
   - [ ] Deep linking (URL routing)

4. **Performance**
   - [ ] Lazy load modules (dynamic import)
   - [ ] Pagination em entity lists
   - [ ] Virtual scrolling (se >1000 items)
   - [ ] Image lazy loading

5. **Accessibility**
   - [ ] ARIA labels
   - [ ] Keyboard navigation
   - [ ] Focus management
   - [ ] Screen reader testing

6. **Error Handling**
   - [ ] User-friendly error messages
   - [ ] Retry logic
   - [ ] Offline mode graceful degradation
   - [ ] Network status indicator

---

## 🔌 API Endpoints

### Existing Endpoints (V3 Backend)

```
✅ GET    /api/v3/health
✅ GET    /api/v3/info
✅ GET    /api/v3/entities
✅ POST   /api/v3/entities
✅ GET    /api/v3/entities/{entity_id}
✅ PATCH  /api/v3/entities/{entity_id}
✅ DELETE /api/v3/entities/{entity_id}
✅ GET    /api/v3/curations
✅ POST   /api/v3/curations
✅ GET    /api/v3/curations/{curation_id}
✅ PATCH  /api/v3/curations/{curation_id}
✅ DELETE /api/v3/curations/{curation_id}
✅ POST   /api/v3/ai/transcribe
✅ POST   /api/v3/ai/concepts
✅ POST   /api/v3/ai/vision
```

### New Endpoints Needed

#### 1. Categories
```http
GET /api/v3/categories?entity_type=restaurant

Response 200:
{
  "entity_type": "restaurant",
  "categories": [
    "Cuisine",
    "Menu",
    "Price Range",
    "Mood",
    "Setting",
    "Crowd",
    "Suitable For",
    "Food Style",
    "Drinks",
    "Special Features"
  ],
  "cache_ttl": 3600,
  "updated_at": "2025-11-18T10:00:00Z"
}
```

**Backend Implementation:**
```python
# concierge-api-v3/app/api/categories.py

from fastapi import APIRouter, Query
from app.services.category_service import CategoryService

router = APIRouter()

@router.get("/categories")
async def get_categories(
    entity_type: str = Query("restaurant", description="Entity type"),
    db = Depends(get_database)
):
    category_service = CategoryService(db)
    categories = await category_service.get_categories(entity_type)
    
    return {
        "entity_type": entity_type,
        "categories": categories,
        "cache_ttl": 3600
    }
```

#### 2. Bulk Entity Creation
```http
POST /api/v3/entities/bulk

Request Body:
{
  "entities": [
    {
      "entity_id": "rest_mani_sp",
      "type": "restaurant",
      "name": "Maní",
      "externalId": "ChIJN1t_tDeuEmsRUsoyG83frY4",
      "data": { ... }
    },
    // ... até 50 entities
  ],
  "skip_duplicates": true,
  "source": "google_places_search"
}

Response 201:
{
  "created": 45,
  "skipped": 5,
  "errors": [],
  "entities": [ ... ]  // Created entities com IDs
}
```

**Backend Implementation:**
```python
@router.post("/entities/bulk")
async def bulk_create_entities(
    request: BulkEntityCreate,
    db = Depends(get_database)
):
    results = {
        "created": 0,
        "skipped": 0,
        "errors": [],
        "entities": []
    }
    
    for entity_data in request.entities:
        # Check if exists by externalId
        if request.skip_duplicates:
            existing = await db.entities.find_one({
                "externalId": entity_data.externalId
            })
            if existing:
                results["skipped"] += 1
                continue
        
        # Create entity
        try:
            entity = await create_entity_internal(entity_data, db)
            results["created"] += 1
            results["entities"].append(entity)
        except Exception as e:
            results["errors"].append({
                "entity_id": entity_data.entity_id,
                "error": str(e)
            })
    
    return results
```

#### 3. Curations by Entity
```http
GET /api/v3/entities/{entity_id}/curations

Response 200:
{
  "entity_id": "rest_mani_sp",
  "count": 3,
  "curations": [
    { ... },  // Full curation objects
    { ... },
    { ... }
  ]
}
```

---

## 🧪 Testing Strategy

### Unit Tests (Frontend)

**Framework:** Jest + jsdom (ou Vitest)

```javascript
// tests/services/categoryService.test.js
describe('CategoryService', () => {
    test('fetches categories from backend', async () => {
        const service = new CategoryService();
        const categories = await service.getCategories('restaurant');
        expect(categories).toContain('Cuisine');
        expect(categories).toContain('Menu');
    });
    
    test('caches categories for 1h', async () => {
        // Mock fetch
        // Call twice
        // Verify fetch called only once
    });
});

// tests/modules/placesSearchModule.test.js
describe('PlacesSearchModule', () => {
    test('auto-saves entities after search', async () => {
        const module = new PlacesSearchModule();
        const results = await module.search('pizza');
        
        // Verify entities saved to DataStore
        const entities = await DataStore.getEntities();
        expect(entities.length).toBeGreaterThan(0);
    });
});
```

### Integration Tests (Backend)

```python
# tests/test_categories_endpoint.py
def test_get_categories_restaurant():
    response = client.get("/api/v3/categories?entity_type=restaurant")
    assert response.status_code == 200
    data = response.json()
    assert "categories" in data
    assert len(data["categories"]) > 0

def test_bulk_create_entities():
    entities = [
        {"entity_id": "test1", "name": "Test 1", ...},
        {"entity_id": "test2", "name": "Test 2", ...}
    ]
    response = client.post("/api/v3/entities/bulk", json={"entities": entities})
    assert response.status_code == 201
    assert response.json()["created"] == 2
```

### E2E Tests

**Framework:** Playwright ou Cypress

```javascript
// e2e/curation-flow.spec.js
test('complete curation flow', async ({ page }) => {
    // 1. Open app
    await page.goto('http://localhost:3000');
    
    // 2. Open search
    await page.click('#open-search-btn');
    
    // 3. Search for entity
    await page.fill('#search-input', 'Maní São Paulo');
    await page.click('#search-btn');
    
    // 4. Wait for results
    await page.waitForSelector('.entity-card');
    
    // 5. Click first result
    await page.click('.entity-card:first-child .view-details-btn');
    
    // 6. Click "Create My Curation"
    await page.click('#create-curation-btn');
    
    // 7. Skip recording (for speed)
    await page.click('#skip-recording-btn');
    
    // 8. Type transcription
    await page.fill('#transcription-textarea', 'Amazing restaurant...');
    
    // 9. Extract concepts
    await page.click('#extract-concepts-btn');
    
    // 10. Wait for concepts
    await page.waitForSelector('.concept-tag');
    
    // 11. Fill notes
    await page.fill('#public-notes', 'Best pasta in São Paulo!');
    
    // 12. Publish
    await page.click('#publish-btn');
    
    // 13. Verify success
    await expect(page.locator('.success-message')).toBeVisible();
});
```

---

## 📊 Métricas de Sucesso

### Performance
- [ ] Places Search: < 2s (incluindo auto-save)
- [ ] Entity Detail load: < 1s
- [ ] Recording → Transcription: < 10s (depende Whisper API)
- [ ] Concept Extraction: < 5s (depende GPT-4 API)
- [ ] Dashboard load: < 1s (com 100 entities)

### User Experience
- [ ] 90% dos curadores usam recording (track via analytics)
- [ ] 80% das curations publicadas (vs drafts abandonados)
- [ ] Avg time to curate: < 3 min (record → transcribe → publish)

### Code Quality
- [ ] 80% test coverage (unit + integration)
- [ ] 0 critical bugs (Sentry)
- [ ] < 100ms main thread blocking (Lighthouse)
- [ ] Acessibilidade: Score > 90 (Lighthouse)

---

## 🚨 Riscos e Mitigações

| Risco | Impacto | Probabilidade | Mitigação |
|-------|---------|---------------|-----------|
| Google Places API rate limit | Alto | Médio | Implement caching, batch requests, fallback to cached data |
| OpenAI API downtime | Alto | Baixo | Fallback to manual concept entry, retry queue |
| IndexedDB quota exceeded | Médio | Baixo | Cleanup old recentViews, compression |
| Categories schema change | Baixo | Médio | Version categories in MongoDB, graceful degradation |
| Recording não funciona (iOS Safari) | Alto | Médio | Always offer manual transcription, clear error messages |
| Sync conflicts | Médio | Médio | Optimistic locking já implementado, UI para resolver |

---

## 📅 Timeline Detalhado

### Semana 1: Infraestrutura + Places Search
- **Dia 1-2:** Database schema + WorkingSetManager + CategoryService
- **Dia 3:** PlacesSearchModule UI
- **Dia 4:** PlacesSearchModule auto-save + backend bulk endpoint
- **Dia 5:** Testing + bug fixes

### Semana 2: Dashboard + Entity Detail
- **Dia 1:** DashboardModule stats + My Curations tab
- **Dia 2:** Recent Views + Favorites tabs
- **Dia 3:** EntityDetailModule UI
- **Dia 4:** All curations display + navigation
- **Dia 5:** Testing + polish

### Semana 3: Curation Editor (Core!)
- **Dia 1:** CurationEditorModule base + UI
- **Dia 2:** Recording flow + Whisper integration
- **Dia 3:** Concept extraction + dynamic form
- **Dia 4:** Notes + metadata + save actions
- **Dia 5:** Testing + edge cases

### Semana 4: Cleanup + Launch
- **Dia 1-2:** Remove legacy code + UIManager refactor
- **Dia 3:** Performance optimization
- **Dia 4:** Accessibility + polish
- **Dia 5:** E2E testing + deployment

---

## ✅ Definition of Done

### Por Feature
- [ ] Code written + reviewed
- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing
- [ ] Manual testing (happy path + edge cases)
- [ ] Acessibilidade verificada (keyboard nav, screen reader)
- [ ] Performance verificada (Lighthouse)
- [ ] Documentation atualizada
- [ ] PR aprovado + merged

### Launch Checklist
- [ ] Todas as features completas (Fase 1-5)
- [ ] Todos os testes passing
- [ ] Backend deployed (PythonAnywhere)
- [ ] Frontend deployed
- [ ] Rollback plan documentado
- [ ] Monitoring ativo (Sentry, analytics)
- [ ] User documentation (video + wiki)

---

## 📞 Próximos Passos

1. **Review deste documento** com stakeholder
2. **Setup projeto** (criar branches, tickets)
3. **Começar Fase 1** - Infraestrutura
4. **Daily standups** (15min) para tracking
5. **Demo** ao final de cada semana

---

**Documento vivo** - Atualizar conforme implementação progride.

**Última atualização:** 2025-11-18
