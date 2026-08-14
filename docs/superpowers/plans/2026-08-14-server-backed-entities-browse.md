# Browse Server-backed das Entities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A aba Entities do Collector passa a navegar o acervo completo do servidor (busca/filtros server-side com paginação), mantendo o fluxo offline-first de curations intacto.

**Architecture:** Espelha o padrão já provado das Curations: um `EntityBrowser` (cursor/offset sobre `ApiService.listEntities`) + filtros novos `city`/`q` no backend (`GET /entities`, regex sem índice) + UI da aba Entities server-driven com fallback local offline e auto-retry.

**Tech Stack:** FastAPI/Pydantic v2/MongoDB (backend), vanilla JS ModuleWrapper (frontend), vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-08-14-server-backed-entities-browse-design.md`

## Global Constraints

- Backend sem índice Mongo novo e sem migração de dados (cota do Atlas sensível — já estourou uma vez).
- Frontend raiz: sem ES modules — classes via ModuleWrapper ou classes puras carregadas por `<script>`; inicialização centralizada em `scripts/core/main.js`; header de arquivo comentando propósito/dependências.
- Fluxo offline-first (gravar review, editar, fila de sync, pending audio) NÃO pode ser alterado.
- Testes: `npm test` (frontend) e `venv/bin/pytest -m "not integration and not external_api and not mongo and not openai"` (backend unit); testes `@pytest.mark.mongo` rodam contra o banco `-test` hermético local.
- Cache-bust: todo script/estilo alterado ganha `?v=20260814-2` no index.html.

---

### Task 1: Backend — filtros `city` e `q` no list_entities

**Files:**
- Modify: `concierge-api-v3/app/api/entities.py` (função `list_entities`)
- Test: `concierge-api-v3/tests/test_entities.py` (classe `TestEntityEndpoints`)

**Interfaces:**
- Consumes: nada novo (Query params padrão do FastAPI; `re` já importado no arquivo).
- Produces: `GET /api/v3/entities?city=<texto>&q=<texto>` — `city` faz regex case-insensitive em `data.address.street` e `data.address.city`; `q` é alias de `name` (regex no nome). `name` continua funcionando.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim da classe `TestEntityEndpoints` em `concierge-api-v3/tests/test_entities.py` (acima do imports existente, adicionar `from datetime import datetime, timezone`):

```python
    @pytest.mark.mongo
    def test_list_entities_filter_by_city_street_regex(self, client, clean_test_entities, test_db):
        """city filtra via regex no address.street (bulk) e address.city (v3)"""
        test_db.entities.insert_many([
            {
                "_id": "test_city_v3", "entity_id": "test_city_v3",
                "type": "restaurant", "name": "Cafe Alpha", "status": "active",
                "data": {"address": {"city": "Victoria", "street": "944 Fort St"},
                         "location": {"type": "Point", "coordinates": [0, 0]}},
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc), "version": 1,
            },
            {
                "_id": "test_city_bulk", "entity_id": "test_city_bulk",
                "type": "restaurant", "name": "Cafe Beta", "status": "active",
                "data": {"address": {"city": "",
                                     "street": "Rua X, 10 - Pinheiros, São Paulo - SP, Brazil"},
                         "location": {"type": "Point", "coordinates": [0, 0]}},
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc), "version": 1,
            },
            {
                "_id": "test_city_other", "entity_id": "test_city_other",
                "type": "restaurant", "name": "Cafe Gamma", "status": "active",
                "data": {"address": {"city": "Paris", "street": "1 Rue X"},
                         "location": {"type": "Point", "coordinates": [0, 0]}},
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc), "version": 1,
            },
        ])
        # cidade no street do bulk (case-insensitive)
        response = client.get("/api/v3/entities?city=sao+paulo")
        assert response.status_code == 200
        names = {i["name"] for i in response.json()["items"] if i["name"].startswith("Cafe")}
        assert names == {"Cafe Beta"}

        # cidade no campo city do formato v3
        response = client.get("/api/v3/entities?city=victoria")
        names = {i["name"] for i in response.json()["items"] if i["name"].startswith("Cafe")}
        assert "Cafe Alpha" in names

        # regex escapado: caracteres especiais não podem derrubar nem vazar
        response = client.get("/api/v3/entities?city=%28")
        assert response.status_code == 200
        assert response.json()["items"] == []

    @pytest.mark.mongo
    def test_list_entities_q_alias_of_name(self, client, clean_test_entities, test_db):
        """q funciona como o name (regex no nome), e name continua funcionando"""
        test_db.entities.insert_one(
            {"_id": "test_q_alpha", "entity_id": "test_q_alpha",
             "type": "cafe", "name": "Quesadilla House", "status": "active",
             "createdAt": datetime.now(timezone.utc),
             "updatedAt": datetime.now(timezone.utc), "version": 1}
        )
        response = client.get("/api/v3/entities?q=quesadilla")
        assert response.status_code == 200
        names = [i["name"] for i in response.json()["items"]]
        assert "Quesadilla House" in names

        response = client.get("/api/v3/entities?name=quesadilla")
        names = [i["name"] for i in response.json()["items"]]
        assert "Quesadilla House" in names
```

- [ ] **Step 2: Rodar e confirmar que falham**

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_entities.py -m mongo -x
```

Expected: os dois testes novos FALHAM (o filtro `city`/`q` não existe; resposta contém tudo, não só os matches).

- [ ] **Step 3: Implementar os filtros**

Em `concierge-api-v3/app/api/entities.py`, na assinatura de `list_entities` (após o parâmetro `status`, antes de `since`):

```python
    city: Optional[str] = Query(
        None,
        description=(
            "Regex case-insensitive em data.address.street e data.address.city "
            "(o bulk import guarda a cidade dentro do street; o campo city "
            "só existe nas entities v3). Sem índice — scan de ~21k docs, "
            "~100ms, para não custar storage do Atlas."
        ),
    ),
    q: Optional[str] = Query(
        None,
        description="Alias de name — regex case-insensitive no nome (paridade com /curations/search).",
    ),
```

E no corpo, trocar o bloco `if name:` por:

```python
    search_name = q if q else name
    if search_name:
        query["name"] = {"$regex": re.escape(search_name), "$options": "i"}
    if status:
        query["status"] = status
    if city:
        city_escaped = re.escape(city.strip()[:100])
        query["$or"] = [
            {"data.address.street": {"$regex": city_escaped, "$options": "i"}},
            {"data.address.city": {"$regex": city_escaped, "$options": "i"}},
        ]
```

(manter o resto — `since`, `ids`, `after_id`, `offset` — intacto).

- [ ] **Step 4: Rodar os testes novos + suíte unit**

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_entities.py -m mongo
venv/bin/pytest -m "not integration and not external_api and not mongo and not openai" -q
```

Expected: testes novos PASSAM; suíte unit continua 143 passed.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app/api/entities.py concierge-api-v3/tests/test_entities.py
git commit -m "feat(api): filtros city e q no list_entities (regex sem índice)"
```

---

### Task 2: ApiService — repasse de `city` e `q` no listEntities

**Files:**
- Modify: `scripts/services/apiService.js` (método `listEntities`)
- Test: `tests/test_apiService_params.test.js` (novo)

**Interfaces:**
- Consumes: `filters` objeto com `type`, `name`, `status`, `since`, `limit`, `offset`, `after_id` (existente).
- Produces: `filters.city` e `filters.q` agora viram query params `city`/`q` na URL do GET.

- [ ] **Step 1: Escrever o teste que falha**

Criar `tests/test_apiService_params.test.js` (padrão de carregamento do test_cardFactory_xss):

```javascript
/**
 * Testes do mapeamento de query params do ApiService.listEntities.
 * Carrega o módulo real via new Function com fetch mockado e assere
 * a URL chamada — garante que city/q chegam ao backend.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/services/apiService.js'),
  'utf8'
);

function loadApiService() {
  delete globalThis.ApiServiceClass;
  delete globalThis.ApiService;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.ApiService;`);
  return fn(window);
}

describe('ApiService.listEntities — query params', () => {
  let apiService;

  beforeEach(() => {
    window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      headers: { get: () => null }
    });
    apiService = loadApiService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('repassa city e q na URL', async () => {
    await apiService.listEntities({ city: 'Sao Paulo', q: 'porco' });

    const url = window.fetch.mock.calls[0][0];
    expect(url).toContain('city=Sao+Paulo');
    expect(url).toContain('q=porco');
  });

  test('não inclui params vazios', async () => {
    await apiService.listEntities({ type: 'restaurant' });

    const url = window.fetch.mock.calls[0][0];
    expect(url).toContain('type=restaurant');
    expect(url).not.toContain('city=');
    expect(url).not.toContain('q=');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run tests/test_apiService_params.test.js
```

Expected: FAIL — URL não contém `city=`/`q=`.

- [ ] **Step 3: Implementar o repasse**

Em `scripts/services/apiService.js`, no método `listEntities` (após `if (filters.after_id)`):

```javascript
        if (filters.city) params.append('city', filters.city);
        if (filters.q) params.append('q', filters.q);
```

- [ ] **Step 4: Rodar o teste**

```bash
npx vitest run tests/test_apiService_params.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/services/apiService.js tests/test_apiService_params.test.js
git commit -m "feat(api-service): listEntities repassa city e q"
```

---

### Task 3: Serviço EntityBrowser

**Files:**
- Create: `scripts/services/entityBrowser.js`
- Test: `tests/test_entityBrowser.test.js` (novo)
- Modify: `index.html` (tag `<script>` do novo arquivo, após `curationBrowser.js`)
- Modify: `scripts/core/main.js` (instanciação, espelhando CurationBrowser)

**Interfaces:**
- Consumes: `ApiService.listEntities({ limit, after_id | offset, type, city, q })` (Task 2).
- Produces: `class EntityBrowser` (classe pura, como CurationBrowser) com `openScope({type, city, q})`, `nextPage()` → `{items, done}`, `openPage(pageNumber)` → `{items, total}`, propriedades `items`, `total` (-1 desconhecido), `done`, `loading`, `scope`, `pageSize`. Exposta como `window.EntityBrowser` (classe) e instanciada em `window.EntityBrowser` (instância) pelo main.js.

- [ ] **Step 1: Escrever os testes que falham**

Criar `tests/test_entityBrowser.test.js`:

```javascript
/**
 * Testes do EntityBrowser — navegação server-side da aba Entities
 * (padrão do CurationBrowser: cursor/offset + scope com reset).
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';

// Carrega a classe pura via new Function (arquivo sem dependências de
// ModuleWrapper — expõe `window.EntityBrowser` apenas se não existir)
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/services/entityBrowser.js'),
  'utf8'
);

function loadEntityBrowser() {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.EntityBrowser;`);
  return fn(window);
}

function makeBrowser(responses) {
  const apiService = {
    listEntities: vi.fn(async (params) => {
      const resp = responses.shift();
      return resp(params);
    })
  };
  const Browser = loadEntityBrowser();
  return new Browser({ apiService, pageSize: 25 });
}

describe('EntityBrowser', () => {
  test('mapeia scope para params (type, city, q) e usa after_id no cursor', async () => {
    const browser = makeBrowser([
      (params) => ({ items: [{ name: 'A' }], total: 100 })
    ]);
    browser.openScope({ type: 'restaurant', city: 'sao paulo', q: 'porco' });
    await browser.nextPage();

    const params = browser.apiService.listEntities.mock.calls[0][0];
    expect(params.type).toBe('restaurant');
    expect(params.city).toBe('sao paulo');
    expect(params.q).toBe('porco');
    expect(params.limit).toBe(25);
    expect(params.after_id).toBeNull();
    expect(browser.items).toHaveLength(1);
    expect(browser.total).toBe(100);
  });

  test('openScope com scope igual não reseta; scope diferente reseta cursor e items', async () => {
    const browser = makeBrowser([
      () => ({ items: [{ entity_id: 'e1' }, { entity_id: 'e2' }], total: 2 }),
      () => ({ items: [{ entity_id: 'e3' }], total: 1 })
    ]);
    browser.openScope({ q: 'x' });
    await browser.nextPage();
    expect(browser.items).toHaveLength(2);

    browser.openScope({ q: 'x' }); // igual — não reseta
    expect(browser.items).toHaveLength(2);

    browser.openScope({ q: 'y' }); // diferente — reseta
    expect(browser.items).toHaveLength(0);
    expect(browser.done).toBe(false);
    await browser.nextPage();
    expect(browser.items).toHaveLength(1);
  });

  test('openPage usa offset e devolve o total real', async () => {
    const browser = makeBrowser([
      (params) => {
        expect(params.offset).toBe(50);
        expect(params.after_id).toBeUndefined();
        return { items: [{ entity_id: 'e50' }], total: 120 };
      }
    ]);
    browser.openScope({});
    const { items, total } = await browser.openPage(2);
    expect(items).toHaveLength(1);
    expect(total).toBe(120);
  });

  test('página vazia marca done no cursor', async () => {
    const browser = makeBrowser([
      () => ({ items: [], total: 0 })
    ]);
    browser.openScope({});
    const { items, done } = await browser.nextPage();
    expect(items).toHaveLength(0);
    expect(done).toBe(true);
    expect(browser.done).toBe(true);
  });
});
```

Nota: o teste usa `browser.apiService` — o construtor deve guardar a referência (`this.apiService = apiService`).

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npx vitest run tests/test_entityBrowser.test.js
```

Expected: FAIL — arquivo não existe (`loadEntityBrowser` lança ao ler o fs).

- [ ] **Step 3: Criar `scripts/services/entityBrowser.js`**

```javascript
/**
 * File: entityBrowser.js
 * Purpose: Navegação paginada (cursor/offset) sobre entities do servidor
 * Dependencies: ApiService (injetado)
 *
 * Main Responsibilities:
 * - Manter scope (filtros), cursor e página atual da listagem de entities
 * - Espelhar o CurationBrowser: o acervo (~21k entities) NUNCA é baixado
 *   inteiro — cada página traz só 25 entities do servidor
 */
class EntityBrowser {
  constructor({ apiService, pageSize = 25 } = {}) {
    this.apiService = apiService;
    this.pageSize = pageSize;
    this.scope = {};
    this.cursor = null;
    this.done = false;
    this.loading = false;
    this.items = [];
    this.total = -1; // -1 = desconhecido (modo cursor nas páginas seguintes)
  }

  openScope({ type = null, city = null, q = null } = {}) {
    if (this._scopeChanged({ type, city, q })) {
      this.cursor = null;
      this.done = false;
      this.items = [];
      this.total = -1;
    }
    this.scope = { type, city, q };
  }

  _scopeChanged(next) {
    const prev = this.scope;
    return prev.type !== next.type
      || prev.city !== next.city
      || prev.q !== next.q;
  }

  _params(afterId) {
    const p = { limit: this.pageSize };
    if (afterId != null) p.after_id = afterId;
    if (this.scope.type) p.type = this.scope.type;
    if (this.scope.city) p.city = this.scope.city;
    if (this.scope.q) p.q = this.scope.q;
    return p;
  }

  async _fetch(afterId) {
    const resp = await this.apiService.listEntities(this._params(afterId));
    return { items: resp.items || [], total: resp.total };
  }

  async nextPage() {
    if (this.done || this.loading) return { items: [], done: true };
    this.loading = true;
    try {
      const { items, total } = await this._fetch(this.cursor);

      // Total real só vem na primeira página (modo cursor)
      if (total > 0 && this.total <= 0) {
        this.total = total;
      }

      if (!items || items.length === 0) {
        this.done = true;
        return { items: [], done: true };
      }

      // Cursor = último id recebido (o backend ordena por _id)
      this.cursor = items[items.length - 1]?._id || items[items.length - 1]?.entity_id || this.cursor;
      this.items.push(...items);
      return { items, done: false };
    } finally {
      this.loading = false;
    }
  }

  /**
   * Busca uma página específica por offset (prev/next). SUBSTITUI
   * this.items — o cursor não serve para voltar páginas.
   * @param {number} pageNumber - Índice zero-based da página
   */
  async openPage(pageNumber) {
    const params = { ...this._params(null), offset: pageNumber * this.pageSize };
    delete params.after_id;
    const resp = await this.apiService.listEntities(params);
    const items = resp.items || [];
    this.items = items;
    // Offset mode sempre devolve o total real
    if (resp.total > 0) {
      this.total = resp.total;
    }
    this.cursor = null;
    this.done = false;
    return { items, total: resp.total };
  }
}

// Classe disponível para o main.js instanciar (mesmo contrato do
// CurationBrowser: main.js lê window.EntityBrowser como CLASSE e a
// substitui pela instância)
if (typeof window !== 'undefined' && !window.EntityBrowser) {
  window.EntityBrowser = EntityBrowser;
}
```

- [ ] **Step 4: Registrar no index.html e instanciar no main.js**

`index.html` (logo após a linha do curationBrowser):

```html
    <script src="scripts/services/entityBrowser.js?v=20260814-2"></script>
```

`scripts/core/main.js` (logo após o bloco do CurationBrowser, ~linha 241):

```javascript
        // Initialize EntityBrowser (navegação server-side da aba Entities —
        // mesmo padrão do CurationBrowser: o acervo de ~21k nunca é baixado)
        const EntityBrowserClass = window.EntityBrowser;
        if (EntityBrowserClass && window.ApiService) {
            window.EntityBrowser = new EntityBrowserClass({ apiService: window.ApiService });
            console.log('✅ EntityBrowser initialized');
        }
```

- [ ] **Step 5: Rodar os testes do browser**

```bash
npx vitest run tests/test_entityBrowser.test.js
```

Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
git add scripts/services/entityBrowser.js tests/test_entityBrowser.test.js index.html scripts/core/main.js
git commit -m "feat(entities-browse): serviço EntityBrowser (cursor/offset server-side)"
```

---

### Task 4: UI — aba Entities server-driven com fallback offline

**Files:**
- Modify: `index.html` (filtro de cidade vira input de texto)
- Modify: `scripts/ui-core/uiManager.js` (loadEntities/_loadEntitiesFromServer/_loadEntitiesFromLocal/renderEntitiesPage/setupEntityEvents — espelhando as curations)
- Modify: `styles/application.css` ou nada (o header de paginação já existe no padrão das entities)

**Interfaces:**
- Consumes: `window.EntityBrowser` (Task 3), `window.DataStore` (fallback), `CardFactory.createEntityCard` (existente).
- Produces: aba Entities navega o servidor com debounce de 300ms em busca/cidade; filtro de tipo imediato; paginação prev/next (offset); fallback local com aviso + auto-retry de 5s; botão "Clear filters" no empty state com filtros ativos.

- [ ] **Step 1: index.html — cidade vira texto livre**

Trocar (na view Entities):

```html
                <!-- City Filter -->
                <div>
                    <select id="entity-city-filter" class="select input-md">
                        <option value="all">All Cities</option>
                    </select>
                </div>
```

por:

```html
                <!-- City Filter (texto livre — regex server-side no street) -->
                <div>
                    <input type="text" id="entity-city-filter" placeholder="Filter by city..."
                        class="input input-md" />
                </div>
```

- [ ] **Step 2: uiManager — eventos da view Entities (debounce)**

Em `scripts/ui-core/uiManager.js`, o método `setupEntityEvents()` JÁ EXISTE (linha ~689, liga os inputs ao `filterAndDisplayEntities` client-side) e já é chamado no init (linha ~209). SUBSTITUIR o corpo dele pela versão server-driven espelhando `setupCurationEvents` (mesmo estilo `var self = this;`):

```javascript
        setupEntityEvents() {
            var self = this;
            // Busca com debounce (300ms) — vai ao servidor via EntityBrowser
            const searchInput = document.getElementById('entity-search');
            if (searchInput) {
                searchInput.addEventListener('input', function() {
                    if (self.entitySearchDebounceTimer) clearTimeout(self.entitySearchDebounceTimer);
                    self.entitySearchDebounceTimer = setTimeout(function() {
                        self._reloadOrFilterEntities();
                    }, 300);
                });
            }

            // Tipo (imediato)
            const typeFilter = document.getElementById('entity-type-filter');
            if (typeFilter) {
                typeFilter.addEventListener('change', function() {
                    self._reloadOrFilterEntities();
                });
            }

            // Cidade (texto livre, debounce 300ms)
            const cityFilter = document.getElementById('entity-city-filter');
            if (cityFilter) {
                cityFilter.addEventListener('input', function() {
                    if (self.entityCityDebounceTimer) clearTimeout(self.entityCityDebounceTimer);
                    self.entityCityDebounceTimer = setTimeout(function() {
                        self._reloadOrFilterEntities();
                    }, 300);
                });
            }
        }

        _reloadOrFilterEntities() {
            const pick = (id) => document.getElementById(id)?.value || null;
            var scope = {
                type: pick('entity-type-filter'),
                city: pick('entity-city-filter'),
                q: (document.getElementById('entity-search')?.value?.trim() || null)
            };
            if (window.EntityBrowser && window.EntityBrowser.openPage) {
                window.EntityBrowser.openScope(scope);
            }
            this.entityPagination.currentPage = 0;
            this.loadEntities();
        }
```

(A chamada `this.setupEntityEvents()` no init já existe na linha ~209 — nada a fazer ali.)

- [ ] **Step 3: uiManager — loadEntities server-first com fallback**

Substituir o corpo atual de `loadEntities()` (que lê DataStore + filtro linked/createdBy) por um dispatch espelhando `loadCurations()`:

```javascript
        async loadEntities() {
            const container = this.containers.entities;
            if (!container) {
                console.warn('Entities container not found');
                return;
            }

            if (!this.entityPagination) {
                this.entityPagination = { currentPage: 0, pageSize: 25, hasMore: true };
            }

            try {
                // Server-driven: EntityBrowser quando disponível (acervo
                // completo de ~21k, sem baixar tudo). Fallback local offline.
                if (window.EntityBrowser && window.EntityBrowser.openPage) {
                    await this._loadEntitiesFromServer(container, { resetScope: true });
                    return;
                }
                await this._loadEntitiesFromLocal(container);
            } catch (error) {
                console.error('Failed to load entities:', error);
                await this._loadEntitiesFromLocal(container);
            }
        }
```

E adicionar `_loadEntitiesFromServer` espelhando `_loadCurationsFromServer`:

```javascript
        /** Primeira página do servidor (offset) — mesmas regras das
         *  curations: openPage SUBSTITUI items; erro → fallback local
         *  com auto-retry em 5s; página 1 mescla pendências locais. */
        async _loadEntitiesFromServer(container, { resetScope = false, page = 0 } = {}) {
            const browser = window.EntityBrowser;
            this._entitiesLocalMode = false;
            try {
                if (resetScope) browser.openScope({});
                const { items } = await browser.openPage(page);
            } catch (error) {
                console.warn('Server entities unavailable — usando cache local:', error);
                browser.total = -1;
                await this._loadEntitiesFromLocal(container);
                if (!this._entitiesServerRetryPending) {
                    this._entitiesServerRetryPending = true;
                    setTimeout(() => {
                        this._entitiesServerRetryPending = false;
                        if (this._entitiesLocalMode && typeof this._reloadOrFilterEntities === 'function') {
                            this._reloadOrFilterEntities();
                        }
                    }, 5000);
                }
                return;
            }

            if (!browser.items.length) {
                this.entitiesCache = [];
                this.entitiesFiltered = [];
                this.updateEntitiesCountSummary(0, 0);
                const scope = browser.scope || {};
                const active = (v) => v && v !== 'all';
                const hasActiveFilters = !!(active(scope.q) || active(scope.city) || active(scope.type));
                if (hasActiveFilters) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-state__icon material-icons">search_off</span>
                            <p class="empty-state__title">No entities match your filters</p>
                            <button id="clear-entity-filters" class="btn btn-outline btn-sm mt-2">
                                <span class="material-icons text-sm mr-1">clear_all</span>
                                Clear filters
                            </button>
                        </div>
                    `;
                    var self = this;
                    container.querySelector('#clear-entity-filters')?.addEventListener('click', function() {
                        ['entity-search', 'entity-type-filter', 'entity-city-filter'].forEach(function(id) {
                            var el = document.getElementById(id);
                            if (el) el.value = el.tagName === 'SELECT' ? 'all' : '';
                        });
                        self._reloadOrFilterEntities();
                    });
                } else {
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-state__icon material-icons">restaurant</span>
                            <p class="empty-state__title">No entities yet</p>
                            <p class="empty-state__description">Use Find Entity to import your first restaurant</p>
                        </div>
                    `;
                }
                return;
            }

            if (page === 0) {
                const serverIds = new Set(browser.items.map(e => e.entity_id));
                let localPending = [];
                try {
                    if (window.DataStore?.db) {
                        localPending = (await window.DataStore.db.entities
                            .where('sync.status').equals('pending').toArray())
                            .filter(e => !serverIds.has(e.entity_id));
                    }
                } catch (error) {
                    console.warn('Falha ao mesclar pendências locais de entities:', error);
                }
                this.entitiesCache = [...localPending, ...browser.items];
                this.populateEntityFilters(this.entitiesCache);
                this.filterAndDisplayEntities();
            } else {
                this.entitiesCache = browser.items;
                this.renderEntitiesPage(this.entitiesCache);
            }
        }
```

E `_loadEntitiesFromLocal` (fallback offline — preserva o filtro atual linked/createdBy):

```javascript
        /** Fallback offline: entities locais (linked + createdBy) com aviso. */
        async _loadEntitiesFromLocal(container) {
            this._entitiesLocalMode = true;
            if (window.EntityBrowser) {
                window.EntityBrowser.total = -1;
            }
            let allEntities = [];
            try {
                if (window.DataStore) {
                    const [entities, curations] = await Promise.all([
                        window.DataStore.getEntities({ status: 'active' }),
                        window.DataStore.getCurations({ excludeDeleted: true })
                    ]);
                    const linkedIds = new Set(
                        curations.map(c => c?.entity_id).filter(id => typeof id === 'string' && id.trim())
                    );
                    allEntities = entities.filter(e =>
                        e?.entity_id && (
                            linkedIds.has(e.entity_id) ||
                            Boolean(e.createdBy && String(e.createdBy).trim())
                        )
                    );
                }
            } catch (error) {
                console.error('Failed to load local entities:', error);
            }

            this.entitiesCache = allEntities;
            this.entitiesFiltered = [];

            if (!allEntities.length) {
                this.updateEntitiesCountSummary(0, 0);
                container.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-state__icon material-icons">cloud_off</span>
                        <p class="empty-state__title">Offline — no local entities</p>
                        <p class="empty-state__description">Connect to browse the full catalog</p>
                    </div>
                `;
                return;
            }

            // aviso discreto de modo offline
            const offlineNotice = document.createElement('div');
            offlineNotice.className = 'col-span-full mb-2 px-3 py-2 text-xs rounded-lg bg-gray-50 border border-gray-200 text-gray-600 flex items-center gap-2';
            offlineNotice.innerHTML = '<span class="material-icons text-sm">cloud_off</span> Offline — showing local entities only';
            container.innerHTML = '';
            container.appendChild(offlineNotice);

            this.populateEntityFilters(allEntities);
            this.filterAndDisplayEntities();
        }
```

- [ ] **Step 4: uiManager — renderEntitiesPage server-driven**

No método `renderEntitiesPage` existente, espelhar a lógica do `renderCurationsPage` (modo server-driven vs local):

```javascript
        renderEntitiesPage(allEntities) {
            const container = this.containers.entities;
            const isServerDriven = !!(window.EntityBrowser && window.EntityBrowser.openPage) && !this._entitiesLocalMode;
            const browser = isServerDriven ? window.EntityBrowser : null;
            const ep = this.entityPagination;
            const serverTotal = browser && browser.total > 0 ? browser.total : allEntities.length;
            const totalPages = Math.ceil(serverTotal / ep.pageSize);

            let start, end, pageEntities;
            if (isServerDriven) {
                start = ep.currentPage * ep.pageSize;
                end = Math.min(start + allEntities.length, serverTotal);
                pageEntities = allEntities;
            } else {
                start = ep.currentPage * ep.pageSize;
                end = Math.min(start + ep.pageSize, allEntities.length);
                pageEntities = allEntities.slice(start, end);
                // reusa a variável local (sem reatribuir const acima)
            }

            this.updateEntitiesCountSummary(allEntities.length, allEntities.length);
            container.innerHTML = '';

            var self = this;
            var header = document.createElement('div');
            header.className = 'col-span-full mb-4 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-center justify-between';
            header.innerHTML = `
                <div class="text-sm text-gray-600">
                    Showing <span class="font-semibold">${start + 1}</span>&ndash;<span class="font-semibold">${end}</span> of <span class="font-semibold">${serverTotal}</span> entities
                </div>
                <div class="flex gap-2">
                    <button id="entity-prev-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${ep.currentPage === 0 ? 'disabled' : ''}>
                        <span class="material-icons text-sm">chevron_left</span>
                    </button>
                    <div class="px-3 py-1 text-sm font-medium">Page ${ep.currentPage + 1} of ${totalPages}</div>
                    <button id="entity-next-page" class="px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed" ${ep.currentPage >= totalPages - 1 ? 'disabled' : ''}>
                        <span class="material-icons text-sm">chevron_right</span>
                    </button>
                </div>
            `;
            container.appendChild(header);

            header.querySelector('#entity-prev-page')?.addEventListener('click', function() {
                ep.currentPage--;
                if (isServerDriven) {
                    self.entitiesCache = [];
                    self._loadEntitiesFromServer(container, { page: ep.currentPage });
                } else {
                    self.renderEntitiesPage(allEntities);
                }
            });
            header.querySelector('#entity-next-page')?.addEventListener('click', function() {
                ep.currentPage++;
                if (isServerDriven) {
                    self.entitiesCache = [];
                    self._loadEntitiesFromServer(container, { page: ep.currentPage });
                } else {
                    self.renderEntitiesPage(allEntities);
                }
            });

            // PRESERVAR o bloco de criação de card ATUAL (mesmas options):
            // window.CardFactory.createEntityCard(entity, { showEntityActions: true,
            //   onClick/onDetails → entityModule.showEntityDetails, onEdit, onSync, ... })
            pageEntities.forEach(function(entity) {
                const card = window.CardFactory.createEntityCard(entity, {
                    showEntityActions: true,
                    onClick: (selectedEntity) => {
                        if (window.entityModule?.showEntityDetails) {
                            window.entityModule.showEntityDetails(selectedEntity);
                        }
                    },
                    onDetails: (selectedEntity) => {
                        if (window.entityModule?.showEntityDetails) {
                            window.entityModule.showEntityDetails(selectedEntity);
                        }
                    },
                    onEdit: (selectedEntity) => {
                        if (!self.canMutateWhileSyncing()) { return; }
                        if (window.entityModule?.startEntityEdit) {
                            window.entityModule.startEntityEdit(selectedEntity);
                        }
                    },
                    onSync: async () => {
                        if (!self.canMutateWhileSyncing()) { return; }
                        if (window.SyncManager?.pushEntities) {
                            await window.SyncManager.pushEntities();
                            await self.loadEntities();
                        }
                    }
                });
                container.appendChild(card);
            });
        }
```

Nota de implementação: o `renderEntitiesPage` ATUAL já tem um header de paginação próprio (ids `#prev-page`/`#next-page`) — substituir o corpo do método inteiro pelo acima (os callbacks de card acima são CÓPIA exata do bloco atual do método, conferidos na linha ~1290 do uiManager).

ATENÇÃO (padrão existente): `populateEntityFilters` populava o select de cidades — com a cidade virando input, remover a parte que popula `#entity-city-filter` e manter só o que afeta o select de tipo (ou tornar o método no-op para cidade).

- [ ] **Step 4b: Cache-bust dos scripts alterados no index.html**

Bump de versão em `index.html`:
- `scripts/services/apiService.js` → `?v=20260814-2` (arquivo não tem ?v hoje — adicionar)
- `scripts/ui-core/uiManager.js?v=20260814-1` → `?v=20260814-2`

- [ ] **Step 5: Verificação no navegador (E2E real)**

Com backend local no ar e servindo o frontend:

```bash
# backend local (usa o Mongo real via .env)
cd concierge-api-v3 && ./run_local.sh
# frontend servido em 127.0.0.1:5500 (python3 -m http.server 5500)
```

Abrir a aba Entities via puppeteer (padrão já usado na sessão) e verificar:
1. Busca "porco" retorna cards do servidor (nomes com "porco").
2. Filtro cidade "sao paulo" retorna entities de São Paulo (street regex).
3. Paginação: "Showing 1–25 of N" com N ≈ total do acervo; prev/next funcionam.
4. Filtro sem match mostra "No entities match your filters" + botão Clear filters.
5. Fallback offline: bloquear rede (page.setOfflineMode(true)) e recarregar — aba mostra entities locais com aviso "Offline — showing local entities only".

- [ ] **Step 6: Suítes completas**

```bash
npm test
cd concierge-api-v3 && venv/bin/pytest -m "not integration and not external_api and not mongo and not openai" -q
```

Expected: frontend 540+ passed; backend unit 143 passed.

- [ ] **Step 7: Commit**

```bash
git add index.html scripts/ui-core/uiManager.js
git commit -m "feat(entities-browse): aba Entities server-driven com fallback offline"
```

---

### Task 5: Deploy e verificação em produção

**Files:** nenhum (operacional).

- [ ] **Step 1: Commit final e push**

```bash
git push origin main
```

- [ ] **Step 2: Deploy dos dois serviços no Render**

Auto-deploy do Web costuma engatar; o da API normalmente NÃO engata — verificar e disparar manual via:

```bash
export RENDER_API_KEY=$(grep '^RENDER_API_KEY=' concierge-api-v3/.env | cut -d= -f2-)
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py list-deploys srv-d4fnrlje5dus7397lii0 --limit 2   # Web
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py list-deploys srv-d4fngpjuibrs73bo70vg --limit 2   # API
# se a API não tiver deploy novo:
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py deploy srv-d4fngpjuibrs73bo70vg
```

- [ ] **Step 3: Poll até ambos live** (loop já usado na sessão: list-deploys a cada 20s até `live` para os dois deploy ids).

- [ ] **Step 4: Verificar produção**

```bash
curl -s "https://concierge-collector.onrender.com/api/v3/entities?city=sao+paulo&limit=5" | head -c 300
curl -s "https://concierge-collector-web.onrender.com/scripts/services/entityBrowser.js?v=20260814-2" | grep -c "EntityBrowser"
curl -s https://concierge-collector.onrender.com/api/v3/health
```

Expected: resposta paginada do filtro city; arquivo novo servido; health healthy.

- [ ] **Step 5: Relatório final** para o usuário (o que mudou, como testar no celular, pendências conhecidas).
