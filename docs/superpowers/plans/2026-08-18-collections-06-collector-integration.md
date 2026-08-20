# Collections no Collector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar em cada card de Curation um botão Collections que mostra associações publicadas e permite ao admin criar uma operação individual de draft, sem afetar o comportamento offline do Collector.

**Architecture:** FastAPI fornece leitura publicada mínima para qualquer usuário autenticado. Admin consulta opções/draft e muta pela mesma porta Payload das operações em massa; o Collector usa um serviço online-only e um modal integrado ao `ModalManager`, sem cache Dexie, optimistic update ou sync queue.

**Tech Stack:** vanilla JavaScript/ModuleWrapper, ApiService/AuthService/ModalManager existentes, CSS do Collector, FastAPI, Payload endpoints, Vitest/jsdom, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-collections-payload-cms-design.md`

## Global Constraints

- Botão Collections aparece nos dois renderers: `CardFactory.createCurationCard` e `UIManager.createReviewCard`.
- Publicado é view-only para viewer/curator/admin; drafts/ações aparecem somente a admin.
- `users.role` do FastAPI é a única autoridade; profile pode somente refletir esse valor.
- Collector não cria, publica, arquiva, restaura Collection nem administra credential.
- Mutação envia exatamente um `curation_id` com `mode='explicit'`, `Idempotency-Key` e `If-Match`.
- No Payload, a sessão CMS por cookie continua sendo o caminho normal do Admin. Bearer direto só é aceito na rota do Collector quando a origem é explicitamente allowlisted, o body contém exatamente um ID e o FastAPI confirma a autorização atual.
- Nenhuma tabela Dexie, DataStore, SyncManager ou queue é modificada/chamada.
- `navigator.onLine` é hint; erro real de rede mantém estado retryable e nunca presume sucesso.
- Diferenciar offline/network, 401, 403, 409/412, 423 e 503 na UI.
- Dados recebidos usam `textContent`, URLs vêm de base configurada e click não propaga ao card.
- Feature flag visual não substitui enforcement FastAPI/Payload.

---

### Task 1: Expor associações publicadas e opções de draft seguras

**Files:**
- Create: `concierge-api-v3/app/models/collection_associations.py`
- Create: `concierge-api-v3/app/api/collection_associations.py`
- Modify: `concierge-api-v3/app/api/cms_auth.py`
- Modify: `concierge-api-v3/main.py`
- Modify: `concierge-api-v3/tests/conftest.py`
- Modify: `concierge-api-v3/tests/factories.py`
- Test: `concierge-api-v3/tests/test_catalog_associations.py`
- Test: `concierge-api-v3/tests/test_cms_bearer_introspection.py`
- Create: `apps/admin/src/auth/introspect-collector-bearer.ts`
- Create: `apps/admin/src/auth/authenticate-admin-request.ts`
- Create: `apps/admin/src/payload/endpoints/collector-collections.ts`
- Modify: `apps/admin/src/payload/endpoints/operations.ts`
- Modify: `apps/admin/payload.config.ts`
- Modify: `contracts/openapi/fastapi-admin-internal.v1.json` (gerado)
- Modify: `packages/fastapi-client/src/generated.ts` (gerado)
- Test: `apps/admin/tests/integration/payload/collector-collections.int.test.ts`
- Create: `apps/admin/tests/support/fixtures/collector-auth.ts`

**Interfaces:**
- Produces: `GET /api/v3/curations/{curation_id}/collections`; `POST /api/v3/auth/cms/introspect-bearer`; `GET /api/admin/v1/curations/:id/collection-options`.

- [ ] **Step 1: Escrever testes de shape/RBAC/archive**

```python
def test_associations_return_only_published_minimum(client, viewer_headers, cms_writer):
    seed_membership(cms_writer, curation_id="c1", lifecycle="published")
    seed_membership(cms_writer, curation_id="c1", lifecycle="archived", slug="hidden")
    response = client.get('/api/v3/curations/c1/collections', headers=viewer_headers)
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'private, no-store'
    assert response.json() == {"items": [{
        "collection_id": "collection-1", "slug": "visible", "title": "Visible",
        "current_published_version": 2,
    }]}

def test_bearer_introspection_rejects_curator_for_collector_write(client, curator_auth_headers, cms_service_headers):
    response = client.post('/api/v3/auth/cms/introspect-bearer',
                           headers={**curator_auth_headers, **cms_service_headers})
    assert response.status_code == 403

def test_cms_introspection_logs_decision_without_token(
    client, admin_auth_headers, cms_service_headers, caplog,
):
    response = client.post('/api/v3/auth/cms/introspect-bearer', headers={
        **admin_auth_headers, **cms_service_headers, 'X-Request-Id': 'request-1',
    })
    assert response.status_code == 200
    assert 'request-1' in caplog.text
    assert admin_auth_headers['Authorization'] not in caplog.text
```

```typescript
test('normal Admin cookie session can read options without Collector bearer', async () => {
  const response = await admin.get('/api/admin/v1/curations/c1/collection-options', {
    cookies: adminCookie(), headers: { Origin: 'https://admin.concierge-collector.com' },
  })
  expect(response.status).toBe(200)
})

test('Collector bearer can read only options for the curation in the path', async () => {
  const response = await collector.get('/api/admin/v1/curations/c1/collection-options', {
    headers: collectorHeaders({ origin: 'https://concierge-collector.com' }),
  })
  expect(response.status).toBe(200)
})

test('Collector bearer requires the exact origin and a single explicit id', async () => {
  await expect(collector.post('/api/admin/v1/collections/col-1/draft/operations', {
    headers: { ...collectorHeaders(), Origin: 'https://evil.example' },
    body: { mode: 'explicit', action: 'add', curation_ids: ['c1'] },
  })).rejects.toMatchObject({ status: 403 })
  await expect(collector.post('/api/admin/v1/collections/col-1/draft/operations', {
    headers: collectorHeaders(), body: { mode: 'explicit', action: 'add', curation_ids: ['c1', 'c2'] },
  })).rejects.toMatchObject({ status: 422 })
})

test('Collector polls only its own single-curation operation', async () => {
  const response = await collector.get('/api/admin/v1/operations/op-other', {
    headers: collectorHeaders({ origin: 'https://concierge-collector.com' }),
  })
  expect(response.status).toBe(404)
})
```

- [ ] **Step 2: Rodar e confirmar 404**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_catalog_associations.py tests/test_cms_bearer_introspection.py -v
```

Expected: FAIL/404.

- [ ] **Step 3: Implementar reads mínimas e bearer forward**

Registrar `collection_associations.router` antes do router catch-all de Curations. Endpoint exige `verify_auth`, valida Curation existente e consulta CMS read-only pelo predicado exato `addedInVersion <= currentPublishedVersion < removedInVersion|null` + Collection published; projeta somente quatro campos e no-store.

`introspect-bearer` exige simultaneamente service key e Bearer de usuário, valida JWT com `verify_auth`, relê `users` e exige admin atual. Emite log estruturado da decisão com actor e `request_id`, nunca com token; mudanças de role/authorized são auditadas na própria fronteira de escrita de Users da fase 07, evitando um evento persistido por leitura. Payload nunca decodifica o JWT.

Implementar em `apps/admin/src/auth/authenticate-admin-request.ts` uma fronteira única, com esta ordem concreta:

```ts
export async function authenticateAdminRequest(request: Request, input: {
  allowCollectorBearer?: boolean; explicitCurationIds?: string[];
} = {}) {
  const origin = request.headers.get('origin')
  if (origin === env.COLLECTOR_ORIGIN) {
    const bearer = request.headers.get('authorization')
    if (!input.allowCollectorBearer || !bearer || input.explicitCurationIds?.length !== 1) {
      throw forbidden()
    }
    return introspectCollectorBearer({ bearer, requestId: requestId(request), requiredRole: 'admin' })
  }
  if (origin && origin !== env.ADMIN_ORIGIN) throw forbidden()
  const cmsUser = await payloadCookieSession(request) // caminho normal, somente host Admin
  if (!cmsUser) throw unauthorized()
  return revalidateWithFastApi(cmsUser.id, requestId(request))
}
```

Usar `authenticateAdminRequest(request)` para chamadas originadas no Admin. Na leitura de options, passar `{allowCollectorBearer:true, explicitCurationIds:[curationIdDoPath]}`; na operação, passar `{allowCollectorBearer:true, explicitCurationIds:body.curation_ids}`. Em ambos os casos, origem Collector ignora qualquer cookie ambiente e exige Bearer. A mutação recusa falta de `Origin`, origem diferente de `COLLECTOR_ORIGIN`, qualquer modo não explícito e cardinalidade diferente de um antes de enfileirar.

Para `GET /operations/:id`, o ramo Collector primeiro introspecta o Bearer e depois consulta a operation por `{id, actorId:identity.userId, mode:'explicit', selectedCount:1}`; mismatch responde 404 e nunca revela job de outro admin. O response expõe somente status/progress/error code seguro. O ramo Admin continua usando cookie + revalidação. Configurar CORS/CSRF do Payload com a raiz exata (`https://concierge-collector.com`; `http://127.0.0.1:5500` apenas development) e `https://admin.concierge-collector.com`; permitir no preflight somente `Authorization`, `Content-Type`, `Idempotency-Key`, `If-Match` e `X-Request-Id`; nunca wildcard, subdomínio por padrão ou origem refletida.

`tests/factories.py` adiciona `seed_membership(cms_writer, *, curation_id, lifecycle, slug='visible', version=2)`. `tests/conftest.py` adiciona `viewer_headers` e `cms_service_headers` usando apenas tokens/segredos de teste. `apps/admin/tests/support/fixtures/collector-auth.ts` exporta `adminCookie()`, `collectorHeaders({origin?})`, clients `admin`/`collector` e seeds isolados; nenhum símbolo do sketch fica global implícito.

Endpoint Payload de opções lista Collections não archived cursor-paginadas (`limit<=100`, `q`) com `{collectionId,slug,title,currentPublishedVersion,draftRevision,draftState,desiredState,locked}`. `desiredState` resulta da versão base + delta visível; não expõe histórico/audit/apps/credentials.

- [ ] **Step 4: Rodar contratos e integração**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_catalog_associations.py tests/test_cms_bearer_introspection.py -v
cd ..
npm run generate:contracts
npm run check:contracts
npm run test:integration --workspace=@concierge/admin -- tests/integration/payload/collector-collections.int.test.ts
```

Expected: PASS para viewer read, admin options, curator mutation denial e archives ausentes.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/tests apps/admin contracts packages/fastapi-client
git commit -m "feat(collections): expor associacoes seguras ao Collector"
```

---

### Task 2: Criar CollectionsService online-only no frontend vanilla

**Files:**
- Create: `scripts/services/collectionsService.js`
- Modify: `scripts/services/apiService.js`
- Modify: `scripts/core/config.js`
- Modify: `scripts/core/main.js`
- Modify: `eslint.config.mjs`
- Test: `tests/test_collectionsService.test.js`
- Test: `tests/test_apiService_params.test.js`

**Interfaces:**
- Consumes: `ApiService.getAuthHeaders()`, `AuthService.getToken()`, FastAPI/Payload routes Task 1.
- Produces: `getPublishedAssociations`, `getDraftOptions`, `createSingleCurationOperation`, `getOperation`, `isOnlineHint`; `window.CollectionsService` instance.

- [ ] **Step 1: Escrever teste de headers/body e zero sync**

```javascript
test('single mutation usa Payload, cardinalidade um e headers concorrentes', async () => {
  await service.createSingleCurationOperation({
    collectionId: 'col 1', curationId: 'cur/1', action: 'add',
    draftRevision: 7
  })
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('https://admin.test/api/admin/v1/collections/col%201/draft/operations')
  expect(init.headers).toMatchObject({
    Authorization: 'Bearer token', 'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
    'If-Match': '7', 'X-Request-Id': '22222222-2222-4222-8222-222222222222'
  })
  expect(init.credentials).toBe('omit')
  expect(JSON.parse(init.body)).toEqual({
    mode: 'explicit', action: 'add', curation_ids: ['cur/1'], draft_revision: 7
  })
  expect(window.SyncManagerV3?.enqueue).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Rodar e confirmar arquivo ausente**

Run: `npx vitest run tests/test_collectionsService.test.js tests/test_apiService_params.test.js`

Expected: FAIL por `collectionsService.js` ausente/método ApiService ausente.

- [ ] **Step 3: Implementar configuração e serviço estreito**

Adicionar a `AppConfig`:

```javascript
cms: {
  adminBaseUrl: environment === 'production'
    ? 'https://admin.concierge-collector.com' : 'http://localhost:3000',
  endpoints: { collectionOptions: '/api/admin/v1/curations', collectionOperation: '/api/admin/v1/collections' }
},
app: { features: { collectionsModal: true } }
```

`ApiService.getCurationCollections(curationId)` chama FastAPI `curations/${encodeURIComponent(id)}/collections`. `CollectionsService` usa `ModuleWrapper.defineClass`, injeta ApiService/AuthService/fetch/config, adiciona Bearer, nunca importa DataStore/SyncManager/Dexie e mapeia status em `CollectionsError(code,status,retryable)`.

`createSingleCurationOperation` rejeita offline hint antes do fetch, body cardinalidade um e aceita somente `add|remove`. Toda chamada cross-origin ao Payload usa `credentials:'omit'`, para que a raiz nunca dependa de cookie CMS ambiente. O serviço cria um `Idempotency-Key` com `crypto.randomUUID()` para a tentativa lógica `{collectionId,curationId,action,draftRevision}` e o preserva no estado pending até obter resposta terminal ou o usuário abandonar; retry de rede incerto reutiliza essa key. Cada request HTTP recebe `X-Request-Id` novo. A injeção `uuid` dos testes fornece UUIDs fixos; caller externo não injeta strings arbitrárias. Após 202, `getOperation` faz polling com backoff 500ms→5s e timeout visual 60s; timeout não cancela job nem marca sucesso.

Inicializar em `main.js` após `ApiService.initialize()` e expor instância como `window.CollectionsService`; adicionar global ao ESLint.

- [ ] **Step 4: Rodar service tests e regressão offline**

Run:

```bash
npx vitest run tests/test_collectionsService.test.js tests/test_apiService_params.test.js tests/test_auth_offline.test.js
npm run lint:collector
```

Expected: PASS; mocks Dexie/SyncManager permanecem sem chamadas; 401/403/409/412/423/503/network têm codes distintos.

- [ ] **Step 5: Commit**

```bash
git add scripts/services/collectionsService.js scripts/services/apiService.js scripts/core/config.js scripts/core/main.js eslint.config.mjs tests
git commit -m "feat(collector): adicionar CollectionsService online-only"
```

---

### Task 3: Implementar modal acessível e estados de operação

**Files:**
- Create: `scripts/ui/collectionsModal.js`
- Modify: `styles/components.css`
- Create: `styles/tokens.generated.css` (via geração determinística)
- Modify: `index.html`
- Modify: `scripts/auth/curatorProfile.js`
- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/src/tokens.css`
- Create: `packages/design-tokens/src/tokens.ts`
- Create: `packages/design-tokens/src/index.ts`
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/src/styles/admin.css`
- Create: `scripts/build-collector.mjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/test_collectionsModal.test.js`
- Test: `tests/test_curatorProfile_role.test.js`
- Test: `tests/test_design_tokens.test.js`

**Interfaces:**
- Consumes: `window.modalManager.open`, `CollectionsService`, `AuthService.getCurrentUser()`.
- Produces: `CollectionsModal.open(curation)`, `refresh`, `submitDraftChange`, `renderState`; `window.CollectionsModal` instance.
- `@concierge/design-tokens` tem dois consumidores reais: `apps/admin` e o build determinístico de CSS do Collector.

- [ ] **Step 1: Escrever matriz visual de roles/erros**

```javascript
test.each([
  ['viewer', false], ['curator', false], ['admin', true]
])('%s vê publicado; somente admin vê draft controls', async (role, hasControls) => {
  auth.getCurrentUser.mockReturnValue({ role, authorized: true })
  await modal.open({ curation_id: 'c1', restaurant_name: 'Place' })
  expect(screen.getByText('Published Collection')).toBeTruthy()
  expect(Boolean(document.querySelector('[data-draft-action]'))).toBe(hasControls)
})

test.each([
  ['offline', 'You are offline'], ['unauthorized', 'Sign in again'],
  ['forbidden', 'Admin access required'], ['conflict', 'Draft changed'],
  ['locked', 'Publication in progress'], ['unavailable', 'Service unavailable'],
])('%s tem mensagem e retry corretos', async (code, message) => {
  const curation = { curation_id: 'c1', restaurant_name: 'Place' }
  service.getPublishedAssociations.mockRejectedValue(new CollectionsError(code))
  await modal.open(curation)
  expect(screen.getByText(message)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})
```

- [ ] **Step 2: Rodar e confirmar componente ausente**

Run: `npx vitest run tests/test_collectionsModal.test.js`

Expected: FAIL.

- [ ] **Step 3: Implementar modal com DOM seguro e tokens gerados**

Construir `HTMLElement` content/footer sem inserir strings do servidor em HTML. `open` chama published para todos; se role client-side é admin, também chama options, mas qualquer 403 remove controls. Cada row publicada mostra title/slug/version e link Admin allowlisted. Admin pesquisa outras Collections cursor-paginadas, vê desired state/locked e botões Add/Remove.

```javascript
async open(curation) {
  const modalId = window.modalManager.open({
    title: 'Collections', content: this.createContent(), size: 'md',
    onClose: () => this.abortPolling(),
  })
  const user = this.authService.getCurrentUser?.()
  this.renderPublished(await this.service.getPublishedAssociations(curation.curation_id))
  if (user?.role === 'admin') this.renderDraftOptions(await this.service.getDraftOptions(curation.curation_id))
  return modalId
}

renderTextRow(row, value) {
  const title = document.createElement('span')
  title.textContent = value.title // never innerHTML for server fields
  row.append(title)
}
```

Ao submeter: desabilitar somente row, `aria-live='polite'` anuncia queued/progress/result; esperar operation terminal e então refazer ambos reads. Só `completed` com efeito confirmado anuncia sucesso; `completed_with_skips` mostra o reason (por exemplo, Curation já archived) e não afirma que o draft mudou. Conflict refaz options; 423 mostra job; network mantém retry. `modalManager` fornece focus trap/Escape/restoration; controles usam 40px mínimo e `:focus-visible`.

```javascript
async submitDraftChange(input) {
  this.setRowBusy(input.collectionId, true)
  try {
    const operation = await this.service.createSingleCurationOperation(input)
    const terminal = await this.service.waitForTerminalOperation(operation.operationId)
    await this.refresh(input.curationId) // server state first; no optimistic membership
    if (terminal.status === 'completed') this.announce('Collection draft updated')
    else this.renderTerminalResult(terminal) // skips/failure/cancel never masquerade as success
  } catch (error) {
    this.renderCollectionsError(error)
  } finally {
    this.setRowBusy(input.collectionId, false)
  }
}
```

Em `CuratorProfile.initialize`, preservar somente o role derivado do servidor no objeto de apresentação: `role: user.role`. Não adicionar/persistir `isAdmin`/`canManageCollections`; o modal relê `AuthService.getCurrentUser().role` em cada open. `test_curatorProfile_role.test.js` prova admin/curator/viewer e que reload offline não transforma role cached em autorização de mutação.

Criar `@concierge/design-tokens` com exports `./css -> src/tokens.css` e `./tokens -> src/tokens.ts`; `tokens.ts` expõe o mesmo mapa limestone/olive tipado. `apps/admin/src/styles/admin.css` importa `@concierge/design-tokens/css`, tornando o Admin o primeiro consumidor. `scripts/build-collector.mjs --tokens-only` lê `tokens.css`, aplica banner fixo sem timestamp e gera `styles/tokens.generated.css`; `index.html` carrega esse arquivo imediatamente antes de `styles/components.css`, tornando o Collector o segundo consumidor. `styles/components.css` usa as variáveis geradas para o modal/botão sem mudar estilos legados fora de escopo.

Os scripts root `generate:collector-tokens` e `check:collector-tokens` geram/comparam bytes; o teste altera uma cópia temporária do source e prova que o check detecta drift. O build completo copia `styles/tokens.generated.css` para `dist/collector/styles/` junto da allowlist da fase 07. `build:collector:check` compara dois diretórios temporários gerados byte a byte, sem depender de `dist/` commitado.

- [ ] **Step 4: Rodar modal, XSS e a11y unit**

Run:

```bash
npx vitest run tests/test_collectionsModal.test.js tests/test_cardFactory_xss.test.js
npx vitest run tests/test_curatorProfile_role.test.js tests/test_design_tokens.test.js
npm run check:collector-tokens
npm run build:collector:check
npm run lint:collector
```

Expected: PASS; payload `<img onerror>` aparece como texto; `aria-live`, labels, focus e retry funcionam.

- [ ] **Step 5: Commit**

```bash
git add index.html scripts/ui/collectionsModal.js scripts/auth/curatorProfile.js styles/components.css styles/tokens.generated.css packages/design-tokens apps/admin/package.json apps/admin/src/styles/admin.css scripts/build-collector.mjs package.json package-lock.json tests/test_collectionsModal.test.js tests/test_curatorProfile_role.test.js tests/test_design_tokens.test.js
git commit -m "feat(collector): criar modal de Collections"
```

---

### Task 4: Adicionar botão a todos os cards e validar E2E

**Files:**
- Modify: `scripts/ui/cardFactory.js`
- Modify: `scripts/ui-core/uiManager.js`
- Modify: `scripts/core/main.js`
- Modify: `index.html`
- Modify: `tests/test_reviewCard.test.js`
- Create: `tests/test_cardFactory_collections.test.js`
- Create: `apps/admin/tests/e2e/collector-modal/collections.spec.ts`

**Interfaces:**
- Consumes: `window.CollectionsModal.open(curation)` e feature flag.
- Produces: botão visível `.btn-curation-collections` em linked/orphan cards; tag script cache-busted.

- [ ] **Step 1: Escrever testes de presença, propagação e paridade**

```javascript
test('linked card tem um botão Collections que não abre o card', () => {
  const onCardClick = vi.fn()
  const open = vi.fn()
  window.CollectionsModal = { open }
  const card = factory.createCurationCard(entity, curation, { onClick: onCardClick })
  card.querySelector('.btn-curation-collections').click()
  expect(open).toHaveBeenCalledWith(curation)
  expect(onCardClick).not.toHaveBeenCalled()
  expect(card.querySelectorAll('.btn-curation-collections')).toHaveLength(1)
})

test('orphan review card usa a mesma ação', () => {
  const card = ui.createReviewCard(curation)
  expect(card.querySelector('.btn-curation-collections')).toBeTruthy()
})
```

- [ ] **Step 2: Rodar e confirmar botões ausentes**

Run: `npx vitest run tests/test_cardFactory_collections.test.js tests/test_reviewCard.test.js`

Expected: FAIL; teste antigo ainda espera três ações.

- [ ] **Step 3: Adicionar botão/listeners/load order**

Nos dois action rows, entre Edit e overflow:

```html
<button type="button" class="btn-curation-collections"
        title="Collections" aria-label="Collections for this curation">
  <span aria-hidden="true">Collections</span>
</button>
```

Listener faz `event.preventDefault(); event.stopPropagation(); window.CollectionsModal.open(curation)`. Renderizar somente quando `AppConfig.app.features.collectionsModal` é true. Atualizar teste de review card para quatro ações. O `index.html` fonte já carrega `styles/tokens.generated.css` antes de `styles/components.css`; `scripts/build-collector.mjs` preserva essa ordem na cópia de `dist/collector`. Carregar `collectionsService.js` após `apiService.js` e `collectionsModal.js` após `modalManager.js`, ambos antes de `cardFactory.js`, com cache-bust versionado fixo (nunca timestamp de build). `main.js` injeta a instância uma vez.

- [ ] **Step 4: Rodar suíte Collector e E2E integrado**

Run:

```bash
npm run lint:collector
npm run build:collector:check
npm run test:collector
npm run test:coverage
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/collector-modal/collections.spec.ts
```

Expected: PASS; E2E prova viewer view-only, admin add/remove, status terminal/refetch, offline disabled e nenhum request Dexie/sync.

- [ ] **Step 5: Commit**

```bash
git add index.html scripts styles tests apps/admin/tests/e2e/collector-modal
git commit -m "feat(collector): adicionar Collections em cada Curation card"
```

## Gate da fase

```bash
npm run lint:collector
npm run test:collector
npm run test:coverage
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/collector-modal
cd concierge-api-v3
venv/bin/pytest tests/test_catalog_associations.py tests/test_cms_bearer_introspection.py -v
```

Expected: exit 0; busca no diff confirma zero alteração em schema Dexie/DataStore/SyncManager e zero chamada à fila offline.
