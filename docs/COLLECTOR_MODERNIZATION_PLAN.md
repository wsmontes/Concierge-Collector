# 📋 Plano de Modernização do Concierge Collector

> **Nota de cadência:** este plano usa nomenclaturas históricas de fases; os prazos de sprint/dia não representam a execução atual contínua (vibe coding).

**Data:** 17 de Novembro de 2025  
**Versão:** V3 Modernization Roadmap  
**Status:** Planning Phase

---

## 🎯 Visão Geral

Migração completa do Collector para arquitetura moderna com:
- ✅ API V3 FastAPI (100% testes passando)
- 🔄 Frontend modernizado com padrões de mercado
- 🗄️ IndexedDB V3 totalmente compatível com MongoDB
- 🚀 Automação de criação de entities via Google Places
- 🗑️ Remoção de dependências obsoletas (Michelin PostgreSQL)

---

## 📊 Análise da Situação Atual

### **1. Michelin Staging Module** ❌ REMOVER

**Arquivo:** `scripts/modules/michelinStagingModule.js` (1841 linhas)

**Problemas:**
- Depende de banco PostgreSQL AWS (`wsmontes.pythonanywhere.com/api/restaurants-staging`)
- Lógica complexa e não mantível (1841 linhas)
- Dados Michelin serão importados em lote posteriormente
- Não alinhado com arquitetura V3

**Ação:**
- ✅ **EXCLUIR** `michelinStagingModule.js`
- ✅ Remover referências no `index.html`
- ✅ Remover configurações em `config.js`
- ✅ Criar script de importação batch separado (Python) para popular entities Michelin no futuro

---

### **2. Google Places Module** ⚠️ REFATORAR COMPLETAMENTE

**Arquivo:** `scripts/modules/placesModule.js` (3394 linhas)

**Problemas Críticos:**
- **Código massivo e não mantível** (3394 linhas em um único arquivo)
- **Lógica misturada:** UI + API + transformação de dados + cache
- **Performance ruim:** Sem debouncing adequado, cache expirado não limpo
- **Sem separação de concerns:** Tudo em uma classe gigante
- **Dependência direta do DOM:** Dificulta testes e manutenção
- **Google Places API mal utilizada:** Chamadas desnecessárias, sem rate limiting adequado

**Proposta de Refatoração:**

#### **Arquitetura Nova: Service-Based Pattern**

```
scripts/
├── services/
│   ├── googlePlaces/
│   │   ├── PlacesService.js          # Core API wrapper (200 linhas)
│   │   ├── PlacesCache.js            # Intelligent caching (150 linhas)
│   │   ├── PlacesTransformer.js      # Data transformation (200 linhas)
│   │   ├── PlacesAutomation.js       # Auto-creation logic (300 linhas)
│   │   └── PlacesConfig.js           # Configuration (100 linhas)
│   └── entities/
│       ├── EntityService.js          # CRUD operations (250 linhas)
│       └── EntityValidator.js        # Validation logic (150 linhas)
├── modules/
│   └── placesSearchUI.js             # UI only (400 linhas)
└── workers/
    └── placesAutoImport.worker.js    # Background automation (300 linhas)
```

#### **Funcionalidades Novas:**

**A) Auto-criação Inteligente de Entities**

1. **Search Triggers:**
   - Busca por nome/localização
   - Busca por coordenadas (GPS)
   - Busca por categoria/tipo de cozinha
   
2. **Entity Creation Flow:**
   ```javascript
   User Search → Places API → Transform Data → Create Entity Draft → 
   User Reviews → Auto-suggest Concepts → Save Entity
   ```

3. **Automation Rules:**
   - Se rating >= 4.0 → auto-create draft
   - Se reviews >= 100 → auto-extract concepts
   - Se tem menu/website → auto-fetch additional data
   - Duplicates detection (by Place ID)

4. **Batch Import:**
   - Import múltiplos lugares de uma área
   - Background processing com Web Worker
   - Progress tracking com notifications

**B) Smart Concept Extraction**

```javascript
// Análise automática de reviews do Google
- Keywords extraction (tipo de comida, atmosfera, preço)
- Sentiment analysis (positivo/negativo por aspecto)
- Auto-tagging (casual, fine dining, romantic, etc.)
```

**C) Performance & UX**

- **Debouncing:** 500ms para autocomplete
- **Cache Strategy:** 30min para places, 24h para details
- **Lazy Loading:** Photos on-demand
- **Progressive Enhancement:** Funciona sem API key (modo degradado)
- **Offline Support:** Cache localStorage para últimas buscas

---

### **3. IndexedDB (dataStorage.js)** 🔄 MIGRAR PARA V3

**Arquivo:** `scripts/dataStorage.js` (2595 linhas)

**Problemas:**
- Schema V3 parcialmente implementado mas não 100% compatível com MongoDB
- Campos diferentes entre IndexedDB e MongoDB
- Sync logic complexa e frágil
- Falta validação de dados antes de sync

**Ações:**

#### **A) Schema V3 - Total Compatibilidade MongoDB**

```javascript
// IndexedDB V3 Schema (MUST match MongoDB exactly)
db.version(3).stores({
    // Entities - MongoDB compatible
    entities: 'entity_id, type, name, status, createdBy, createdAt, updatedAt, version',
    
    // Curations - MongoDB compatible  
    curations: 'curation_id, entity_id, [curator.id], createdAt, updatedAt, version',
    
    // Sync Queue
    pendingSync: '++id, type, entity_id, action, createdAt, retryCount, lastError',
    
    // Local-only (não syncado)
    curators: 'curator_id, name, email, status',
    drafts: '++id, entity_id, type, status, lastModified',
    appMetadata: 'key'
});
```

#### **B) Data Transformation Layer**

```javascript
// Bidirectional transformation
class V3DataTransformer {
    // MongoDB → IndexedDB
    static toLocal(mongoDoc) {
        return {
            entity_id: mongoDoc._id,  // _id → entity_id
            ...mongoDoc,
            id: undefined,            // Remove MongoDB _id
            syncedAt: new Date()
        };
    }
    
    // IndexedDB → MongoDB
    static toRemote(localDoc) {
        return {
            _id: localDoc.entity_id,  // entity_id → _id
            ...localDoc,
            entity_id: undefined,      // Remove local entity_id
            syncedAt: undefined        // Remove local-only fields
        };
    }
}
```

#### **C) Sync Strategy**

**Novo SyncManager V3:**

```javascript
class SyncManagerV3 {
    async syncEntity(localEntity) {
        // 1. Validate local data
        const validation = EntityValidator.validate(localEntity);
        if (!validation.valid) throw new Error(validation.errors);
        
        // 2. Transform to MongoDB format
        const remoteEntity = V3DataTransformer.toRemote(localEntity);
        
        // 3. Check version conflicts
        const serverVersion = await this.getServerVersion(remoteEntity._id);
        if (serverVersion && serverVersion.version > localEntity.version) {
            return this.handleConflict(localEntity, serverVersion);
        }
        
        // 4. Send to server with retry
        const response = await this.apiClient.upsertEntity(remoteEntity);
        
        // 5. Update local with server response
        await this.updateLocal(response);
        
        return response;
    }
}
```

---

### **4. Frontend Architecture** 🎨 MODERNIZAR

**Problemas Atuais:**
- **30+ scripts carregados no index.html** (performance terrível)
- **Sem bundling/minification**
- **Tailwind CSS inline** (classes repetidas em todo HTML)
- **JavaScript vanilla espalhado** (difícil manter)
- **Sem component pattern** (código duplicado)
- **Sem state management** (bugs de sincronização)

**Proposta: Modernização Incremental (sem reescrever tudo)**

#### **Fase 1: Consolidação e Organização**

```
Consolidar módulos relacionados:
- restaurantModule + restaurantListModule → entities/
- curatorModule + draftRestaurantManager → curators/
- Remover código duplicado
- Criar barrel exports
```

#### **Fase 2: Build System Leve**

```javascript
// package.json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "vite-plugin-html": "^3.2.0"
  }
}
```

**Vite Config:**
```javascript
// vite.config.js
export default {
    build: {
        rollupOptions: {
            input: {
                main: 'index.html'
            },
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name].[ext]'
            }
        }
    }
}
```

#### **Fase 3: Component Pattern (sem framework)**

```javascript
// Usar Web Components padrão
class EntityCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }
    
    connectedCallback() {
        this.render();
    }
    
    render() {
        this.shadowRoot.innerHTML = `
            <style>
                /* Scoped CSS */
            </style>
            <div class="entity-card">
                <h3>${this.getAttribute('name')}</h3>
                <p>${this.getAttribute('type')}</p>
            </div>
        `;
    }
}

customElements.define('entity-card', EntityCard);
```

#### **Fase 4: State Management Simples**

```javascript
// Usar Proxy para reactive state
class StateManager {
    constructor(initialState) {
        this.listeners = new Map();
        this.state = new Proxy(initialState, {
            set: (target, property, value) => {
                target[property] = value;
                this.notify(property, value);
                return true;
            }
        });
    }
    
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(callback);
        
        // Return unsubscribe function
        return () => this.listeners.get(key).delete(callback);
    }
    
    notify(key, value) {
        if (this.listeners.has(key)) {
            this.listeners.get(key).forEach(cb => cb(value));
        }
    }
}

// Usage
const appState = new StateManager({
    entities: [],
    selectedEntity: null,
    syncStatus: 'idle'
});

appState.subscribe('entities', (entities) => {
    renderEntityList(entities);
});
```

---

## 🗓️ Roadmap de Implementação (Sequência Histórica)

### **Fase 1: Cleanup & Foundation**

**Bloco A:**
- ✅ Remover `michelinStagingModule.js`
- ✅ Remover referências Michelin do `config.js`
- ✅ Atualizar `index.html` (remover script Michelin)
- ✅ Documentar decisão no `CHANGELOG.md`

**Bloco B:**
- 🔄 Criar nova estrutura de pastas `services/`
- 🔄 Extrair `PlacesService.js` de `placesModule.js`
- 🔄 Criar `PlacesCache.js` standalone
- 🔄 Testes unitários para PlacesService

**Bloco C:**
- 🔄 Implementar `V3DataTransformer`
- 🔄 Atualizar schema IndexedDB para 100% compatibilidade MongoDB
- 🔄 Testes de transformação bidirecion al

---

### **Fase 2: Google Places Automation**

**Bloco A:**
- 🔄 Criar `PlacesAutomation.js`
- 🔄 Implementar auto-creation flow
- 🔄 Duplicate detection por Place ID
- 🔄 Draft entity creation

**Bloco B:**
- 🔄 Concept extraction de reviews
- 🔄 Smart tagging system
- 🔄 Background processing com Web Worker

**Bloco C:**
- 🔄 UI para batch import
- 🔄 Progress tracking
- 🔄 Error handling & retry

---

### **Fase 3: Sync & IndexedDB**

**Bloco A:**
- 🔄 Implementar `SyncManagerV3`
- 🔄 Conflict resolution strategy
- 🔄 Retry logic com exponential backoff

**Bloco B:**
- 🔄 Entity validation antes de sync
- 🔄 Partial sync (delta sync)
- 🔄 Sync status UI

---

### **Fase 4: Frontend Modernization**

**Bloco A:**
- 🔄 Setup Vite
- 🔄 Configurar build pipeline
- 🔄 Migrar scripts para módulos ES6

**Bloco B:**
- 🔄 Criar Web Components básicos
- 🔄 Entity Card component
- 🔄 Search component
- 🔄 Curation Form component

**Bloco C:**
- 🔄 Implementar StateManager
- 🔄 Migrar state management
- 🔄 Reactive UI updates

---

### **Fase 5: Polish & Testing**

**Bloco A:**
- 🔄 E2E tests (Playwright)
- 🔄 Performance profiling
- 🔄 Accessibility audit

**Bloco B:**
- 🔄 Documentation completa
- 🔄 API usage examples
- 🔄 Deployment guide

**Bloco C:**
- 🔄 User acceptance testing
- 🔄 Bug fixes
- 🔄 Production deployment

---

## 📐 Padrões Arquiteturais

### **1. Service Pattern**
```javascript
// Cada serviço é uma classe com responsabilidade única
class EntityService {
    async create(data) { /* ... */ }
    async read(id) { /* ... */ }
    async update(id, data) { /* ... */ }
    async delete(id) { /* ... */ }
}
```

### **2. Repository Pattern**
```javascript
// Abstrai acesso a dados (local/remote)
class EntityRepository {
    constructor(localStore, remoteAPI) {
        this.local = localStore;
        this.remote = remoteAPI;
    }
    
    async get(id) {
        // Try local first, fallback to remote
        return await this.local.get(id) || await this.remote.get(id);
    }
}
```

### **3. Factory Pattern**
```javascript
// Cria entities com validação
class EntityFactory {
    static fromGooglePlace(placeData) {
        return {
            entity_id: `place_${placeData.place_id}`,
            type: this.inferType(placeData.types),
            name: placeData.name,
            // ... transform
        };
    }
}
```

### **4. Observer Pattern**
```javascript
// State changes notify subscribers
class EventEmitter {
    on(event, callback) { /* ... */ }
    emit(event, data) { /* ... */ }
}
```

---

## 🧪 Estratégia de Testes

### **Unit Tests (Vitest)**
```javascript
// services/googlePlaces/PlacesService.test.js
describe('PlacesService', () => {
    it('should transform place data to entity', () => {
        const placeData = mockPlaceData();
        const entity = PlacesService.toEntity(placeData);
        expect(entity.entity_id).toBe(`place_${placeData.place_id}`);
    });
});
```

### **Integration Tests**
```javascript
// Test IndexedDB ↔ MongoDB sync
describe('SyncManager', () => {
    it('should sync local entity to server', async () => {
        const entity = await createLocalEntity();
        await syncManager.syncEntity(entity);
        const serverEntity = await fetchFromServer(entity.entity_id);
        expect(serverEntity).toMatchObject(entity);
    });
});
```

### **E2E Tests (Playwright)**
```javascript
test('should create entity from Google Place', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="search-places"]');
    await page.fill('input[name="search"]', 'Chez Panisse');
    await page.click('[data-testid="place-result-0"]');
    await page.click('[data-testid="import-place"]');
    
    await expect(page.locator('[data-testid="entity-card"]')).toBeVisible();
});
```

---

## 📚 Stack Tecnológica Final

### **Backend**
- ✅ FastAPI 0.109.0
- ✅ Motor 3.3.2 (MongoDB async)
- ✅ Pydantic 2.5.3
- ✅ Pytest (100% coverage)

### **Frontend**
- 🔄 Vite 5.0 (build tool)
- 🔄 Web Components (native)
- 🔄 Tailwind CSS 3.4
- ✅ Dexie.js 3.2.2 (IndexedDB)
- 🔄 Vitest (unit tests)
- 🔄 Playwright (E2E tests)

### **External APIs**
- 🔄 Google Places API (new wrapper)
- ❌ Michelin PostgreSQL (removed)

---

## 🎯 Métricas de Sucesso

- ✅ **API Tests:** 100% passing (28/28)
- 🎯 **Frontend Tests:** 90%+ coverage
- 🎯 **Performance:** < 3s initial load
- 🎯 **Bundle Size:** < 500KB gzipped
- 🎯 **Lighthouse Score:** 90+ (all categories)
- 🎯 **Entity Creation:** < 30s from Google Place
- 🎯 **Sync Success Rate:** 99%+

---

## ✅ Próximos Passos Imediatos

1. **AGORA:** Remover Michelin module
2. **HOJE:** Criar estrutura `services/`
3. **AMANHÃ:** Extrair PlacesService
4. **Esta Semana:** IndexedDB V3 compatibility

---

**Criado por:** GitHub Copilot  
**Aprovado por:** [Aguardando]  
**Última Atualização:** 2025-11-17
