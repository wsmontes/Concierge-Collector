# Server-Driven Curation Browsing

**Date:** 2026-07-14
**Status:** Approved
**Context:** Escala prevista de 100k+ curations — carregar tudo no cliente é inviável.

## Arquitetura

```
UI (navegação)  ←──────────  API (MongoDB)    ←──  dados canônicos
UI (cria/edita)  ──────────►  API  ──────────►  MongoDB
UI (offline)     ←──────────  IndexedDB        ←──  sync queue + drafts + settings
```

- Navegação, filtros, busca: **sempre server-driven**, sem cache local.
- Criação/edição: **POST/PATCH/DELETE direto na API** quando online; cai no `syncQueue` quando offline.
- IndexedDB mantém `curations` e `entities` **apenas para o fluxo offline** (sync push, rascunhos, conflitos), não para renderização da UI.

## O que é removido

| Arquivo | Justificativa |
|---------|--------------|
| `scripts/storage/offlineCache.js` | Cache de navegação local — sem consumidores obrigatórios |
| `scripts/services/entityHydrator.js` | Prefetch de entidades — `window.EntityHydrator` nunca é lido |
| `scripts/storage/storageBudget.js` | Controle de orçamento — só o OfflineCache usava |
| `scripts/cacheBootstrap.js` | Bootstrap dos 3 acima |
| `tests/test_offlineCache.test.js` | Testa classe removida |
| `tests/test_entityHydrator.test.js` | Testa classe removida |
| `tests/test_storageBudget.test.js` | Testa classe removida |

## O que muda no CurationBrowser (`scripts/services/curationBrowser.js`)

### Antes
```js
constructor({ apiService, cache, hydrator, pageSize })
// _ingest() escreve no cache + enfileira hydrator
// nextPage() chama _ingest() depois de cada fetch
// Prefetch duplica o trabalho de ingestão
```

### Depois
```js
constructor({ apiService, pageSize = 25 })
// Sem dependência de cache ou hydrator
// nextPage() só faz fetch → retorna items
// Sem prefetch (desnecessário sem cache local)
// this.loading trava chamadas duplicadas durante scroll
// this.items acumula páginas em memória
```

### API do servidor usada

- `GET /curations/search?limit=25` — primeira página
- `GET /curations/search?limit=25&after_id=<cursor>` — scroll/paginação
- `GET /curations/search?curator_id=X&limit=25` — filtrar por curador
- `GET /curations/search?city=X&limit=25` — filtrar por cidade
- `GET /curations/search?q=pizza&limit=25` — busca textual
- `GET /curators` — dropdown de curadores (já existe)
- `GET /curations/cities` — dropdown de cidades (endpoint novo, `distinct("city")`)

## O que muda no uiManager.js

### `loadCurations()`
- Remove a checagem `if (window.CurationBrowser && !this._curationsSeeded)`
- Remove a chamada `_seedCurationsFromServer()`
- Passa a usar `CurationBrowser` direto para buscar da API e renderizar
- Mantém o fallback `DataStore.getCurations()` para quando CurationBrowser não está disponível

### `_seedCurationsFromServer()`
- Removido inteiro. O loop de 50 páginas desaparece.

### Métodos que continuam usando IndexedDB
- `linkReviewToEntity()` — `db.entities.put()` + `db.curations.put()` (fluxo offline)
- `unlinkCurationFromEntity()` — `db.curations.put()` (fluxo offline)
- `confirmDeleteCuration()` — `DataStore.deleteCuration()` (fluxo offline)

## O que fica no IndexedDB

```js
db.version(1).stores({
  entities:   '++id, entity_id, type, name, status, createdBy, createdAt, updatedAt, etag, sync.status',
  curations:  '++id, curation_id, entity_id, curator_id, category, concept, createdAt, updatedAt, etag, sync.status',
  curators:   '++id, curator_id, name, email, status, createdAt, lastActive',
  syncQueue:  '++id, type, action, local_id, entity_id, data, createdAt, retryCount, lastError',
  drafts:     '++id, type, data, curator_id, createdAt, lastModified',
  settings:   'key',
});
```

Tabelas `entities` e `curations` são mantidas porque o syncManager, conceptModule, restaurantModule, PlacesAutomation e uiManager as usam para:
- Rastrear `sync.status` (pending → synced → conflict)
- Guardar rascunhos locais antes do push
- Resolver conflitos e duplicatas

## Novo endpoint: `GET /curations/cities`

```python
@router.get("/cities")
def list_cities():
    """Retorna lista distinta de cidades para o dropdown de filtro."""
    cities = db.curations.distinct("city")
    return sorted([c for c in cities if c])
```

MongoDB `distinct()` com índice no campo `city` — O(1) na prática. Cache HTTP com `Cache-Control: max-age=300`.

## O que NÃO muda

- **DataStore** — `getCurations()`, `getEntities()`, `createEntity()`, `deleteCuration()` etc. continuam funcionando para o fluxo offline
- **SyncManager** — `pushEntities()`, `pushCurations()`, `getSyncStatus()`, `getConflicts()`, `resolveConflict()` continuam usando IndexedDB
- **ImportManager, PlacesAutomation, ConceptModule, RestaurantModule** — continuam usando DataStore
- **databaseDiagnostics.js** — ferramenta de dev, continua acessando IndexedDB

## Plano de implementação

1. Simplificar `CurationBrowser` — remover cache/hydrator, `_ingest()`, prefetch
2. Remover `cacheBootstrap.js` + tag `<script>` no `index.html`
3. Mover a criação do `CurationBrowser` para `main.js` (ou `uiManager.loadCurations()` criar lazy) — `window.CurationBrowser = new CurationBrowser({ apiService: window.ApiService })`
4. Deletar `offlineCache.js`, `entityHydrator.js`, `storageBudget.js` + testes
5. Refatorar `uiManager.loadCurations()` — usar `window.CurationBrowser` direto para buscar páginas da API e renderizar
6. Remover `_seedCurationsFromServer()` do `uiManager.js`
7. Adicionar `GET /curations/cities` no backend
8. Remover `concierge_db_corrupted` sentinel do `databaseManager.js` (flag era setada pelo offlineCache)
9. Rodar suite de testes completa
