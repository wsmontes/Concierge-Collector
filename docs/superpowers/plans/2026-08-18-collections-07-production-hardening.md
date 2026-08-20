# Hardening, Deploy e Rollout de Collections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar Collections operável em produção com correlação, métricas/alertas, retenção, recovery, quality gate, imagens imutáveis, Render Blueprint e rollout reversível.

**Architecture:** Web/API/worker propagam request e job IDs, expõem health/metrics e reconciliam leases/staging. CI constrói imagens linux/amd64 por SHA, staging valida o mesmo digest e promoção apenas retagua/dispara esse digest; `render.yaml` descreve quatro deployables e migrations CMS rodam uma vez sob lock.

**Tech Stack:** Python logging + prometheus-client, Payload/Pino + prom-client, MongoDB/Atlas, GitHub Actions ou executor equivalente, Docker BuildKit/GHCR, Render Blueprint/image runtime, Playwright, scripts de carga/caos/backup.

**Spec:** `docs/superpowers/specs/2026-08-18-collections-payload-cms-design.md`

## Global Constraints

- Logs nunca contêm Bearer, secret, transcript, private notes, sources, embeddings, prompt/resposta IA ou dump payload.
- `X-Request-Id` aceito somente em formato seguro; ausente/inválido gera UUID; sempre volta na response.
- Métricas usam IDs/estados/counts, nunca `curation_id` como label de alta cardinalidade.
- Selection não usada expira; versões/membership de produto não têm TTL.
- Staging órfão só é removido após provar que não existe job retomável.
- Backup/restore do CMS é ensaiado em ambiente isolado antes da produção.
- Migrations expand/contract, idempotentes, forward-only e sob lock; web/worker não migram no boot.
- Render Blueprint é validado em staging e associado conscientemente aos serviços; nenhum domínio/ID existente é recriado implicitamente.
- Imagem promovida é o mesmo digest validado em staging; rollback aponta digest anterior disponível.
- Flags têm owner, ambiente, data de remoção e enforcement server-side.
- Produção só habilita após evidência dos vinte critérios de aceite da spec.

---

### Task 1: Propagar correlação e expor métricas seguras

**Files:**
- Create: `concierge-api-v3/app/core/observability.py`
- Create: `concierge-api-v3/app/api/metrics.py`
- Modify: `concierge-api-v3/main.py`
- Modify: `concierge-api-v3/app/core/config.py`
- Modify: `concierge-api-v3/requirements.txt`
- Create: `concierge-api-v3/tests/test_observability.py`
- Create: `apps/admin/src/observability/request-context.ts`
- Create: `apps/admin/src/observability/metrics.ts`
- Create: `apps/admin/app/metrics/route.ts`
- Create: `apps/admin/app/ready/route.ts`
- Modify: `apps/admin/package.json`
- Modify: `package-lock.json`
- Test: `apps/admin/tests/unit/observability/request-context.test.ts`
- Test: `apps/admin/tests/unit/observability/metrics-route.test.ts`
- Test: `apps/admin/tests/integration/payload/ready-route.int.test.ts`
- Create: `docs/observability/collections.md`

**Interfaces:**
- Produces: `request_id` context; response `X-Request-Id`; `/api/v3/metrics`, `/metrics`; `GET /ready`; counters/gauges/histograms da spec.

- [ ] **Step 1: Escrever testes de correlação/redaction/cardinality**

```python
def test_request_id_is_propagated_and_secret_is_redacted(client, caplog):
    response = client.get('/api/v3/health', headers={
        'X-Request-Id': 'req-123', 'Authorization': 'Bearer SENTINEL_SECRET',
    })
    assert response.headers['x-request-id'] == 'req-123'
    assert 'SENTINEL_SECRET' not in caplog.text
    assert 'request_id=req-123' in caplog.text

def test_invalid_request_id_is_replaced(client):
    response = client.get('/api/v3/health', headers={'X-Request-Id': '<script>'})
    assert response.headers['x-request-id'] != '<script>'

def test_metrics_rejects_api_or_jwt_secret_when_metrics_key_differs(client, monkeypatch):
    monkeypatch.setattr(settings, 'metrics_key', 'metrics-only-secret')
    assert client.get('/api/v3/metrics', headers={'X-Metrics-Key': settings.api_secret_key}).status_code == 401
    assert client.get('/api/v3/metrics', headers={'X-Metrics-Key': 'metrics-only-secret'}).status_code == 200
```

- [ ] **Step 2: Instalar libs e confirmar teste vermelho**

Adicionar `prometheus-client==0.22.1` a requirements e rodar:

```bash
cd concierge-api-v3 && venv/bin/pip install -r requirements.txt
venv/bin/pytest tests/test_observability.py -v
```

Expected: FAIL porque middleware/context não existem.

- [ ] **Step 3: Implementar middleware, métricas e documentação**

`METRICS_KEY` é segredo independente de `API_SECRET_KEY`, `JWT_SIGNING_SECRET`, chaves CMS e credentials de consumer. Em produção `Settings.metrics_key` falha fechado quando ausente; `/api/v3/metrics` exige comparação constant-time do header `X-Metrics-Key` e nunca aceita Bearer como substituto.

```python
# concierge-api-v3/app/core/observability.py
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
request_id_var: ContextVar[str] = ContextVar("request_id", default="")

async def request_context_middleware(request: Request, call_next):
    candidate = request.headers.get("X-Request-Id", "")
    request_id = candidate if REQUEST_ID_RE.fullmatch(candidate) else str(uuid.uuid4())
    token = request_id_var.set(request_id)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["X-Request-Id"] = request_id
    return response

def metrics_authorized(request: Request) -> None:
    if not secrets.compare_digest(request.headers.get("X-Metrics-Key", ""), settings.metrics_key):
        raise HTTPException(status_code=401, detail="Metrics authorization required")
```

Registrar o middleware antes dos routers em `main.py`; o logging filter lê apenas `request_id_var` e redige `authorization`, `cookie`, `x-metrics-key`, secrets e bodies. A autenticação por `METRICS_KEY` vale em test/dev/staging/produção (fixtures usam somente chave de teste), evitando que uma mudança de environment exponha métricas. Métricas expõem HTTP rate/duration/status, Mongo duration, distribution counts/reasons e credential auth/rate-limit; nenhum label contém email, Curation ID, token ou URL crua.

```ts
// apps/admin/src/observability/request-context.ts
export const requestContext = new AsyncLocalStorage<RequestContext>()
export function withRequestContext<T>(input: RequestContext, fn: () => Promise<T>) {
  return requestContext.run({ requestId: input.requestId, actorId: input.actorId,
    selectionId: input.selectionId, operationId: input.operationId,
    collectionId: input.collectionId, publishJobId: input.publishJobId }, fn)
}
```

Admin usa `prom-client@15.1.3`; instrumenta queue depth/oldest age, job states/duration/retries/skips, leases, diff/export bytes e selected/available/unavailable. `GET /metrics` chama `authorizeMetrics(request.headers, env.METRICS_KEY)` com comparação constante em todo ambiente; nunca aceita cookie CMS, Bearer ou `CMS_SERVICE_KEY`. `metrics-route.test.ts` prova 401 sem/chave errada e 200 somente com a chave exclusiva. `GET /health` continua liveness sem DB; o novo `GET /ready` faz ping CMS + verifica migrations/index version e retorna 503 quando não pronto, sem executar migration. Payload logger recebe campos estruturados allowlisted, nunca body/headers crus. `docs/observability/collections.md` define nomes, labels permitidos, dashboards e alerts: worker ausente com backlog, oldest job, 5xx/retries/publish conflicts, dependência unavailable, resultado sem artifact e unavailable crescente.

- [ ] **Step 4: Rodar testes e inspecionar métricas**

Run:

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_observability.py tests/test_system.py -v
cd ..
npm install --workspace=@concierge/admin --save-exact prom-client@15.1.3
npm run test:admin -- --run tests/unit/observability
npm run test:integration --workspace=@concierge/admin -- tests/integration/payload/ready-route.int.test.ts
npm run typecheck:admin
```

Expected: PASS; nenhum label contém Curation ID/email/key; secret sentinels ausentes de logs.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3 apps/admin docs/observability package-lock.json
git commit -m "feat(ops): adicionar correlacao e metricas de Collections"
```

---

### Task 2: Implementar retention, reconciliadores e backup/restore smoke

**Files:**
- Create: `apps/admin/src/jobs/reconcileLeasesTask.ts`
- Create: `apps/admin/src/jobs/purgeExpiredArtifactsTask.ts`
- Create: `apps/admin/src/jobs/archiveAuditEventsTask.ts`
- Create: `apps/admin/src/migrations/20260818_004_retention.ts`
- Modify: `apps/admin/payload.config.ts`
- Create: `apps/admin/tests/integration/worker/reconciliation.int.test.ts`
- Create: `apps/admin/tests/support/cms-fixtures.ts`
- Create: `scripts/operations/cms-backup-restore-smoke.sh`
- Create: `docs/runbooks/cms-backup-restore.md`

**Interfaces:**
- Produces: scheduled tasks `reconcile-leases`, `purge-expired-artifacts`, `archive-audit-events`; retention envs versionadas; smoke isolado `mongodump`→`mongorestore`→invariant check.

- [ ] **Step 1: Escrever teste de takeover e purge conservador**

```typescript
test('reconciler retoma lease expirada e preserva staging de job retomável', async () => {
  const operation = await seedExpiredOperation({ resumable: true, stagedItems: 3 })
  await reconcileLeasesTask.run({ now: fixedNow })
  expect((await loadOperation(operation.id)).status).toBe('queued')
  expect(await countStagedItems(operation.id)).toBe(3)
})

test('só remove staging sem job e além da retenção', async () => {
  await seedOrphanStage({ ageDays: 31 })
  await seedOrphanStage({ ageDays: 1 })
  await reconcileLeasesTask.run({ now: fixedNow })
  expect(await orphanAges()).toEqual([1])
})
```

- [ ] **Step 2: Rodar e confirmar tasks ausentes**

Run: `npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/reconciliation.int.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar políticas e smoke fail-safe**

Defaults versionados: `CMS_LOGIN_STATE_TTL_MINUTES=10`, `CMS_SESSION_TTL_HOURS=8`, `CMS_UNUSED_SELECTION_TTL_HOURS=24`, `CMS_HEARTBEAT_TTL_DAYS=7`, `CMS_EXPORT_TTL_DAYS=7`, `CMS_OPERATION_ITEM_RETENTION_DAYS=90`, `CMS_ORPHAN_STAGING_RETENTION_DAYS=30`, `CMS_AUDIT_RETENTION_DAYS=365`. Staging pode reduzir esses períodos; produção só pode aumentá-los com aprovação de compliance versionada, nunca encurtá-los silenciosamente. Collections, published versions, application/credential records, membership intervals e o summary operacional `consumer_credential_usage` não têm TTL.

```ts
// apps/admin/src/jobs/purgeExpiredArtifactsTask.ts
export async function purgeExpiredArtifactsTask(now = new Date()) {
  await deleteExpiredUnusedManifests(now)
  await archiveThenDeleteExpiredExports({ olderThanDays: env.CMS_EXPORT_TTL_DAYS, now })
  await compactTerminalOperationItemsToAuthorizedArtifact({
    olderThanDays: env.CMS_OPERATION_ITEM_RETENTION_DAYS, now,
  })
  const candidates = await findOrphanStagesOlderThan(env.CMS_ORPHAN_STAGING_RETENTION_DAYS, now)
  for (const stage of candidates) {
    if (!(await hasResumableJobOrPromotion(stage.operationId))) await deleteStage(stage.id)
  }
}
```

Migration cria TTL somente para login states, CMS sessions, manifests não usados e heartbeat. Quota windows operacionais mantêm o TTL de 10 minutos da fase 05; o usage summary não expira. Exports são apagados do bucket e marcados purged no CMS somente depois de 7 dias e confirmação do `DeleteObject`. Operation items terminais são compactados depois de 90 dias num artifact autorizado com count/reasons/SHA e só então removidos. Audit com mais de 365 dias é exportado em NDJSON gzip privado, recebe manifest com count/SHA e um evento `audit.archive.completed`; só então o batch fonte é purgado. Registros de produto nunca entram nesses batches.

Scheduled tasks na queue `maintenance` adquirem lock/fence, encontram leases expiradas, provam que nenhuma promoção está rodando e reenfileiram o mesmo job/checkpoint. `apps/admin/tests/support/cms-fixtures.ts` exporta exatamente `fixedNow = new Date('2026-08-18T12:00:00Z')`, `seedExpiredOperation({resumable,stagedItems})`, `seedOrphanStage({ageDays})`, `loadOperation(id)`, `countStagedItems(id)`, `orphanAges()` e `assertNoProductTtlIndexes()`; cada helper usa IDs prefixados e cleanup no CMS de teste.

```ts
// apps/admin/src/jobs/reconcileLeasesTask.ts
export async function reconcileLeasesTask(now = new Date()) {
  for await (const op of expiredLeases(now)) {
    if (await hasCommittedPromotion(op.collectionId, op.targetDraftRevision)) continue
    if (await acquireFencedLease(op.id, now)) await enqueueResume(op.id, op.checkpoint)
  }
}
```

`cms-backup-restore-smoke.sh` exige `CMS_BACKUP_SOURCE_URL`, `CMS_RESTORE_TEST_URL` e `CMS_RESTORE_TEST_DB` terminado em `-restore-test`; permite o mesmo cluster de teste, mas recusa o mesmo namespace de banco source/destination e qualquer target contendo `production`. URLs nunca são ecoadas. Executa `mongodump --archive --gzip`, usa `mongorestore --drop` somente no DB de teste validado, chama checker read-only de counts/hashes/versions e remove o archive temporário por trap.

Before production, the staging benchmark records Atlas CMS storage bytes, quota bytes and quota percent before/after a representative peak selection/export; estimates 30-day growth for manifests, operation items, audit and exports; and fails the promotion evidence if projected use exceeds 80% of quota or the storage alert does not fire in staging.

- [ ] **Step 4: Rodar reconciliação e smoke em DB isolado**

Run:

```bash
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/reconciliation.int.test.ts
CMS_BACKUP_SOURCE_URL="$CMS_TEST_URL" CMS_RESTORE_TEST_URL="$CMS_TEST_URL" CMS_RESTORE_TEST_DB=concierge-cms-restore-test bash scripts/operations/cms-backup-restore-smoke.sh
```

Expected: PASS; hashes/versions/counts idênticos; banco fonte nunca recebe drop/write.

- [ ] **Step 5: Commit**

```bash
git add apps/admin scripts/operations docs/runbooks/cms-backup-restore.md
git commit -m "feat(ops): adicionar retention recovery e restore smoke"
```

---

### Task 3: Automatizar quality gate e imagens imutáveis

**Files:**
- Create: `.github/workflows/quality.yml`
- Create: `.github/workflows/build-images.yml`
- Create: `Dockerfile.admin`
- Create: `Dockerfile.api`
- Create: `.dockerignore`
- Create: `concierge-api-v3/requirements-dev.txt`
- Create: `scripts/quality/check-generated.mjs`
- Modify: `scripts/build-collector.mjs`
- Modify: `package.json`
- Test: `tests/test_quality_workflows.test.js`

**Interfaces:**
- Produces: check agregador `quality`; imagens `ghcr.io/wsmontes/concierge-admin:<sha>` e `concierge-api:<sha>` linux/amd64; artifacts/SBOM por SHA.

- [ ] **Step 1: Escrever teste estrutural dos workflows**

```javascript
test('quality sempre agrega Collector, Admin, API e generated contracts', () => {
  const yaml = readFileSync('.github/workflows/quality.yml', 'utf8')
  for (const job of ['collector:', 'admin:', 'api:', 'generated:', 'quality:']) {
    expect(yaml).toContain(job)
  }
  expect(yaml).toContain('if: always()')
  expect(yaml).toContain('npm run check:contracts')
})

test('images são tagueadas pelo commit SHA, nunca latest', () => {
  const yaml = readFileSync('.github/workflows/build-images.yml', 'utf8')
  expect(yaml).toContain('${{ github.sha }}')
  expect(yaml).not.toContain(':latest')
})
```

- [ ] **Step 2: Rodar e confirmar workflows ausentes**

Run: `npx vitest run tests/test_quality_workflows.test.js`

Expected: FAIL por arquivos ausentes.

- [ ] **Step 3: Criar gates e Dockerfiles reprodutíveis**

```json
// package.json (scripts relevantes)
{
  "scripts": {
    "build:collector": "node scripts/build-collector.mjs",
    "build:collector:check": "node scripts/build-collector.mjs --check",
    "lint:collector": "eslint scripts/ tests/ eslint.config.mjs",
    "test:collector": "vitest run"
  },
  "packageManager": "npm@10.9.2"
}
```

```js
// scripts/build-collector.mjs
const allowlist = ['index.html', 'styles/**', 'scripts/**', 'images/**', 'manifest.json', 'favicon.ico']
await generateCollectorTokens() // packages/design-tokens/src/tokens.css -> styles/tokens.generated.css
await copyAllowlistedSorted({ allowlist, destination: outputDir, normalizeLineEndings: true })
await assertHtmlReferencesStayInside(outputDir)
if (argv.includes('--check')) await buildTwiceAndCompareTemporaryDirectories()
```

O script usa traversal ordenado, banner fixo e line endings normalizados; não copia `node_modules`, `.git`, envs, backend, docs, tests, source maps ou timestamps. `--check` constrói duas vezes em diretórios temporários e compara manifest `{path,sha256,size}` byte a byte; `dist/` não é versionado. O `index.html` de output só referencia assets locais contidos na allowlist, incluindo `styles/tokens.generated.css`. CI constrói esse diretório e Render serve exclusivamente `dist/collector`.

`quality.yml` always executes:

- Collector: Node 22 com npm 10.9.2 instalado explicitamente, `npm ci`, `npm run build:collector:check`, lint/test/coverage.
- Admin: unit/integration/typecheck/build com CMS test service.
- API: Python pin do Render, `pytest -m not...`, `black --check`, `flake8`.
- Generated: OpenAPI/JSON Schema/client `--check` e `git diff --exit-code`.
- `quality` usa `if: always()`, depende dos quatro e falha se qualquer result não for success; docs-only também termina explicitamente.

```yaml
# .github/workflows/quality.yml (trecho normativo)
- uses: actions/setup-node@v4
  with: { node-version: '22.14.0', cache: npm }
- run: npm install --global npm@10.9.2 && test "$(npm --version)" = "10.9.2"
- run: npm ci && npm run build:collector:check && npm run lint:collector && npm run test:collector && npm run test:coverage
```

`build-images.yml` runs only after `quality`, builds `Dockerfile.api` and `Dockerfile.admin` for linux/amd64, attaches OCI `revision=$GITHUB_SHA`, produces SBOM/provenance and publishes immutable SHA tags. Worker uses the same Admin image with a different command. `requirements-dev.txt`: `black==24.10.0`, `flake8==7.1.1`. Because GitHub Actions is currently disabled for billing, the workflow commands above are the documented, mandatory local-equivalent gate until Actions or an equivalent executor is restored; a production rollout cannot substitute a skipped workflow for those command outputs.

- [ ] **Step 4: Executar gate local e builds**

Run:

```bash
npm ci
npm run build:collector:check
npm run lint:collector
npm run test:collector
npm run test:coverage
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
npm run check:contracts
cd concierge-api-v3
venv/bin/pip install -r requirements-dev.txt
venv/bin/pytest -m "not integration and not external_api and not mongo and not openai" -q
venv/bin/black --check app tests
venv/bin/flake8 app tests --max-line-length=120 --ignore=E203,W503
cd ..
docker buildx build --platform linux/amd64 -f Dockerfile.api --load -t concierge-api:test .
docker buildx build --platform linux/amd64 -f Dockerfile.admin --load -t concierge-admin:test .
```

Expected: exit 0; image Admin inicia tanto web quanto `payload jobs:run`; OCI revision presente.

- [ ] **Step 5: Commit**

```bash
git add .github Dockerfile.admin Dockerfile.api .dockerignore concierge-api-v3/requirements-dev.txt scripts/quality scripts/build-collector.mjs package.json package-lock.json tests/test_quality_workflows.test.js
git commit -m "ci: automatizar quality gate e imagens imutaveis"
```

---

### Task 4: Versionar quatro deployables no Render Blueprint

**Files:**
- Create: `render.yaml`
- Create: `scripts/release/materialize-render-blueprint.mjs`
- Create: `scripts/release/promote-render-images.mjs`
- Create: `scripts/release/validate-render-inventory.mjs`
- Create: `docs/runbooks/render-blueprint-adoption.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/RENDER_DEPLOYMENT_MANAGER_GUIDE.md`
- Test: `tests/test_render_blueprint.test.js`

**Interfaces:**
- Produces: static Collector, image FastAPI, image Payload web, same-image Payload worker; deploy by immutable digest via hooks; one CMS pre-deploy migration lock.

- [ ] **Step 1: Escrever teste dos quatro serviços e separação de comandos**

```javascript
test('Blueprint tem quatro deployables e web/worker compartilham imagem', () => {
  const blueprint = parse(readFileSync('render.yaml', 'utf8'))
  expect(blueprint.services).toHaveLength(4)
  const admin = blueprint.services.find((s) => s.name === 'Concierge-Collector-Admin')
  const worker = blueprint.services.find((s) => s.name === 'Concierge-Collector-Admin-Worker')
  expect(blueprint.services.some((s) => s.name === 'Concierge-Collector-API-V3')).toBe(true)
  expect(admin.image.url).toBe(worker.image.url)
  expect(admin.dockerCommand).toContain('start:admin')
  expect(worker.dockerCommand).toContain('start:admin-worker')
  expect(worker.healthCheckPath).toBeUndefined()
  expect(admin.preDeployCommand).toContain('migrate:cms:locked')
  expect(admin.healthCheckPath).toBe('/ready')
  expect(blueprint.services.find((s) => s.name === 'Concierge-Collector-Web').staticPublishPath).toBe('dist/collector')
})
```

- [ ] **Step 2: Rodar e confirmar Blueprint ausente**

Run: `npx vitest run tests/test_render_blueprint.test.js`

Expected: FAIL.

- [ ] **Step 3: Inventariar sem mutar e criar Blueprint alvo**

Usar “Generate Blueprint from existing services” no Render e salvar saída temporária fora do repo. `validate-render-inventory.mjs` is read-only and must require the current production inventory before it permits blueprint adoption: API `srv-d4fngpjuibrs73bo70vg`, name `Concierge-Collector`, type `web_service`, root `concierge-api-v3`; Collector `srv-d4fnrlje5dus7397lii0`, name `Concierge-Collector-Web`, type `static_site`, root `/`. It aborts on a renamed/recreated existing service, a missing existing domain, a changed service ID, or an unapproved runtime conversion; it emits the reviewed inventory JSON in the adoption evidence.

`render.yaml` steady-state:

```yaml
services:
  - type: web
    runtime: static
    name: Concierge-Collector-Web
    buildCommand: corepack enable && corepack prepare npm@10.9.2 --activate && npm ci && npm run build:collector
    staticPublishPath: dist/collector
    domains: [concierge-collector.com, www.concierge-collector.com]
    autoDeployTrigger: checksPass
  - type: web
    runtime: image
    name: Concierge-Collector-API-V3
    dockerCommand: uvicorn main:app --host 0.0.0.0 --port $PORT
    healthCheckPath: /api/v3/ready
    domains: [api.concierge-collector.com, capture.concierge-collector.com]
    maxShutdownDelaySeconds: 60
  - type: web
    runtime: image
    name: Concierge-Collector-Admin
    dockerCommand: npm run start:admin -- --port $PORT
    preDeployCommand: npm run migrate:cms:locked --workspace=@concierge/admin
    healthCheckPath: /ready
    domains: [admin.concierge-collector.com]
    maxShutdownDelaySeconds: 60
  - type: worker
    runtime: image
    name: Concierge-Collector-Admin-Worker
    dockerCommand: npm run start:admin-worker
    maxShutdownDelaySeconds: 300
```

O trecho mostra a topologia e omite apenas `image.url` porque o digest ainda não existe na fase de planejamento. Na execução, `materialize-render-blueprint.mjs` constrói o documento completo, recebe os dois digests aprovados pela evidência, valida `sha256:[a-f0-9]{64}` e grava URLs literais por digest em `render.yaml` antes do primeiro `render blueprints validate`; não existe template incompleto versionado. O teste recusa interpolação `${...}`, tags e URL sem digest. Cada promoção posterior atualiza Render diretamente por digest e abre commit/PR separado para reconciliar o Blueprint com o estado promovido.

Segredos no Blueprint aparecem apenas pelo nome com `sync:false`: URLs/credentials Mongo, signing/admin/service/metrics/cursor keys, S3 credentials e registry auth. Config não secreta fica versionada com `value`: `ENVIRONMENT=production`, DB lógico `concierge-cms`, URLs públicas/internas, origins/callback exatos, TTLs e todas as flags inicialmente `false`. API inclui `CMS_MONGODB_READ_URL`, `CMS_SERVICE_KEY`, `METRICS_KEY`, cursor keys e `AUDIT_S3_*`; Admin/worker incluem URLs Mongo próprias, `PAYLOAD_SECRET`, `FASTAPI_BASE_URL`, `CMS_SERVICE_KEY`, `METRICS_KEY`, origins, S3/export vars e flags. Web e worker recebem values secretos distintos de `CMS_MONGODB_URL` (`payload-web` versus `payload-worker`) embora o env tenha o mesmo nome. Build filters não carregam valores secretos.

Como o runtime Render é imutável, o API Python atual não é convertido in-place: criar o canary image-backed estável `Concierge-Collector-API-V3`, validá-lo, mover `api.concierge-collector.com`/`capture.concierge-collector.com` e manter o serviço antigo `Concierge-Collector` sem esses domains para rollback até o aceite. O runbook registra IDs/ordem e não apaga serviço nessa mudança.

```js
// scripts/release/promote-render-images.mjs
assertDigest(apiDigest); assertDigest(adminDigest)
await assertImageProvenanceAndQuality({ apiDigest, adminDigest })
if (environment === 'production') {
  await assertAcceptanceEvidence('docs/evidence/collections-staging.json', { apiDigest, adminDigest })
}
await updateRenderImage('Concierge-Collector-API-V3', `ghcr.io/wsmontes/concierge-api@${apiDigest}`)
await waitForReady('Concierge-Collector-API-V3', '/api/v3/ready')
await updateRenderImage('Concierge-Collector-Admin', `ghcr.io/wsmontes/concierge-admin@${adminDigest}`)
await updateRenderImage('Concierge-Collector-Admin-Worker', `ghcr.io/wsmontes/concierge-admin@${adminDigest}`)
await waitForWorkerBacklogHealthy('Concierge-Collector-Admin-Worker')
```

Promotion deploys immutable registry digests directly; it never retags a mutable `production-approved` tag. It stops before the next service if health/backlog fails and records the prior digest for audited rollback.

- [ ] **Step 4: Validar Blueprint e adoção em staging**

Run:

```bash
node scripts/release/validate-render-inventory.mjs --environment staging
node scripts/release/materialize-render-blueprint.mjs --api-digest "$API_DIGEST" --admin-digest "$ADMIN_DIGEST"
render blueprints validate render.yaml
npx vitest run tests/test_render_blueprint.test.js
node scripts/release/promote-render-images.mjs --environment staging --api-digest "$API_DIGEST" --admin-digest "$ADMIN_DIGEST"
```

Expected: Blueprint válido; quatro services healthy; web/worker usam mesmo Admin digest; migration lock executa uma vez; nenhuma produção é tocada.

- [ ] **Step 5: Commit**

```bash
git add render.yaml scripts/release docs tests/test_render_blueprint.test.js
git commit -m "ops: versionar Blueprint dos quatro deployables"
```

---

### Task 5: Criar flags, gates de staging, rollout e rollback auditáveis

**Files:**
- Create: `config/collections-feature-flags.json`
- Create: `concierge-api-v3/app/core/feature_flags.py`
- Create: `concierge-api-v3/app/core/authz_audit.py`
- Create: `concierge-api-v3/scripts/archive_authz_audit.py`
- Create: `apps/admin/src/feature-flags.ts`
- Create: `scripts/operations/verify-collections-acceptance.mjs`
- Create: `scripts/operations/acceptance-schema.mjs`
- Create: `apps/admin/tests/chaos/worker-checkpoints.mjs`
- Create: `tests/fixtures/complete-collections-acceptance.json`
- Create: `docs/runbooks/collections-rollout.md`
- Create: `docs/runbooks/collections-rollback.md`
- Create: `docs/benchmarks/collections-performance.json`
- Create: `docs/evidence/collections-staging.json`
- Modify: `concierge-api-v3/app/core/config.py`
- Modify: `concierge-api-v3/app/api/auth.py`
- Modify: `concierge-api-v3/app/api/cms_auth.py`
- Modify: `concierge-api-v3/app/core/index_specs.py`
- Modify: `concierge-api-v3/scripts/authorize_user.py`
- Modify: `apps/admin/src/env.ts`
- Test: `concierge-api-v3/tests/test_collection_feature_flags.py`
- Test: `concierge-api-v3/tests/test_cms_authz_audit.py`
- Test: `concierge-api-v3/tests/test_authz_audit_archive.py`
- Test: `apps/admin/tests/unit/feature-flags.test.ts`

**Interfaces:**
- Produces: flags server-side; evidence JSON machine-checkable; comandos de rollout/rollback; acceptance verifier.

- [ ] **Step 1: Escrever teste fail-closed e schema de evidência**

```python
def test_distribution_flag_is_server_enforced(monkeypatch, client, consumer_headers):
    monkeypatch.setenv('COLLECTIONS_DISTRIBUTION_ENABLED', 'false')
    response = client.get('/api/v3/distribution/collections/sushi', headers=consumer_headers)
    assert response.status_code == 503
    assert response.json()['detail']['code'] == 'feature_disabled'
```

```typescript
import { readFileSync } from 'node:fs'

test('acceptance verifier exige todos os critérios e aprovação de benchmark', () => {
  const evidence = JSON.parse(readFileSync('tests/fixtures/complete-collections-acceptance.json', 'utf8'))
  expect(validateAcceptance(evidence)).toEqual({ valid: true, missing: [] })
  delete evidence.criteria['20']
  expect(validateAcceptance(evidence).missing).toContain('criteria.20')
})
```

- [ ] **Step 2: Rodar e confirmar flags/verifier ausentes**

Run:

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_collection_feature_flags.py tests/test_cms_authz_audit.py tests/test_authz_audit_archive.py -v
cd .. && npm run test:admin -- --run tests/unit/feature-flags.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar flags e runbooks exatos**

```json
{
  "cms_auth": { "owner": "platform-api", "environments": ["staging", "production"], "default": false, "removeAfter": "2026-12-31" },
  "catalog_scan": { "owner": "cms-admin", "environments": ["staging", "production"], "default": false, "removeAfter": "2026-12-31" },
  "collections_admin": { "owner": "cms-admin", "environments": ["staging", "production"], "default": false, "removeAfter": "2026-12-31" },
  "collector_association_read": { "owner": "collector-web", "environments": ["staging", "production"], "default": false, "removeAfter": "2026-12-31" },
  "collector_draft_mutation": { "owner": "cms-admin", "environments": ["staging", "production"], "default": false, "removeAfter": "2026-12-31" },
  "consumer_credentials": { "owner": "platform-api", "environments": ["staging", "production"], "default": false, "removeAfter": "2026-12-31" },
  "collections_distribution": { "owner": "platform-api", "environments": ["staging", "production"], "default": false, "removeAfter": "2026-12-31" }
}
```

FastAPI/Payload leem overrides de environment validados e negam endpoint/job quando disabled; flag do Collector continua apenas visual. Decisões de handoff/introspection geram log estruturado redigido; **mudanças** em `users.authorized` ou `users.role` geram audit persistente append-only em `user_authz_audit_events` com actor, target, old/new, source (`authorize_user|oauth_allowlist|admin_api`), request ID e timestamp, sem token. Tanto `scripts/authorize_user.py` quanto a promoção automática por `ADMIN_EMAILS` chamam o mesmo `append_authz_change`; retry usa unique `eventKey` e não duplica evento. `test_cms_authz_audit.py` cobre ambos os writers e prova que introspection read não cria evento por request.

```python
def require_collection_flag(name: str):
    if not feature_flags.enabled(name):
        raise HTTPException(status_code=503, detail={"code": "feature_disabled", "flag": name})

def append_authz_audit(event: AuthzAuditEvent) -> None:
    db.user_authz_audit_events.update_one(
        {"eventKey": event.event_key},
        {"$setOnInsert": event.allowlisted_document()},
        upsert=True,
    )
```

Adicionar ao `INDEX_SPECS` unique `eventKey` e índice `(createdAt,_id)`, `boto3==1.43.58` ao requirements e os seis envs `AUDIT_S3_*` listados na Task 4 ao `Settings`. `archive_authz_audit.py` seleciona apenas eventos com mais de 365 dias, escreve NDJSON gzip privado em object storage com count/SHA, insere `user_authz_audit_archive_manifests`, verifica o objeto e só então apaga exatamente os `_id` incluídos; grava um evento de archive separado. O runbook agenda esse comando com service principal próprio e proíbe TTL direto nessa collection.

Rollout runbook executes in order: DB roles/secrets → migrations/indexes → Admin/worker flags off → handoff → canary admins → catalog backfill/scan → Collections → load/chaos/backup → canary publish/distribution → Collector admin → published read general → credentials gradual. Rollback disables server flags, redeploys the recorded prior digest, uses an audited operation for the published pointer and keeps migrations forward/history.

`acceptance-schema.mjs` exporta `validateAcceptance(evidence)`; o fixture completo versionado é a entrada positiva dos unit tests, não evidência real. `verify-collections-acceptance.mjs` recebe `docs/evidence/collections-staging.json` e exige criteria 1–20, artifact digests, DB/index versions, E2E/axe, backup restore, chaos, referência ao performance report separado, `approvedBy` e `approvedAt`. `docs/benchmarks/collections-performance.json` contém somente dataset/index IDs, p50/p95/p99, throughput, RSS, queue age, retries/failures e storage/quota projection. Nenhum SLO é inventado: promoção é recusada até benchmark real e evidência human-signed separados estarem completos.

- [ ] **Step 4: Executar staging completo e verificar evidência**

Run:

```bash
npm run test:e2e --workspace=@concierge/admin
node apps/admin/tests/load/explorer-selection.mjs --items 50000 --output docs/benchmarks/collections-performance.json
node apps/admin/tests/chaos/worker-checkpoints.mjs --all-checkpoints
bash scripts/operations/cms-backup-restore-smoke.sh
node scripts/operations/verify-collections-acceptance.mjs docs/evidence/collections-staging.json
```

Expected: todos exit 0; sem publish implícito em crash/concorrência; evidência contém aprovação humana antes da promoção produtiva.

- [ ] **Step 5: Commit**

```bash
git add config concierge-api-v3/app concierge-api-v3/tests apps/admin scripts/operations docs
git commit -m "ops: fechar rollout auditavel de Collections"
```

## Gate final

```bash
npm ci
npm run build:collector:check
npm run lint:collector
npm run test:collector
npm run test:coverage
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
npm run check:contracts
cd concierge-api-v3
venv/bin/pytest tests/ -v
venv/bin/black --check app tests
venv/bin/flake8 app tests --max-line-length=120 --ignore=E203,W503
cd ..
render blueprints validate render.yaml
node scripts/operations/verify-collections-acceptance.mjs docs/evidence/collections-staging.json
```

Expected: exit 0 em todos; somente então habilitar flags produtivas conforme `collections-rollout.md`.
