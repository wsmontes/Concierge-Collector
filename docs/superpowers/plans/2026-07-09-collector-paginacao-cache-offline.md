# Collector: browse paginado + cache offline progressivo — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a carga total do Collector por um browse de curadorias paginado (server-backed) com cache offline progressivo, hidratação de entidades em background e orçamento de memória adaptativo — para que a abertura seja constante independente do tamanho do catálogo.

**Architecture:** Quatro unidades novas, cada uma uma classe com dependências injetadas (testáveis via Vitest): `StorageBudget` (teto adaptativo), `OfflineCache` (persistência + evicção LRU), `EntityHydrator` (hidratação de entidade em background), `CurationBrowser` (paginação + prefetch). Depois: `syncManagerV3` vira push-only + checkout, e `uiManager.loadCurations()` passa a usar o `CurationBrowser`.

**Tech Stack:** JS (browser), Dexie (IndexedDB), Vitest + fake-indexeddb + jsdom para testes. Sem mudança de backend (usa `GET /curations/search` com cursor `after_id` e `GET /entities/{id}` existentes).

## Global Constraints

- Padrão de módulo: **classe com dependências injetadas via construtor** + bootstrap `window.X = new X({...})` no fim do arquivo. Lógica testável não deve acessar `window.*` diretamente.
- Testes: **Vitest** (`npm test` = `vitest run`), em `tests/`, com `fake-indexeddb` e `jsdom`; usar `import { describe, test, expect, beforeEach, vi } from 'vitest'`.
- **Sem mudança de backend** no v1: usar `ApiService.listCurations({ after_id, limit, curator_id, status })` e `ApiService.getEntity(id)`.
- **Page size = 25**; prefetch **apenas da próxima página**.
- Browse renderiza dos campos **denormalizados** da curadoria (`restaurant_name`, `categories`, `status`); entidade é **background/menor prioridade**.
- **Evicção NUNCA remove itens sujos**: `dirty=true` (criado local não-sincronizado, edição pendente, conflito, ou em edição).
- **Startup = push-only**; zero pull em massa.

---

### Task 1: `StorageBudget` — teto de cache adaptativo

**Files:**
- Create: `scripts/storage/storageBudget.js`
- Test: `tests/test_storageBudget.test.js`

**Interfaces:**
- Produces: `class StorageBudget` com `async getBudget() -> { maxBytes: number }`. Construtor injeta `{ storage, deviceMemory, config }`.

- [ ] **Step 1: Escrever o teste que falha**

```javascript
// tests/test_storageBudget.test.js
import { describe, test, expect } from 'vitest';
import { StorageBudget } from '../scripts/storage/storageBudget.js';

const fakeStorage = (quota, usage) => ({ estimate: async () => ({ quota, usage }) });

describe('StorageBudget', () => {
  test('usa uma fração da quota livre', async () => {
    const b = new StorageBudget({ storage: fakeStorage(1000, 200), deviceMemory: 8,
      config: { freeFraction: 0.5, maxAbsoluteBytes: 10_000 } });
    // livre = 800; 50% = 400
    expect((await b.getBudget()).maxBytes).toBe(400);
  });

  test('limita pelo teto absoluto', async () => {
    const b = new StorageBudget({ storage: fakeStorage(1_000_000_000, 0), deviceMemory: 8,
      config: { freeFraction: 0.5, maxAbsoluteBytes: 1000 } });
    expect((await b.getBudget()).maxBytes).toBe(1000);
  });

  test('sem storage.estimate, cai no teto absoluto', async () => {
    const b = new StorageBudget({ storage: {}, deviceMemory: 8, config: { maxAbsoluteBytes: 777 } });
    expect((await b.getBudget()).maxBytes).toBe(777);
  });

  test('dispositivo com pouca memória reduz o teto', async () => {
    const b = new StorageBudget({ storage: fakeStorage(1_000_000_000, 0), deviceMemory: 2,
      config: { freeFraction: 0.5, maxAbsoluteBytes: 100_000_000, lowMemoryBytes: 5_000_000 } });
    expect((await b.getBudget()).maxBytes).toBe(5_000_000);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npm test -- tests/test_storageBudget.test.js` · Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

```javascript
// scripts/storage/storageBudget.js
class StorageBudget {
  constructor({ storage = (typeof navigator !== 'undefined' ? navigator.storage : undefined),
                deviceMemory = (typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined),
                config = {} } = {}) {
    this.storage = storage;
    this.deviceMemory = deviceMemory;
    this.maxAbsoluteBytes = config.maxAbsoluteBytes ?? 200 * 1024 * 1024;
    this.freeFraction = config.freeFraction ?? 0.5;
    this.lowMemoryBytes = config.lowMemoryBytes ?? 50 * 1024 * 1024;
  }

  async getBudget() {
    let quota = 0, usage = 0;
    if (this.storage && typeof this.storage.estimate === 'function') {
      try { const e = await this.storage.estimate(); quota = e.quota || 0; usage = e.usage || 0; } catch (_) {}
    }
    const free = Math.max(0, quota - usage);
    let budget = Math.floor(free * this.freeFraction);
    if (!budget) budget = this.maxAbsoluteBytes;
    budget = Math.min(budget, this.maxAbsoluteBytes);
    if (typeof this.deviceMemory === 'number' && this.deviceMemory <= 2) {
      budget = Math.min(budget, this.lowMemoryBytes);
    }
    return { maxBytes: budget };
  }
}

export { StorageBudget };
if (typeof window !== 'undefined') { window.StorageBudget = new StorageBudget(); }
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npm test -- tests/test_storageBudget.test.js` · Expected: PASS (4).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(collector): StorageBudget (teto de cache adaptativo)"`

---

### Task 2: `OfflineCache` — seleção de evicção LRU (núcleo puro)

**Files:**
- Create: `scripts/storage/offlineCache.js`
- Test: `tests/test_offlineCache.test.js`

**Interfaces:**
- Produces: `class OfflineCache` com o método puro `selectEvictions(items, currentBytes, maxBytes) -> string[]` — recebe `items: [{ id, bytes, lastAccessedAt, dirty }]`, devolve ids a remover (mais antigos primeiro, só `dirty=false`) até `currentBytes <= maxBytes`. Construtor injeta `{ db, budget }` (usados nas Tasks seguintes).

- [ ] **Step 1: Escrever o teste que falha**

```javascript
// tests/test_offlineCache.test.js
import { describe, test, expect } from 'vitest';
import { OfflineCache } from '../scripts/storage/offlineCache.js';

const cache = new OfflineCache({ db: null, budget: null });

describe('OfflineCache.selectEvictions', () => {
  test('remove os limpos mais antigos até caber no teto', () => {
    const items = [
      { id: 'a', bytes: 100, lastAccessedAt: 1, dirty: false },
      { id: 'b', bytes: 100, lastAccessedAt: 2, dirty: false },
      { id: 'c', bytes: 100, lastAccessedAt: 3, dirty: false },
    ];
    // currentBytes=300, maxBytes=150 -> remover 'a' e 'b'
    expect(cache.selectEvictions(items, 300, 150)).toEqual(['a', 'b']);
  });

  test('nunca remove itens sujos, mesmo os mais antigos', () => {
    const items = [
      { id: 'a', bytes: 100, lastAccessedAt: 1, dirty: true },
      { id: 'b', bytes: 100, lastAccessedAt: 2, dirty: false },
    ];
    // precisa liberar, mas 'a' é sujo -> só pode remover 'b'
    expect(cache.selectEvictions(items, 200, 50)).toEqual(['b']);
  });

  test('não remove nada se já cabe', () => {
    const items = [{ id: 'a', bytes: 10, lastAccessedAt: 1, dirty: false }];
    expect(cache.selectEvictions(items, 10, 100)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npm test -- tests/test_offlineCache.test.js` · Expected: FAIL.

- [ ] **Step 3: Implementar (só o núcleo puro + esqueleto de deps)**

```javascript
// scripts/storage/offlineCache.js
class OfflineCache {
  constructor({ db, budget } = {}) {
    this.db = db;
    this.budget = budget;
  }

  /** Seleção pura de evicção: mais antigos e limpos primeiro, até caber. */
  selectEvictions(items, currentBytes, maxBytes) {
    if (currentBytes <= maxBytes) return [];
    const clean = items
      .filter(i => !i.dirty)
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const toEvict = [];
    let bytes = currentBytes;
    for (const item of clean) {
      if (bytes <= maxBytes) break;
      toEvict.push(item.id);
      bytes -= item.bytes;
    }
    return toEvict;
  }
}

export { OfflineCache };
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npm test -- tests/test_offlineCache.test.js` · Expected: PASS (3).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(collector): OfflineCache.selectEvictions (LRU, preserva sujos)"`

---

### Task 3: `OfflineCache` — persistência + `enforceBudget` (IndexedDB)

**Files:**
- Modify: `scripts/storage/offlineCache.js`
- Test: `tests/test_offlineCache.test.js`

**Interfaces:**
- Consumes: `selectEvictions` (Task 2), `budget.getBudget()` (Task 1).
- Produces em `OfflineCache`:
  - `estimateBytes(obj) -> number` (tamanho aproximado via JSON).
  - `async putCurations(items)` — grava/atualiza `db.curations` com `source:'cache'` (se não existir), `lastAccessedAt=now()`.
  - `async putEntity(entity)` — grava/atualiza `db.entities` idem.
  - `async touch(id)` — atualiza `lastAccessedAt` da curadoria.
  - `async enforceBudget(now)` — soma bytes das curadorias `dirty=false`, chama `selectEvictions`, deleta as escolhidas (curadoria + entidade órfã).

- [ ] **Step 1: Escrever o teste que falha (fake-indexeddb via Dexie)**

```javascript
// adicionar em tests/test_offlineCache.test.js
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { StorageBudget } from '../scripts/storage/storageBudget.js';

function makeDb() {
  const db = new Dexie('test_offline_' + Math.random().toString(36).slice(2));
  db.version(1).stores({
    curations: 'id, curation_id, entity_id, lastAccessedAt, source',
    entities: 'id, entity_id, lastAccessedAt, source',
  });
  return db;
}

describe('OfflineCache persistência', () => {
  test('putCurations grava com source=cache e lastAccessedAt', async () => {
    const db = makeDb();
    const c = new OfflineCache({ db, budget: new StorageBudget({ storage: {}, config: { maxAbsoluteBytes: 1e9 } }) });
    await c.putCurations([{ id: 'x1', curation_id: 'x1', restaurant_name: 'A', entity_id: 'e1' }], 111);
    const saved = await db.curations.get('x1');
    expect(saved.source).toBe('cache');
    expect(saved.lastAccessedAt).toBe(111);
  });

  test('enforceBudget remove curadorias limpas mais antigas quando estoura', async () => {
    const db = makeDb();
    const c = new OfflineCache({ db, budget: { getBudget: async () => ({ maxBytes: 1 }) } });
    await c.putCurations([{ id: 'a', curation_id: 'a' }], 1);
    await c.putCurations([{ id: 'b', curation_id: 'b' }], 2);
    await c.enforceBudget(3);
    // teto 1 byte -> tudo limpo é evictável; sobra 0 (ou o mais novo, conforme bytes)
    const remaining = await db.curations.count();
    expect(remaining).toBeLessThan(2);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npm test -- tests/test_offlineCache.test.js` · Expected: FAIL (métodos inexistentes).

- [ ] **Step 3: Implementar**

```javascript
// adicionar métodos à classe OfflineCache
  estimateBytes(obj) {
    try { return JSON.stringify(obj).length; } catch (_) { return 500; }
  }

  async putCurations(items, now = Date.now()) {
    for (const item of items) {
      const existing = await this.db.curations.get(item.id);
      const record = {
        ...existing,
        ...item,
        lastAccessedAt: now,
        source: existing?.source === 'owned' ? 'owned' : 'cache',
      };
      await this.db.curations.put(record);
    }
    await this.enforceBudget(now);
  }

  async putEntity(entity, now = Date.now()) {
    const existing = await this.db.entities.get(entity.id);
    await this.db.entities.put({
      ...existing, ...entity, lastAccessedAt: now,
      source: existing?.source === 'owned' ? 'owned' : 'cache',
    });
  }

  async touch(id, now = Date.now()) {
    await this.db.curations.update(id, { lastAccessedAt: now });
  }

  isDirty(rec) {
    const s = rec?.sync?.status;
    return rec?.source === 'owned' || s === 'pending' || s === 'conflict';
  }

  async enforceBudget(now = Date.now()) {
    const { maxBytes } = await this.budget.getBudget();
    const all = await this.db.curations.toArray();
    let currentBytes = 0;
    const items = all.map(rec => {
      const bytes = this.estimateBytes(rec);
      currentBytes += bytes;
      return { id: rec.id, bytes, lastAccessedAt: rec.lastAccessedAt || 0, dirty: this.isDirty(rec) };
    });
    const evict = this.selectEvictions(items, currentBytes, maxBytes);
    for (const id of evict) {
      const rec = await this.db.curations.get(id);
      await this.db.curations.delete(id);
      // remove entidade órfã (nenhuma outra curadoria a referencia)
      if (rec?.entity_id) {
        const others = await this.db.curations.where('entity_id').equals(rec.entity_id).count();
        if (others === 0) {
          const ent = await this.db.entities.where('entity_id').equals(rec.entity_id).first();
          if (ent && !this.isDirty(ent)) await this.db.entities.delete(ent.id);
        }
      }
    }
  }
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npm test -- tests/test_offlineCache.test.js` · Expected: PASS (5).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(collector): OfflineCache persistência + enforceBudget (IndexedDB)"`

---

### Task 4: `EntityHydrator` — hidratação de entidades em background

**Files:**
- Create: `scripts/services/entityHydrator.js`
- Test: `tests/test_entityHydrator.test.js`

**Interfaces:**
- Consumes: `ApiService.getEntity(id)`, `OfflineCache.putEntity`.
- Produces: `class EntityHydrator` com `{ apiService, cache, isEntityCached }` injetados; `enqueue(entityIds)` (dedup + pula já em cache); `async processNext() -> boolean`; `async processAll()`.

- [ ] **Step 1: Escrever o teste que falha**

```javascript
// tests/test_entityHydrator.test.js
import { describe, test, expect, vi } from 'vitest';
import { EntityHydrator } from '../scripts/services/entityHydrator.js';

describe('EntityHydrator', () => {
  test('busca só ids não-cacheados e persiste', async () => {
    const cached = new Set(['e_have']);
    const apiService = { getEntity: vi.fn(async (id) => ({ id, entity_id: id, name: 'n' })) };
    const cache = { putEntity: vi.fn(async () => {}) };
    const h = new EntityHydrator({ apiService, cache, isEntityCached: (id) => cached.has(id) });

    h.enqueue(['e_have', 'e1', 'e1', 'e2']); // dedup + pula 'e_have'
    await h.processAll();

    expect(apiService.getEntity).toHaveBeenCalledTimes(2);
    expect(cache.putEntity).toHaveBeenCalledTimes(2);
  });

  test('erro em um id não derruba a fila', async () => {
    const apiService = { getEntity: vi.fn(async (id) => { if (id === 'bad') throw new Error('x'); return { id, entity_id: id }; }) };
    const cache = { putEntity: vi.fn(async () => {}) };
    const h = new EntityHydrator({ apiService, cache, isEntityCached: () => false });
    h.enqueue(['bad', 'good']);
    await h.processAll();
    expect(cache.putEntity).toHaveBeenCalledTimes(1); // só 'good'
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npm test -- tests/test_entityHydrator.test.js` · Expected: FAIL.

- [ ] **Step 3: Implementar**

```javascript
// scripts/services/entityHydrator.js
class EntityHydrator {
  constructor({ apiService, cache, isEntityCached, scheduler } = {}) {
    this.apiService = apiService;
    this.cache = cache;
    this.isEntityCached = isEntityCached || (() => false);
    this.scheduler = scheduler || ((fn) => (typeof requestIdleCallback !== 'undefined'
      ? requestIdleCallback(fn) : setTimeout(fn, 0)));
    this.queue = [];
    this.seen = new Set();
    this.running = false;
    this.paused = false;
  }

  enqueue(entityIds = []) {
    for (const id of entityIds) {
      if (!id || this.seen.has(id) || this.isEntityCached(id)) continue;
      this.seen.add(id);
      this.queue.push(id);
    }
  }

  async processNext() {
    if (!this.queue.length) return false;
    const id = this.queue.shift();
    try {
      const entity = await this.apiService.getEntity(id);
      if (entity) await this.cache.putEntity(entity);
    } catch (_) { /* mantém a fila viva */ }
    return true;
  }

  async processAll() {
    while (await this.processNext()) { /* drena */ }
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (this.paused) { this.running = false; return; }
      const more = await this.processNext();
      if (more) this.scheduler(tick); else this.running = false;
    };
    this.scheduler(tick);
  }

  pause() { this.paused = true; }
}

export { EntityHydrator };
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npm test -- tests/test_entityHydrator.test.js` · Expected: PASS (2).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(collector): EntityHydrator (hidratação de entidade em background)"`

---

### Task 5: `CurationBrowser` — paginação por cursor + prefetch

**Files:**
- Create: `scripts/services/curationBrowser.js`
- Test: `tests/test_curationBrowser.test.js`

**Interfaces:**
- Consumes: `ApiService.listCurations({ after_id, limit, curator_id, status })` (retorna `{ items }`), `OfflineCache.putCurations`, `EntityHydrator.enqueue`.
- Produces: `class CurationBrowser` com `{ apiService, cache, hydrator, pageSize=25 }` injetados; `openScope({ curatorId, status })`; `async nextPage() -> { items, done }` (busca, persiste no cache, enfileira entidades, e dispara prefetch da próxima).

- [ ] **Step 1: Escrever o teste que falha**

```javascript
// tests/test_curationBrowser.test.js
import { describe, test, expect, vi } from 'vitest';
import { CurationBrowser } from '../scripts/services/curationBrowser.js';

function fakeApi(pages) {
  // pages: array de arrays de itens
  return {
    listCurations: vi.fn(async ({ after_id }) => {
      const idx = after_id == null ? 0 : pages.findIndex(p => p.some(i => i.id === after_id)) + 1;
      return { items: pages[idx] || [] };
    }),
  };
}

describe('CurationBrowser', () => {
  test('nextPage busca página, persiste no cache e enfileira entidades', async () => {
    const api = fakeApi([[{ id: 'a', entity_id: 'ea' }, { id: 'b', entity_id: 'eb' }], [{ id: 'c', entity_id: 'ec' }]]);
    const cache = { putCurations: vi.fn(async () => {}) };
    const hydrator = { enqueue: vi.fn() };
    const br = new CurationBrowser({ apiService: api, cache, hydrator, pageSize: 2 });
    br.openScope({});

    const p1 = await br.nextPage();
    expect(p1.items.map(i => i.id)).toEqual(['a', 'b']);
    expect(cache.putCurations).toHaveBeenCalledWith([{ id: 'a', entity_id: 'ea' }, { id: 'b', entity_id: 'eb' }]);
    expect(hydrator.enqueue).toHaveBeenCalledWith(['ea', 'eb']);

    const p2 = await br.nextPage(); // usa cursor after_id='b'
    expect(p2.items.map(i => i.id)).toEqual(['c']);
    expect(p2.done).toBe(true); // página < pageSize -> fim
  });

  test('openScope passa curator_id/status para a API', async () => {
    const api = fakeApi([[]]);
    const br = new CurationBrowser({ apiService: api, cache: { putCurations: vi.fn() }, hydrator: { enqueue: vi.fn() }, pageSize: 25 });
    br.openScope({ curatorId: 'me', status: 'draft' });
    await br.nextPage();
    expect(api.listCurations).toHaveBeenCalledWith(expect.objectContaining({ curator_id: 'me', status: 'draft', limit: 25 }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npm test -- tests/test_curationBrowser.test.js` · Expected: FAIL.

- [ ] **Step 3: Implementar**

```javascript
// scripts/services/curationBrowser.js
class CurationBrowser {
  constructor({ apiService, cache, hydrator, pageSize = 25 } = {}) {
    this.apiService = apiService;
    this.cache = cache;
    this.hydrator = hydrator;
    this.pageSize = pageSize;
    this.scope = {};
    this.cursor = null;
    this.done = false;
    this._prefetched = null;
  }

  openScope({ curatorId = null, status = null } = {}) {
    this.scope = { curatorId, status };
    this.cursor = null;
    this.done = false;
    this._prefetched = null;
  }

  _params(afterId) {
    const p = { limit: this.pageSize };
    if (afterId != null) p.after_id = afterId;
    if (this.scope.curatorId) p.curator_id = this.scope.curatorId;
    if (this.scope.status) p.status = this.scope.status;
    return p;
  }

  async _fetch(afterId) {
    const resp = await this.apiService.listCurations(this._params(afterId));
    return resp.items || [];
  }

  async _ingest(items) {
    if (!items.length) return;
    await this.cache.putCurations(items);
    this.hydrator.enqueue(items.map(i => i.entity_id).filter(Boolean));
  }

  async nextPage() {
    if (this.done) return { items: [], done: true };
    let items;
    if (this._prefetched) { items = this._prefetched; this._prefetched = null; }
    else { items = await this._fetch(this.cursor); await this._ingest(items); }

    if (items.length) this.cursor = items[items.length - 1].id;
    if (items.length < this.pageSize) this.done = true;

    // prefetch da próxima página (background), sem bloquear o retorno
    if (!this.done) {
      Promise.resolve().then(async () => {
        try { const next = await this._fetch(this.cursor); await this._ingest(next); this._prefetched = next; } catch (_) {}
      });
    }
    return { items, done: this.done };
  }
}

export { CurationBrowser };
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npm test -- tests/test_curationBrowser.test.js` · Expected: PASS (2).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(collector): CurationBrowser (paginação por cursor + prefetch)"`

---

### Task 6: schema de cache + bootstrap de módulo

> **NOTA DE REVISÃO:** o app carrega scripts **clássicos** (`<script src>`, sem bundler) e nenhum arquivo do app usa `export`. Os 4 arquivos novos (Tasks 1-5) têm `export` (para o Vitest) → **não podem** ser carregados como `<script>` clássico (SyntaxError). Solução: carregá-los como **ES modules** via UM bootstrap de módulo que os importa. Não adicionar `export` a arquivos clássicos existentes.

**Files:**
- Modify: `scripts/storage/dataStore.js` (só o schema Dexie — arquivo clássico, sem `export`)
- Create: `scripts/cacheBootstrap.js` (ES module)
- Modify: `index.html` (uma tag `<script type="module">`)
- Test: sem novo teste (integração); validado pela suíte das Tasks 1-5 + verificação manual na Task 8

**Interfaces:**
- Produces: índices `lastAccessedAt`/`source` em `curations`/`entities`; após bootstrap, instâncias globais `window.OfflineCache`, `window.EntityHydrator`, `window.CurationBrowser` ligadas a `window.DataStore.db`/`window.ApiService`.

- [ ] **Step 1: Bump da versão do schema Dexie** (em `dataStore.js`)

Localizar o maior `this.db.version(N).stores({...})` e adicionar `version(N+1)` que **copia todos os índices existentes** de `curations` e `entities` e acrescenta `lastAccessedAt, source` (campos aditivos; Dexie preserva dados). Exemplo (ajustar os índices copiando os da versão N real):

```javascript
// dataStore.js — após a última .version(N).stores(...)
this.db.version(/* N+1 */).stores({
  curations: '<todos-os-indices-da-versao-anterior>, lastAccessedAt, source',
  entities:  '<todos-os-indices-da-versao-anterior>, lastAccessedAt, source',
});
```
NÃO adicionar `export` nem bootstrap de serviços aqui (é arquivo clássico).

- [ ] **Step 2: Criar `scripts/cacheBootstrap.js` (ES module)**

```javascript
// scripts/cacheBootstrap.js — carregado como <script type="module">
import { StorageBudget } from './storage/storageBudget.js';
import { OfflineCache } from './storage/offlineCache.js';
import { EntityHydrator } from './services/entityHydrator.js';
import { CurationBrowser } from './services/curationBrowser.js';

async function waitFor(getter, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = getter();
    if (v) return v;
    await new Promise(r => setTimeout(r, 50));
  }
  return getter();
}

async function initCollectorCache() {
  await waitFor(() => window.DataStore && window.DataStore.db);
  await waitFor(() => window.ApiService);
  const budget = new StorageBudget();
  const cache = new OfflineCache({ db: window.DataStore.db, budget });
  const hydrator = new EntityHydrator({
    apiService: window.ApiService,
    cache,
    isEntityCached: async (id) =>
      !!(await window.DataStore.db.entities.where('entity_id').equals(id).first()),
  });
  const browser = new CurationBrowser({ apiService: window.ApiService, cache, hydrator });
  window.OfflineCache = cache;
  window.EntityHydrator = hydrator;
  window.CurationBrowser = browser;
  window.dispatchEvent(new CustomEvent('collector-cache-ready'));
}

initCollectorCache();
```

- [ ] **Step 3: Carregar como módulo** — em `index.html`, adicionar UMA linha junto aos demais scripts (a ordem não importa; o módulo é deferido e espera `DataStore`/`ApiService`):

```html
<script type="module" src="scripts/cacheBootstrap.js"></script>
```
(O `import` do módulo puxa os 4 arquivos das Tasks 1-5; **não** adicionar tags clássicas para eles.)

- [ ] **Step 4: Rodar a suíte inteira** — Run: `npx vitest run` · Expected: PASS (todas verdes; o bump de schema não quebra as suítes existentes).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(collector): schema de cache + bootstrap de módulo dos serviços"`

---

### Task 7: checkout no `OfflineCache` + startup push-only no `syncManagerV3`

> **NOTA DE REVISÃO:** `syncManagerV3.js` é arquivo clássico (`window.SyncManager = ...`, sem `export`) — **não** adicionar `export` (quebraria o carregamento no browser). Por isso a lógica de checkout (testável) vai para o `OfflineCache` (que já é módulo testado), e o `syncManagerV3` apenas **delega** + fica push-only. O push-only do `fullSync` (arquivo clássico) é verificado manualmente na Task 8; o checkout é coberto por teste no `OfflineCache`.

**Files:**
- Modify: `scripts/storage/offlineCache.js` (+ teste em `tests/test_offlineCache.test.js`)
- Modify: `scripts/sync/syncManagerV3.js` (push-only + delegação; SEM `export`)

**Interfaces:**
- Produces:
  - `OfflineCache.markCurationOwned(curationId, apiService)` — marca a curadoria (`source:'owned'`) e garante a entidade local (`source:'owned'`; hidrata via `apiService.getEntity` se faltar). Testável com fake-indexeddb.
  - `syncManagerV3.fullSync()` deixa de chamar `pullCurations()`/`pullLinkedEntities()`/`pruneUnlinkedSyncedEntities()`; mantém `pushEntities()`/`pushCurations()`.
  - `syncManagerV3.checkoutCuration(id)` delega para `window.OfflineCache.markCurationOwned(id, window.ApiService)`.

- [ ] **Step 1: Escrever o teste que falha (OfflineCache.markCurationOwned, fake-indexeddb)** — adicionar em `tests/test_offlineCache.test.js`:

```javascript
describe('OfflineCache.markCurationOwned', () => {
  test('marca curadoria e entidade como owned; hidrata se faltar', async () => {
    const db = makeDb();
    await db.curations.put({ id: 'c1', curation_id: 'c1', entity_id: 'e1', source: 'cache' });
    // entidade ainda não está local -> deve hidratar
    const apiService = { getEntity: vi.fn(async (id) => ({ id, entity_id: id, name: 'n' })) };
    const c = new OfflineCache({ db, budget: { getBudget: async () => ({ maxBytes: 1e9 }) } });

    await c.markCurationOwned('c1', apiService);

    expect((await db.curations.get('c1')).source).toBe('owned');
    const ent = await db.entities.where('entity_id').equals('e1').first();
    expect(ent).toBeTruthy();
    expect(ent.source).toBe('owned');
    expect(apiService.getEntity).toHaveBeenCalledWith('e1');
  });

  test('se a entidade já existe local, só marca owned (sem fetch)', async () => {
    const db = makeDb();
    await db.curations.put({ id: 'c2', curation_id: 'c2', entity_id: 'e2', source: 'cache' });
    await db.entities.put({ id: 'e2', entity_id: 'e2', source: 'cache' });
    const apiService = { getEntity: vi.fn() };
    const c = new OfflineCache({ db, budget: { getBudget: async () => ({ maxBytes: 1e9 }) } });

    await c.markCurationOwned('c2', apiService);

    expect((await db.entities.where('entity_id').equals('e2').first()).source).toBe('owned');
    expect(apiService.getEntity).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `npx vitest run tests/test_offlineCache.test.js` · Expected: FAIL (método inexistente).

- [ ] **Step 3: Implementar `markCurationOwned` no `OfflineCache`**

```javascript
  async markCurationOwned(curationId, apiService) {
    const cur = await this.db.curations.get(curationId)
      || await this.db.curations.where('curation_id').equals(curationId).first();
    if (!cur) return;
    await this.db.curations.update(cur.id, { source: 'owned' });
    if (cur.entity_id) {
      const ent = await this.db.entities.where('entity_id').equals(cur.entity_id).first();
      if (!ent) {
        const fetched = await apiService.getEntity(cur.entity_id);
        if (fetched) await this.db.entities.put({ ...fetched, source: 'owned' });
      } else {
        await this.db.entities.update(ent.id, { source: 'owned' });
      }
    }
  }
```

- [ ] **Step 4: Rodar e ver passar** — Run: `npx vitest run tests/test_offlineCache.test.js` · Expected: PASS (7 no total: 5 anteriores + 2 novos).

- [ ] **Step 5: Alterar `syncManagerV3.js` (SEM export)** — em `fullSync()`, substituir o bloco "1. Pull from server" (as chamadas `pullCurations()`/`pullLinkedEntities()`) por comentário de push-only, mantendo os pushes já existentes:

```javascript
// dentro de fullSync(), no lugar do bloco de pull global:
            // Startup é push-only: navegação/cache é sob demanda (CurationBrowser + OfflineCache).
```
(Os `pushEntities()`/`pushCurations()` já existentes permanecem. Remover também a chamada de `pruneUnlinkedSyncedEntities`, se houver, dentro do fluxo de startup.)

E adicionar o método de delegação (arquivo clássico, sem export):

```javascript
  async checkoutCuration(curationId) {
    if (window.OfflineCache && typeof window.OfflineCache.markCurationOwned === 'function') {
      return window.OfflineCache.markCurationOwned(curationId, window.ApiService);
    }
  }
```

- [ ] **Step 6: Rodar a suíte inteira** — Run: `npx vitest run` · Expected: PASS (todas).

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(collector): checkout no OfflineCache + startup push-only no syncManager"`

---

### Task 8: `uiManager.loadCurations()` → browse paginado

**Files:**
- Modify: `scripts/ui-core/uiManager.js`
- Verificação: manual no app (a view é DOM-heavy; sem unit test novo)

**Interfaces:**
- Consumes: `window.CurationBrowser`.
- Produces: `loadCurations()` usa `CurationBrowser` (página inicial + botão/scroll "carregar mais"), renderizando cards de `restaurant_name`/`categories`/`status`; remove o `DataStore.getCurations()` que lia tudo e o `curationsCache` global de milhares.

- [ ] **Step 1: Reescrever `loadCurations()`** para:
  1. `window.CurationBrowser.openScope({ status: 'draft' | null, curatorId: <toggle Minhas/Todas> })`.
  2. `const { items, done } = await window.CurationBrowser.nextPage();` e renderizar os cards desses itens (append), sem buscar entidades para a lista.
  3. Adicionar controle "carregar mais"/infinite-scroll que chama `nextPage()` de novo e faz append; ocultar quando `done`.
  4. Ao clicar num card para editar uma curadoria não-própria, chamar `window.SyncManager.checkoutCuration(id)` antes de abrir o editor.

(Manter o restante da view — filtros na página carregada podem seguir client-side sobre os itens já renderizados; busca por texto/cidade no servidor é fast-follow, fora deste plano.)

- [ ] **Step 2: Verificação manual** — abrir o Collector, confirmar: (a) startup não dispara pull em massa (rede mostra `/curations/search` paginado, não N×`/entities/{id}`), (b) a lista aparece rápido, (c) "carregar mais" pagina, (d) editar uma curadoria de outro faz checkout e permanece após reload/offline.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(collector): loadCurations usa CurationBrowser (paginado, sem carga total)"`

---

## Self-Review

**1. Cobertura do spec:** browse server-backed paginado + prefetch (T5, T8), cache offline progressivo (T3), hidratação de entidade em background para edição offline (T4), orçamento adaptativo + evicção que preserva sujos (T1, T2, T3), startup push-only (T7), checkout on edit (T7, T8), schema de cache (T6), sem mudança de backend (usa `/curations/search` + `getEntity`). Busca texto/cidade e batch-GET marcados como fast-follow (fora de escopo). ✔

**2. Placeholders:** cada passo de código traz o código; os pontos DOM-heavy (T8) trazem passos concretos e verificação manual explícita (não há como TDD-ar a view sem harness de UI). ✔

**3. Consistência de tipos:** `StorageBudget.getBudget()->{maxBytes}` usado por `OfflineCache.enforceBudget`; `OfflineCache.putCurations/putEntity/selectEvictions` usados por `CurationBrowser` e `EntityHydrator`; `CurationBrowser.nextPage()->{items,done}` consumido por `uiManager`; `checkoutCuration(id)` chamado por `uiManager`. Injeção por construtor em todas as unidades → dublês nos testes. ✔

**Nota:** `syncManagerV3.js` precisa exportar a classe (`export { SyncManagerV3 }`) além do `window.SyncManager` para testabilidade — adição não-quebrante. Idem para os novos módulos (export + bootstrap window).
