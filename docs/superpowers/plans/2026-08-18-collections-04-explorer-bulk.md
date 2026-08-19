# Curation Explorer e Operações em Massa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar navegação e seleção de dezenas de milhares de Curations com UX estilo Gmail, manifests server-side e operações em massa retomáveis.

**Architecture:** FastAPI atribui `catalog_sequence`, normaliza filtros e oferece search/scan autenticados. Payload materializa manifests mínimos no CMS e usa o pipeline de operações da fase 03; React virtualiza somente linhas visíveis e o browser nunca transmite o universo de IDs no modo “all matching”.

**Tech Stack:** FastAPI/PyMongo, Payload Jobs, React 19.2.6, `@tanstack/react-virtual` 3.14.9, Testing Library 16.3.2, Vitest, Playwright, S3-compatible object storage/AWS SDK 3.1103.0.

**Spec:** `docs/superpowers/specs/2026-08-18-collections-payload-cms-design.md`

## Global Constraints

- `catalog_sequence` é inteiro, server-owned, único, imutável e crescente; nunca usar `_id` misto como watermark.
- All-matching fica desabilitado até backfill concluir e índice unique existir.
- Scan fixa `max_catalog_sequence`; Curations criadas depois recebem sequence maior e ficam fora.
- Filtros mutáveis são avaliados quando cada item é visitado; sem alegar snapshot transacional.
- Manifest pronto é imutável, tem count/hash exatos e unique `(selection_id, curation_id)`.
- Virtualização mantém DOM proporcional à viewport + overscan; não à quantidade total.
- Seleção explícita também passa por manifest e canonicalização FastAPI.
- Multi-target cria parent + child por Collection; cada Collection mantém atomicidade independente.
- Exports usam DTO administrativo allowlisted e object storage; nunca filesystem efêmero.
- Viewer/curator não acessam Explorer; cada página/scan/job revalida admin.
- O worker chama cada página all-matching com `X-CMS-Service-Key` e `actor_id`; FastAPI relê esse ator e exige `authorized=true` e `role=admin` em **toda** página, não apenas no `scan/start`.
- Hashes de manifest/export são incrementais sobre cursor ordenado no banco; nenhum passo pode carregar todos os IDs em memória.

## Contratos de suporte de teste

Os helpers usados nesta fase são parte do teste, não pseudo-código implícito. Criar os arquivos abaixo antes dos testes que os consomem.

| Arquivo | Export exato | Comportamento obrigatório |
|---|---|---|
| `concierge-api-v3/tests/factories.py` | `active_curation(*, curation_id: str = 'c1', catalog_sequence: int | None = None, **overrides: Any) -> dict[str,Any]` | Estende sem quebrar a factory da fase 03; inclui sequence somente quando fornecida e aplica overrides numa cópia. |
| mesmo | `seed_curations(db: Database, rows: Sequence[tuple[int, str]]) -> None` | Insere somente os pares fornecidos com status elegível. |
| mesmo | `write_curation_through(writer: str, client: TestClient, auth_headers: dict[str,str], payload: dict[str,Any] | None = None) -> dict[str,Any]` | Chama uma das três fronteiras reais e relê o documento persistido. |
| `concierge-api-v3/tests/conftest.py` | `AuthenticatedTestClient(client: TestClient, headers: dict[str,str])` com `get`/`post` | Mescla headers de fixture e do caller; header do caller prevalece. |
| mesmo | `catalog_admin_identity(test_db) -> dict[str,str]` | Fixture cria o admin fixo e retorna actor ID/email. |
| mesmo | `admin_client(client, catalog_admin_identity) -> AuthenticatedTestClient` | Fixture injeta service key de teste + `X-CMS-Actor-Id`. |

`catalog_admin_identity` insere exatamente um `users` habilitado `{_id: 'cms-admin-test', email: 'cms-admin-test@example.com', role: 'admin', authorized: True}` e devolve `{'actor_id': 'cms-admin-test', 'email': 'cms-admin-test@example.com'}`. `admin_client` cria `AuthenticatedTestClient(client, {'X-CMS-Service-Key': settings.cms_service_key_value, 'X-CMS-Actor-Id': actor_id})`. `write_curation_through` aceita somente `writer in {'create', 'bulk', 'capture'}`, gera IDs com prefixo `test_catalog_`, envia o payload do endpoint real e devolve o documento persistido. O `active_curation` criado na fase 03 passa a aceitar `catalog_sequence`; `seed_curations` insere exatamente os rows pedidos. `AuthenticatedTestClient` combina seus headers administrativos sem sobrescrever headers fornecidos pelo teste.

| Arquivo | Exports exatos |
|---|---|
| `apps/admin/tests/support/factories.ts` | `makeRows(count: number): AdminCurationRow[]`; `page(ids: string[], nextCursor: string \\| null): CatalogScanPage`; `lease(overrides?: Partial<JobLease>): JobLease`. |
| `apps/admin/tests/support/selection-harness.ts` | `createSelectionHarness(): Promise<SelectionHarness>`; `createAllMatchingSelection(input: CreateSelectionCommand): Promise<SelectionManifestRecord>`; `manifestIds(selectionId: string): Promise<string[]>`; `loadSelection(selectionId: string): Promise<SelectionManifestRecord>`; `readySelection: SelectionManifestRecord`. |
| `apps/admin/tests/support/operation-harness.ts` | `createOperationHarness(): Promise<OperationHarness>`; `enqueueMultiTarget(input: EnqueueMultiTargetCommand): Promise<CollectionOperationRecord>`; `failNextCommitFor(collectionId: string): void`; `runChildren(parentId: string): Promise<void>`; `loadCollection(collectionId: string): Promise<CollectionRecord>`; `parentSummary(parentId: string): Promise<{ completed: number; failed: number }>`; além de `collectionA`, `collectionB` e `readySelection`. |
| `apps/admin/tests/support/fake-artifact-store.ts` | Classe `FakeArtifactStore implements ArtifactStore`; `putCalls` guarda `ArtifactPutRequest & {capturedUtf8:string}`; implementa `put`, `readUrl`, `delete`. |

The integration harnesses use the isolated CMS database and a typed `FastApiAdminClient` mock only at the HTTP boundary; they do not insert raw operational Curations directly. The unit factory is the only source of virtual-table rows.

---

### Task 1: Atribuir e migrar `catalog_sequence`

**Files:**
- Modify: `concierge-api-v3/app/services/catalog_service.py`
- Create: `concierge-api-v3/scripts/backfill_catalog_sequence.py`
- Modify: `concierge-api-v3/app/models/schemas.py`
- Modify: `concierge-api-v3/app/services/curation_service.py`
- Modify: `concierge-api-v3/app/api/curations.py`
- Modify: `concierge-api-v3/app/api/capture.py`
- Modify: `concierge-api-v3/app/core/index_specs.py`
- Modify: `concierge-api-v3/tests/conftest.py`
- Modify: `concierge-api-v3/tests/factories.py`
- Test: `concierge-api-v3/tests/test_catalog_sequence.py`
- Test: `concierge-api-v3/tests/test_catalog_sequence_writes.py`

**Interfaces:**
- Consumes: collection operacional `curations` e nova `counters`.
- Produces: `reserve_catalog_sequences(db, count) -> range`; `ensure_catalog_sequence(db, document) -> int`; script idempotente com `--dry-run`, `--batch-size`, `--resume-after`.

- [ ] **Step 1: Escrever testes concorrentes e de todas as fronteiras**

```python
def test_reservations_do_not_overlap(test_db):
    first = list(reserve_catalog_sequences(test_db, 3))
    second = list(reserve_catalog_sequences(test_db, 2))
    assert first == [1, 2, 3]
    assert second == [4, 5]


def test_first_reservation_starts_after_existing_backfilled_max(test_db):
    seed_curations(test_db, [(41, "test_catalog_existing_41")])
    assert list(reserve_catalog_sequences(test_db, 2)) == [42, 43]


@pytest.mark.parametrize("writer", ["create", "bulk", "capture"])
def test_every_writer_assigns_server_sequence(writer, client, auth_headers):
    created = write_curation_through(writer, client, auth_headers)
    assert isinstance(created["catalog_sequence"], int)
    attempted = {**created, "curation_id": f"{writer}-spoof", "catalog_sequence": 1}
    spoofed = write_curation_through(writer, client, auth_headers, attempted)
    assert spoofed["catalog_sequence"] != 1
```

- [ ] **Step 2: Rodar e confirmar ausência do campo**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_catalog_sequence.py tests/test_catalog_sequence_writes.py -v`

Expected: FAIL porque allocator/campo não existem.

- [ ] **Step 3: Implementar allocator, enforcement, backfill e índice**

```python
COUNTER_ID = "curations_catalog_sequence"


def reserve_catalog_sequences(db: Database, count: int) -> range:
    if count < 1:
        raise ValueError("count must be positive")
    highest = db.curations.find_one(
        {"catalog_sequence": {"$type": "number"}},
        projection={"catalog_sequence": 1},
        sort=[("catalog_sequence", -1)],
    )
    current_max = int((highest or {}).get("catalog_sequence", 0))
    # `$max` seeds or repairs a stale counter before the atomic increment;
    # concurrent callers still get disjoint ranges from find_one_and_update.
    db.counters.update_one(
        {"_id": COUNTER_ID},
        {"$max": {"value": current_max}, "$set": {"initialized": True}},
        upsert=True,
    )
    counter = db.counters.find_one_and_update(
        {"_id": COUNTER_ID},
        {"$inc": {"value": count}},
        return_document=ReturnDocument.AFTER,
    )
    end = int(counter["value"])
    return range(end - count + 1, end + 1)

def ensure_catalog_sequence(db: Database, document: dict) -> int:
    sequence = next(iter(reserve_catalog_sequences(db, 1)))
    document["catalog_sequence"] = sequence
    return sequence
```

Remover qualquer `catalog_sequence` recebido antes de todas as inserções de create/bulk/capture e chamar o allocator. `Curation.catalog_sequence` é read-only na API de update. Backfill seleciona docs válidos sem field em batches, reserva range, atualiza por `_id` + `catalog_sequence:{$exists:false}`, reporta races/skips e pode retomar por `curation_id` canônico; documento sem `curation_id` válido é reportado, não recebe sequence.

Após backfill staging concluir, migration cria índices distintos: o primeiro
garante a unicidade server-owned do sequence; o segundo atende a ordenação do
scan `(catalog_sequence, curation_id)`.

```python
("curations", [("catalog_sequence", 1)], {
    "unique": True,
    "partialFilterExpression": {"catalog_sequence": {"$exists": True}},
    "name": "catalog_sequence_unique",
}),
("curations", [("catalog_sequence", 1), ("curation_id", 1)],
 {"name": "catalog_sequence_curation_scan"}),
```

- [ ] **Step 4: Verificar backfill duas vezes e escrita concorrente**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_catalog_sequence.py tests/test_catalog_sequence_writes.py -v
venv/bin/python scripts/backfill_catalog_sequence.py --dry-run --batch-size 500
venv/bin/python scripts/backfill_catalog_sequence.py --batch-size 500
venv/bin/python scripts/backfill_catalog_sequence.py --batch-size 500
```

Expected: segundo run altera zero docs; testes provam uniqueness com writers concorrentes e spoof ignorado.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/scripts/backfill_catalog_sequence.py concierge-api-v3/tests
git commit -m "feat(catalog): atribuir sequence monotônica às Curations"
```

---

### Task 2: Estender catálogo existente com search e scan high-water assinados

**Files:**
- Modify: `concierge-api-v3/app/models/catalog.py`
- Modify: `concierge-api-v3/app/api/catalog.py`
- Modify: `concierge-api-v3/app/services/catalog_service.py`
- Modify: `concierge-api-v3/app/core/config.py`
- Modify: `concierge-api-v3/main.py`
- Modify: `contracts/openapi/fastapi-admin-internal.v1.json` (via geração)
- Modify: `packages/fastapi-client/src/generated.ts` (via geração)
- Modify: `packages/fastapi-client/tests/contract.test.ts`
- Test: `concierge-api-v3/tests/test_catalog_scan.py`
- Test: `concierge-api-v3/tests/test_catalog_search.py`

**Interfaces:**
- Consumes: `POST /api/v3/catalog/curations/resolve` criado na fase 03, Task 4, para a seleção explícita; esta fase não duplica essa porta.
- Produces: `GET /api/v3/catalog/curations`; `POST /scan/start`; `POST /scan/page`; `normalize_catalog_filters`; cursor HMAC ligado a actor/scope/query/high-water/last tuple/expiry.

- [ ] **Step 1: Escrever teste do ID lexical menor após high-water**

```python
def test_scan_excludes_new_smaller_id_after_high_water(test_db, admin_client):
    seed_curations(test_db, [(10, "z-last"), (20, "zz-end")])
    started = admin_client.post("/api/v3/catalog/curations/scan/start", json={"filters": {}}).json()
    page1 = admin_client.post("/api/v3/catalog/curations/scan/page", json={
        "scan_token": started["scan_token"], "limit": 1,
    }).json()
    test_db.curations.insert_one(active_curation(catalog_sequence=21, curation_id="a-new"))
    page2 = admin_client.post("/api/v3/catalog/curations/scan/page", json={
        "scan_token": started["scan_token"], "cursor": page1["next_cursor"], "limit": 50,
    }).json()
    assert "a-new" not in [item["curation_id"] for item in page2["items"]]
    assert started["max_catalog_sequence"] == 20


def test_scan_page_rechecks_service_actor_after_role_downgrade(test_db, admin_client):
    seed_curations(test_db, [(10, "test_catalog_a"), (20, "test_catalog_b")])
    started = admin_client.post("/api/v3/catalog/curations/scan/start", json={"filters": {}}).json()
    test_db.users.update_one({"_id": "cms-admin-test"}, {"$set": {"role": "curator"}})
    response = admin_client.post("/api/v3/catalog/curations/scan/page", json={
        "scan_token": started["scan_token"], "limit": 1,
    })
    assert response.status_code == 403
```

- [ ] **Step 2: Rodar e confirmar 404**

Run: `cd concierge-api-v3 && venv/bin/pytest tests/test_catalog_scan.py tests/test_catalog_search.py -v`

Expected: FAIL/404 somente nos paths de search/scan, porque o router base já existe desde a fase 03 com `resolve`.

- [ ] **Step 3: Implementar filtro normalizado e tokens separados do JWT**

Modelar `CatalogFilters` (`q`, status, city, entityType, curatorId, updatedFrom/To), `CatalogSearchPage`, `CatalogScanStart`, `CatalogScanPage`. Normalização faz trim, lowercase de enums, sort/dedup arrays e JSON canônico para `query_hash`.

`scan/start` e `scan/page` exigem `X-CMS-Service-Key` **e** um `actor_id`
ligado ao token/request. Antes de iniciar e antes de cada página,
`require_current_catalog_admin(db, actor_id)` relê `users` e exige
`authorized is True` e `role == 'admin'`; o service key autentica apenas o
Payload/worker, nunca substitui o ator. `scan/start` calcula
`max(catalog_sequence)`, `snapshot_started_at` e token HMAC-SHA256 com segredo
`CATALOG_CURSOR_SECRET` distinto do JWT. `scan/page` valida
assinatura/expiry/actor/scope/query e busca sem sobrescrever um `$or` que possa
vir de filtros mutáveis:

```python
cursor_clause = {} if cursor is None else {
    "$or": [
        {"catalog_sequence": {"$gt": cursor.catalog_sequence}},
        {"catalog_sequence": cursor.catalog_sequence,
         "curation_id": {"$gt": cursor.curation_id}},
    ],
}
query = {
    "$and": [
        mutable_filter_query(filters),
        {"catalog_sequence": {"$lte": token.max_catalog_sequence}},
        cursor_clause,
    ],
}
```

Ordenar `(catalog_sequence, curation_id)`, limit máximo 500, revalidar
service-key + actor por request e marcar documentos inválidos/skipped com
reason. Search usa cursor próprio e devolve `AdminCurationRow` allowlisted;
não inclui transcript/private notes/sources/embeddings.

- [ ] **Step 4: Rodar scan mutável/retry e regenerar contrato**

Run:

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_catalog_scan.py tests/test_catalog_search.py -v
cd ..
npm run generate:contracts
npm run check:contracts
git diff --exit-code contracts/openapi/fastapi-admin-internal.v1.json packages/fastapi-client/src/generated.ts
```

Expected: PASS para insert lexical menor, edit/delete entre páginas, retry de
cursor, token de outro actor/query, downgrade entre páginas e documento sem
sequence. A geração atualiza snapshot e client; `--check` e o diff garantem
que nada gerado ficou sem versionar.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/tests contracts packages/fastapi-client
git commit -m "feat(catalog): expor search e scan high-water"
```

---

### Task 3: Construir Explorer virtualizado, filtros e views privadas

**Files:**
- Create: `apps/admin/src/payload/collections/SavedCurationViews.ts`
- Create: `apps/admin/src/explorer/types.ts`
- Create: `apps/admin/src/explorer/normalize-filters.ts`
- Create: `apps/admin/src/fastapi/curation-adapter.ts`
- Create: `apps/admin/src/components/explorer/CurationExplorer.tsx`
- Create: `apps/admin/src/components/explorer/VirtualCurationTable.tsx`
- Create: `apps/admin/src/components/explorer/SelectionToolbar.tsx`
- Create: `apps/admin/src/payload/endpoints/explorer.ts`
- Create: `apps/admin/tests/support/factories.ts`
- Modify: `apps/admin/src/payload/collections/index.ts`
- Modify: `apps/admin/payload.config.ts`
- Modify: `apps/admin/package.json`
- Modify: `package-lock.json`
- Test: `apps/admin/tests/unit/explorer/filters.test.ts`
- Test: `apps/admin/tests/unit/explorer/selection.test.tsx`
- Test: `apps/admin/tests/e2e/explorer/keyboard.spec.ts`

**Interfaces:**
- Consumes: `FastApiAdminClient` catalog routes.
- Produces: `normalizeCurationFilters`, Resource Explorer read-only, selection explicit/page/shift/all-matching intent, private saved views.

- [ ] **Step 1: Escrever testes de filtro e DOM bounded**

```typescript
test('normalização produz hash estável', async () => {
  const a = normalizeCurationFilters({ q: ' Sushi ', status: ['active', 'draft', 'active'] })
  const b = normalizeCurationFilters({ status: ['draft', 'active'], q: 'Sushi' })
  expect(a).toEqual(b)
  expect(await hashNormalizedFilters(a)).toBe(await hashNormalizedFilters(b))
})

test('50k rows mantém menos de 100 linhas no DOM', () => {
  render(<VirtualCurationTable rows={makeRows(50_000)} height={600} rowHeight={44} />)
  expect(screen.getAllByRole('row').length).toBeLessThan(100)
})
```

- [ ] **Step 2: Instalar libs e confirmar imports ausentes**

Run:

```bash
npm install --workspace=@concierge/admin --save-exact @tanstack/react-virtual@3.14.9
npm run test:admin -- --run tests/unit/explorer
```

Expected: FAIL porque componentes/normalizador não existem.

- [ ] **Step 3: Implementar Explorer e seleção acessível**

```tsx
// apps/admin/src/components/explorer/CurationExplorer.tsx
const [selection, setSelection] = useState<SelectionState>({ mode: 'explicit', selected: new Set() })
const virtualizer = useVirtualizer({
  count: rows.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 44,
  overscan: 12,
})
const selectAllMatching = () => setSelection({
  mode: 'all_matching', filters: normalizeCurationFilters(filters),
  excluded: new Set(), previewCount: page.total,
})

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, [contenteditable="true"]'))
}
```

```typescript
// apps/admin/src/explorer/types.ts
export type SelectionState =
  | { mode: 'explicit'; selected: Set<string> }
  | { mode: 'all_matching'; filters: NormalizedCurationFilters; excluded: Set<string>; previewCount: number | null }
```

`CurationExplorer` carrega lotes cursor-paginados via BFF `/api/admin/v1/curations`, mantém apenas rows carregadas e nunca expande all-matching em IDs no browser. Checkbox suporta indeterminate, Shift seleciona somente o intervalo carregado, atalhos retornam sem agir para `isEditableTarget(event.target)`, toolbar tem equivalentes visuais e status `aria-live`. Saved views persistem owner, name, normalizedFilters, sort e visibleColumns; access restringe owner.

- [ ] **Step 4: Rodar unit, teclado e a11y**

Run:

```bash
npm run test:admin -- --run tests/unit/explorer
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/explorer/keyboard.spec.ts
npm run typecheck:admin
```

Expected: PASS; axe não reporta critical/serious; DOM bounded e seleção persiste por paginação.

- [ ] **Step 5: Commit**

```bash
git add apps/admin package.json package-lock.json
git commit -m "feat(cms): adicionar Curation Explorer virtualizado"
```

---

### Task 4: Materializar manifests explícitos e all-matching

**Files:**
- Create: `apps/admin/src/payload/collections/SelectionManifests.ts`
- Create: `apps/admin/src/payload/collections/SelectionManifestItems.ts`
- Create: `apps/admin/src/selections/types.ts`
- Create: `apps/admin/src/selections/materialize-selection.ts`
- Create: `apps/admin/src/jobs/materializeSelectionTask.ts`
- Create: `apps/admin/src/payload/endpoints/selections.ts`
- Create: `apps/admin/src/migrations/20260818_002_selections.ts`
- Create: `apps/admin/tests/support/selection-harness.ts`
- Modify: `apps/admin/src/payload/collections/index.ts`
- Modify: `apps/admin/payload.config.ts`
- Test: `apps/admin/tests/integration/worker/selection-manifest.int.test.ts`
- Test: `apps/admin/tests/integration/worker/selection-restart.int.test.ts`

**Interfaces:**
- Produces: `CreateSelectionCommand`, `SelectionManifestRecord`, `materializeSelection(selectionId, lease)`; POST/GET selections; unique item e TTL.

- [ ] **Step 1: Escrever teste de retry e count/hash exatos**

```typescript
test('retry da mesma página não duplica manifest item', async () => {
  const { createAllMatchingSelection, fastApi, manifestIds, loadSelection } = await createSelectionHarness()
  const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })
  fastApi.scanPage.mockResolvedValueOnce(page(['c1', 'c2'], 'cursor-2'))
    .mockResolvedValueOnce(page(['c1', 'c2'], 'cursor-2'))
    .mockResolvedValueOnce(page(['c3'], null))
  await materializeSelection(selection.id, lease())
  expect(await manifestIds(selection.id)).toEqual(['c1', 'c2', 'c3'])
  expect((await loadSelection(selection.id)).capturedCount).toBe(3)
})
```

- [ ] **Step 2: Rodar e confirmar collection/job ausentes**

Run: `npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/selection-manifest.int.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implementar materialização retomável**

```typescript
// apps/admin/src/selections/materialize-selection.ts
export async function materializeSelection(selectionId: string, jobLease: JobLease): Promise<SelectionManifestRecord> {
  let selection = await claimSelection(selectionId, jobLease)
  while (selection.status === 'materializing') {
    const page = await fastApi.scanPage({
      scanToken: selection.scanToken!, cursor: selection.checkpointCursor, limit: 500,
      actorId: selection.actorId,
    }) // client supplies X-CMS-Service-Key; FastAPI rechecks actor on every page
    const accepted = page.items.filter(({ curation_id }) => !selection.excludedIds.includes(curation_id))
    if (accepted.length > 0) {
      await manifestItems.bulkWrite(accepted.map(({ curation_id }) => ({
        updateOne: {
          filter: { selectionId, curationId: curation_id },
          update: { $setOnInsert: { selectionId, curationId: curation_id, createdAt: new Date() } },
          upsert: true,
        },
      })), { ordered: false })
    }
    selection = await checkpointSelection(selectionId, jobLease, page.next_cursor)
    if (page.next_cursor === null) break
  }
  return finalizeManifest(selectionId, jobLease)
}
```

```typescript
// apps/admin/src/selections/materialize-selection.ts
export async function hashManifestIds(selectionId: string): Promise<{ count: number; sha256: string }> {
  const digest = createHash('sha256').update('concierge.selection-manifest.v1\0')
  let count = 0
  const cursor = manifestItems.find({ selectionId }).sort({ curationId: 1 }).batchSize(500)
  for await (const item of cursor) {
    digest.update(item.curationId, 'utf8').update('\n')
    count += 1
  }
  return { count, sha256: digest.digest('hex') }
}
```

POST aceita `mode='explicit'` com no máximo 500 IDs ou `mode='all_matching'` com filtros/exceções. Explicit chama `POST /api/v3/catalog/curations/resolve` da fase 03, Task 4, materializa somente IDs elegíveis e conserva `candidateCount`, `capturedCount`, `skippedCount` e reasons dos missing/deleted/ineligible no manifest. All-matching persiste token/high-water/checkpoint; exceções são deduplicadas/canonicalizadas pelo mesmo `resolve`, persistidas no manifest com limite explícito de 5.000 e filtradas antes do upsert. Acima do limite, a UI orienta trocar para seleção explícita/filtro mais estreito. Cada página revalida service key + actor, faz upserts unordered unique `(selectionId,curationId)` e só então avança o checkpoint por CAS, inclusive gravando o cursor terminal `null`; o `break` impede reiniciar o scan. `hashManifestIds` percorre cursor ordenado sem materializar o conjunto.

Manifest states: `queued|materializing|ready|failed|expired`; unused items have a 24-hour TTL and used items receive operation `retainedUntil`. Every checkpoint revalidates actor/fence. Migration creates unique/lookup/TTL indexes.

- [ ] **Step 4: Rodar materialização/restart/expiry**

Run:

```bash
CMS_MONGODB_DB_NAME=concierge-cms-test npm run migrate:cms --workspace=@concierge/admin
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/selection-manifest.int.test.ts tests/integration/worker/selection-restart.int.test.ts
```

Expected: PASS; `processed+skipped=candidates`; restart retoma cursor; expired GET retorna 410.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(cms): materializar selection manifests"
```

---

### Task 5: Estender operações para selection e multi-target

**Files:**
- Modify: `apps/admin/src/operations/types.ts`
- Modify: `apps/admin/src/operations/enqueue.ts`
- Modify: `apps/admin/src/operations/apply-draft-operation.ts`
- Modify: `apps/admin/src/payload/endpoints/operations.ts`
- Create: `apps/admin/src/components/operations/JobDrawer.tsx`
- Create: `apps/admin/src/components/operations/BulkActionDialog.tsx`
- Create: `apps/admin/tests/support/operation-harness.ts`
- Modify: `apps/admin/src/components/explorer/SelectionToolbar.tsx`
- Test: `apps/admin/tests/integration/worker/multi-target.int.test.ts`
- Test: `apps/admin/tests/e2e/explorer/bulk-to-draft.spec.ts`

**Interfaces:**
- Consumes: ready `selectionId`; operation engine da fase 03.
- Produces: parent operation + child por Collection; job drawer server-backed; bulk add/remove/cancel.
- Reads: `GET /api/admin/v1/operations?actor=current&active=true` e `GET /api/admin/v1/operations/:id`, ambos cursor-paginados/guarded por admin atual.

- [ ] **Step 1: Escrever teste de atomicidade independente**

```typescript
test('multi-target expõe sucesso e falha por Collection', async () => {
  const { readySelection, collectionA, collectionB, enqueueMultiTarget, failNextCommitFor, runChildren, loadCollection, parentSummary } = await createOperationHarness()
  const parent = await enqueueMultiTarget({
    selectionId: readySelection.id,
    collectionIds: [collectionA.id, collectionB.id], action: 'add',
    idempotencyKey: 'bulk-test-1',
  })
  failNextCommitFor(collectionB.id)
  await runChildren(parent.id)
  expect((await loadCollection(collectionA.id)).draftSelectedCount).toBe(3)
  expect((await loadCollection(collectionB.id)).draftSelectedCount).toBe(0)
  expect(await parentSummary(parent.id)).toMatchObject({ completed: 1, failed: 1 })
})
```

- [ ] **Step 2: Rodar e confirmar mode não suportado**

Run: `npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/multi-target.int.test.ts`

Expected: FAIL/422 porque `mode='selection'` ainda não é aceito.

- [ ] **Step 3: Implementar children e drawer persistente**

```typescript
// apps/admin/src/operations/enqueue.ts
export async function enqueueMultiTarget(input: EnqueueMultiTargetInput): Promise<ParentOperationRecord> {
  const manifest = await requireReadyManifest(input.selectionId)
  const parent = await createParentOperation({ ...input, selectionHash: manifest.sha256 })
  await Promise.all(input.collectionIds.map(async (collectionId) => {
    await enqueueDraftOperation({
      collectionId, mode: 'selection', action: input.action, selectionId: manifest.id,
      baseDraftRevision: await currentDraftRevision(collectionId),
      idempotencyKey: `${input.idempotencyKey}:${collectionId}`,
      requestHash: hashRequest({ collectionId, action: input.action, selectionHash: manifest.sha256 }),
      parentOperationId: parent.id,
    })
  }))
  return parent
}
```

```tsx
// apps/admin/src/components/operations/JobDrawer.tsx
const operations = useActiveOperations({ pollMs: 2_000 }) // useEffect + AbortController; estado vem do servidor
return <aside aria-label="Jobs em andamento">{operations.map((operation) => (
  <JobRow key={operation.id} operation={operation} showCancel={operation.status !== 'committing'} />
))}</aside>
```

Parent não tem atomicidade entre targets; cada child tem sequence/revision própria e request hash com `selectionHash`. Criação do parent e dos children é retomável: parent usa unique `(actorId,idempotencyKey)`, child usa unique `(parentOperationId,collectionId)`, e retry só cria children ausentes. O child pagina `selection_manifest_items` no worker, nunca traz IDs ao web, usa staging/CAS existente e grava skips/errors por item. Erro inesperado deixa `failed>0` e impede integralmente o commit daquela Collection; somente skips esperados podem coexistir com sucesso. No terminal de cada child, `processed + skipped + failed = selectedManifestCount`, e o parent deriva seus totals dos children. Collections rodam em paralelo enquanto uma mesma Collection permanece ordenada.

`useActiveOperations` é implementado no próprio `JobDrawer.tsx` com `useEffect`, `AbortController`, cleanup e backoff, sem dependência implícita de React Query. O drawer relê estado server-side, reconstrói após reload e mostra progress monotônico, retries, skips, failures e cancel antes de `committing`; a UI nunca trata 202 como sucesso.

- [ ] **Step 4: Rodar integração e E2E 50k**

Run:

```bash
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/multi-target.int.test.ts
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/explorer/bulk-to-draft.spec.ts
```

Expected: PASS; operação 50k não envia array de IDs no request do browser; sair/voltar preserva job.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(cms): aplicar bulk multi-target por manifest"
```

---

### Task 6: Exportar seleção para object storage e medir escala

**Files:**
- Create: `apps/admin/src/storage/artifact-store.ts`
- Create: `apps/admin/src/storage/s3-artifact-store.ts`
- Create: `apps/admin/tests/support/fake-artifact-store.ts`
- Create: `apps/admin/src/jobs/exportSelectionTask.ts`
- Create: `apps/admin/src/payload/endpoints/exports.ts`
- Create: `apps/admin/tests/integration/worker/export-selection.int.test.ts`
- Create: `apps/admin/tests/load/explorer-selection.mjs`
- Create: `docs/benchmarks/collections-template.md`
- Modify: `apps/admin/src/env.ts`
- Modify: `apps/admin/payload.config.ts`
- Modify: `apps/admin/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: manifest, internal hydration allowlist, S3-compatible private bucket.
- Produces: `ArtifactStore.put/readUrl/delete`; export NDJSON/CSV job; artifact TTL; load runner com JSON result.
- `ArtifactPutRequest` contém `key`, `contentType`, `expiresAt` e `body: AsyncIterable<Uint8Array>`; `StoredArtifact` acrescenta o `sha256` calculado durante o upload concluído.
- Routes: `POST /api/admin/v1/selections/:selectionId/exports`; `GET /api/admin/v1/exports/:exportId` (status e presigned URL curta somente após complete).

- [ ] **Step 1: Escrever teste de stream e URL privada**

```typescript
test('export streams allowlisted records and stores private artifact', async () => {
  const { readySelection } = await createSelectionHarness()
  const store = new FakeArtifactStore()
  const result = await exportSelectionTask.run({ selectionId: readySelection.id, format: 'ndjson' }, { store })
  expect(store.putCalls[0].contentType).toBe('application/x-ndjson')
  expect(store.putCalls[0].capturedUtf8).not.toContain('transcript')
  expect(result.downloadExpiresAt).toBeTruthy()
  expect(result.downloadUrl).not.toContain('public-read')
})
```

- [ ] **Step 2: Instalar SDK e confirmar implementação ausente**

Run:

```bash
npm install --workspace=@concierge/admin --save-exact @aws-sdk/client-s3@3.1103.0 @aws-sdk/lib-storage@3.1103.0 @aws-sdk/s3-request-presigner@3.1103.0
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/export-selection.int.test.ts
```

Expected: FAIL por task/store ausentes.

- [ ] **Step 3: Implementar adapter S3 e export bounded-memory**

Use the SDK installed in Step 2 and validate storage configuration at boot with no bucket or credential defaults:
```typescript
// apps/admin/src/env.ts
export const artifactStorageEnv = {
  endpoint: requiredEnv('S3_ENDPOINT'),
  region: requiredEnv('S3_REGION'),
  bucket: requiredEnv('S3_BUCKET'),
  accessKeyId: requiredEnv('S3_ACCESS_KEY_ID'),
  secretAccessKey: requiredEnv('S3_SECRET_ACCESS_KEY'),
  forcePathStyle: optionalBooleanEnv('S3_FORCE_PATH_STYLE', false),
  exportPrefix: requiredEnv('S3_EXPORT_PREFIX'),
  signedUrlTtlSeconds: requiredPositiveIntEnv('S3_SIGNED_URL_TTL_SECONDS'),
  artifactTtlSeconds: requiredPositiveIntEnv('EXPORT_ARTIFACT_TTL_SECONDS'),
}
```

```typescript
// apps/admin/src/storage/s3-artifact-store.ts
const client = new S3Client({
  region: artifactStorageEnv.region,
  endpoint: artifactStorageEnv.endpoint,
  forcePathStyle: artifactStorageEnv.forcePathStyle,
  credentials: { accessKeyId: artifactStorageEnv.accessKeyId, secretAccessKey: artifactStorageEnv.secretAccessKey },
})

export async function putPrivateArtifact(input: ArtifactPutRequest): Promise<StoredArtifact> {
  const key = `${artifactStorageEnv.exportPrefix}/${input.key}`
  const digest = createHash('sha256')
  async function* hashingBody() {
    for await (const chunk of input.body) {
      digest.update(chunk)
      yield chunk
    }
  }
  await new Upload({ client, params: {
    Bucket: artifactStorageEnv.bucket, Key: key, Body: Readable.from(hashingBody()),
    ContentType: input.contentType, Metadata: { expiresAt: input.expiresAt.toISOString() },
  }}).done() // no ACL: bucket policy remains private
  return { key, contentType: input.contentType, sha256: digest.digest('hex'), expiresAt: input.expiresAt }
}

export function readPrivateArtifactUrl(artifact: StoredArtifact): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: artifactStorageEnv.bucket, Key: artifact.key }), {
    expiresIn: artifactStorageEnv.signedUrlTtlSeconds,
  })
}
```

As deployment vars são exatamente `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_EXPORT_PREFIX`, `S3_SIGNED_URL_TTL_SECONDS` e `EXPORT_ARTIFACT_TTL_SECONDS` (`604800` em staging). O principal S3 é prefix-scoped para `PutObject`, `GetObject`, `AbortMultipartUpload`, `ListBucketMultipartUploads` e cleanup `DeleteObject`; nunca usa ACL pública. O export pagina manifest + hydration em 500, escreve records allowlisted via `AsyncIterable<Uint8Array>`, atualiza hash lógico/count/progress e termina com manifest/footer. O adapter calcula simultaneamente o SHA dos bytes realmente enviados e só o persiste no registro CMS após upload completo; não tenta conhecer o digest final no metadata inicial do multipart. TTL metadata usa `EXPORT_ARTIFACT_TTL_SECONDS` em todo ambiente.

`explorer-selection.mjs` generates a 50k dataset in the test database, measures search/scan/materialize/apply, worker RSS, and DOM rows through Playwright, then writes JSON for the template with dataset, indexes, p50/p95/p99, throughput, retries, and memory peak.

- [ ] **Step 4: Rodar export e benchmark local controlado**

Run:

```bash
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/export-selection.int.test.ts
node apps/admin/tests/load/explorer-selection.mjs --items 50000 --output /tmp/collections-benchmark.json
```

Expected: export PASS; benchmark termina sem array de 50k no browser, RSS bounded por batches e JSON contém todas as métricas requeridas.

- [ ] **Step 5: Commit**

```bash
git add apps/admin docs/benchmarks package.json package-lock.json
git commit -m "feat(cms): exportar selections e medir escala"
```

## Gate da fase

```bash
npm run check:contracts
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/explorer
npm run typecheck:admin
cd concierge-api-v3
venv/bin/pytest tests/test_catalog_sequence.py tests/test_catalog_sequence_writes.py tests/test_catalog_scan.py tests/test_catalog_search.py -v
```

Expected: exit 0; execução de 50k prova DOM bounded, high-water correto, manifest imutável e draft não parcialmente visível.
