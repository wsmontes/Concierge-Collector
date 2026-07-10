# Collector: browse paginado + cache offline progressivo — Design

**Data:** 2026-07-09
**Status:** aprovado (aguardando revisão da spec)
**Contexto:** o Collector (frontend JS, IndexedDB via `scripts/storage/dataStore.js`) hoje replica o catálogo inteiro localmente antes de ser útil. Com o dataset atual (1.000 curadorias SP importadas, +9k a caminho) isso ficou inviável.

## Problema (como funciona hoje)

- Startup: `main.js` → `SyncManager.syncAll()` → `fullSync()`:
  1. `pullCurations()` — puxa **todas** as curadorias (paginado) para o IndexedDB.
  2. `pullLinkedEntities()` — **1 `getEntity(id)` por entidade linkada** (1.000+ GETs sequenciais). **Maior gargalo.**
  3. `pruneUnlinkedSyncedEntities()` — apaga do IndexedDB o não-linkado.
- Browse: `uiManager.loadCurations()` → `DataStore.getCurations({...})` lê **todas** as curadorias do IndexedDB, **sem paginação** (carrega tudo na memória e renderiza de uma vez).

Ou seja: "navegar as curadorias" = ter o banco inteiro replicado localmente e lê-lo por completo. Não escala.

## Decisões do brainstorming

- **Working set local = trabalho ativo**, nunca "todas as minhas": (1) criadas localmente não-sincronizadas, (2) com edição pendente/conflito, (3) cache LRU limitado das últimas abertas. O local **nunca escala** com o total (do curador ou global).
- **Browse é server-backed e paginado** (online), inclusive "Minhas curadorias" (`curator_id == eu`, editável via checkout). Offline funciona só sobre o que já foi baixado.
- **Paginação com prefetch**: baixa a página atual (25) + próxima (25) em background; idem ao mudar de página e ao buscar.
- **Entidade NÃO é on-demand**: é baixada em background, por último (menor prioridade), para que o par curadoria+entidade já visto seja **editável offline**.
- **Orçamento de memória adaptativo**: teto de cache proporcional ao dispositivo (`navigator.storage.estimate()`, `navigator.deviceMemory`); evicção LRU apenas de itens **limpos**.
- **Startup só faz push** do pendente; **zero pull em massa**.

## Achados que embasam o design

- API já tem `GET /curations/search` com `curator_id`, `status`, `entity_id`, `since`, `limit`, `offset` e **cursor `after_id`** (O(log n)).
- A curadoria já traz **`restaurant_name` denormalizado** → a **lista renderiza sem buscar entidade**. Entidade só é necessária para **editar** (hidratação em background).
- `GET /entities` tem paginação (`type`, `name`, `since`, `limit`, `offset`, `after_id`), mas **não** há batch-GET por lista de ids. Como a lista não precisa de entidade e a hidratação é bounded (só o que está no cache), a ausência de batch-GET é aceitável no v1 (fast-follow opcional no backend).

## Arquitetura (unidades com fronteiras claras)

Cada unidade nova é um arquivo focado; o que existe é modificado no mínimo necessário.

### 1. `CurationBrowser` (novo — `scripts/services/curationBrowser.js`)
- **O que faz:** busca páginas de curadorias do servidor (`ApiService.listCurations`/search) com cursor `after_id`, mantém estado de paginação por "escopo" (all / mine / search), e faz **prefetch** da próxima página.
- **Interface:** `openScope({curatorId?, status?, query?}) -> void`; `getPage(n) -> Promise<{items, nextCursor}>`; `nextPage()/prevPage()`; emite eventos de página pronta. Ao entregar uma página, passa os itens para o `OfflineCache` persistir e enfileira as entidades no `EntityHydrator`.
- **Depende de:** `ApiService`, `OfflineCache`, `EntityHydrator`.

### 2. `OfflineCache` (novo — `scripts/storage/offlineCache.js`)
- **O que faz:** persiste no IndexedDB as curadorias (e entidades) que passam pela navegação, com metadados de cache: `source: 'owned' | 'cache'`, `lastAccessedAt`, `dirty` (tem edição local não-pushada). Aplica o **orçamento** e faz **evicção LRU** de itens `dirty=false` quando excede o teto.
- **Interface:** `putCurations(items)`, `putEntity(entity)`, `touch(id)`, `enforceBudget()`, `markDirty(id)`, `isCached(id)`.
- **Regra de evicção:** ordena candidatos por `lastAccessedAt` asc; remove os mais antigos **com `dirty=false` e não em edição**; **nunca** remove itens não-sincronizados/pendentes/conflito.
- **Depende de:** `DataStore.db`, `StorageBudget`.

### 3. `StorageBudget` (novo — `scripts/storage/storageBudget.js`)
- **O que faz:** calcula o teto de cache (bytes/itens) a partir de `navigator.storage.estimate()` (quota/usage) e `navigator.deviceMemory`, com fallback conservador quando as APIs não existem.
- **Interface:** `async getBudget() -> {maxBytes, maxItems}`; `async currentUsage() -> bytes`.
- **Heurística:** teto = min(config máx absoluto, fração da quota livre); reduz em `deviceMemory` baixo. Valores exatos definidos no plano.

### 4. `EntityHydrator` (novo — `scripts/services/entityHydrator.js`)
- **O que faz:** fila de **baixa prioridade** que, para curadorias já no cache sem entidade local, busca a entidade (`ApiService.getEntity`) em background e persiste via `OfflineCache.putEntity`, tornando o par editável offline. Roda ocioso (ex.: `requestIdleCallback`), respeita o orçamento, e é pausável offline.
- **Interface:** `enqueue(entityIds)`, `start()/pause()`.
- **Depende de:** `ApiService`, `OfflineCache`.

### 5. Mudanças em `syncManagerV3.js`
- `fullSync()` → **startup push-only**: remove o pull global. Mantém `pushEntities()`/`pushCurations()`. Remove/aposenta `pullCurations()` (global) e `pullLinkedEntities()` (loop 1-GET). `pruneUnlinkedSyncedEntities()` é substituído pela evicção do `OfflineCache` (que preserva itens sujos).
- **Checkout on edit:** ao iniciar edição de uma curadoria que não é `owned`, marca `source='owned'`/`dirty` no cache (garante que não seja evictada e que entre no push). Se a entidade ainda não estiver local, força hidratação síncrona daquele id.
- Sync incremental (`since`) permanece útil para **refrescar itens já no cache** (não para baixar tudo).

### 6. Mudanças em `uiManager.loadCurations()`
- Deixa de chamar `DataStore.getCurations()` (tudo-local). Passa a usar `CurationBrowser` (paginado + prefetch, infinite scroll ou paginação explícita). Cards renderizam de `restaurant_name`/categorias/status. Remove o carregamento/render de milhares de uma vez e o `curationsCache` global.

## Modelo de dados (IndexedDB)

- Tabelas `curations`/`entities` ganham metadados de cache: `source` (`owned`|`cache`), `lastAccessedAt`, `dirty` (derivável de `sync.status`), sem quebrar o schema atual (campos aditivos). Índice por `lastAccessedAt` para evicção eficiente.

## Fluxos

- **Abrir Collector (device novo, milhares no servidor):** startup faz push do pendente (nada a puxar). Browse abre escopo "Mine"/"All", baixa 25 + prefetch 25. Cards aparecem na hora. `EntityHydrator` começa a baixar entidades das curadorias visíveis em background.
- **Navegar/buscar:** cada página baixa 25 + prefetch da próxima; cache cresce; ao exceder o orçamento, evicta os limpos mais antigos.
- **Editar offline:** curadoria+entidade já baixadas → edição local marca `dirty`; entra na fila de push; sobe quando online (mecanismo existente).

## Fora de escopo (YAGNI / fast-follow)

- Busca por **texto/cidade no servidor** (`/curations/search`): v1 filtra por `curator_id`/`status` + filtro client-side na página; adicionar params no backend é fast-follow.
- **Batch-GET de entidades** no backend: otimização opcional; v1 hidrata por item em background.
- Reescrita online-first total (o trabalho próprio continua offline-capaz).
- Prefetch preditivo além de "próxima página".

## Compatibilidade / riscos

- `pruneUnlinkedSyncedEntities` some — a evicção do `OfflineCache` assume o papel, com a regra crítica de **nunca remover itens sujos** (evita perda de trabalho não-sincronizado).
- Offline: navegação limitada ao que está em cache; ações que exigem servidor ficam desabilitadas com feedback claro.
- `syncManagerV3.js` (1.624 linhas) e `uiManager.js` (2.056 linhas) são grandes; a lógica nova vive em arquivos focados novos, tocando o mínimo nesses dois.
