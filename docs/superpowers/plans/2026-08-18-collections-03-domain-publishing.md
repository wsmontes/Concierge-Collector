# Domínio de Collections e Publicação Versionada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar Collections, membership por intervalos, draft delta, operações serializadas e publicação explícita, retomável e atômica.

**Architecture:** Payload possui documentos pequenos e índices próprios no banco CMS. Mudanças grandes são preparadas para uma revisão futura e ficam invisíveis até CAS; publish converte delta em intervals idempotentes e troca o ponteiro publicado numa transação curta após revalidar ator, lease, revision, contagem e hash.

**Tech Stack:** Payload Local API/Jobs, TypeScript, MongoDB transactions/indexes, FastAPI internal availability API, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-collections-payload-cms-design.md`

## Global Constraints

- Nenhum campo array de Curation IDs em `collections` ou `collection-versions`.
- Não existe posição/rank/sequence editorial; ordenação por `curationId` é somente técnica/canônica.
- Uma reentrada cria novo interval; nunca reabre nem reescreve interval histórico.
- Delta visível filtra `draftEpoch`, operação committed e `targetDraftRevision <= collection.draftRevision`.
- Mesmo `Idempotency-Key` + mesmo hash devolve o registro original; payload diferente retorna 409.
- Uma Collection processa mutações em ordem; Collections distintas podem executar em paralelo.
- Staging invisível sobrevive a retry e é descartável após cancel/falha; commit muda um único ponteiro por CAS.
- Publish bloqueia metadata/membership com 423, mantém leituras e não promove estado parcial.
- Slug fica imutável e reservado após primeiro publish; publicada só pode ser archived, nunca hard-deleted.
- Archive é kill switch externo; restore mantém exatamente `currentPublishedVersion`.
- Toda transição e credential-sensitive action grava audit append-only com request/actor IDs.

---

### Task 1: Declarar collections operacionais e índices CMS

**Files:**
- Create: `apps/admin/src/payload/collections/Collections.ts`
- Create: `apps/admin/src/payload/collections/CollectionVersions.ts`
- Create: `apps/admin/src/payload/collections/CollectionMemberships.ts`
- Create: `apps/admin/src/payload/collections/CollectionDraftChanges.ts`
- Create: `apps/admin/src/payload/collections/CollectionOperations.ts`
- Create: `apps/admin/src/payload/collections/CollectionOperationItems.ts`
- Create: `apps/admin/src/payload/collections/CollectionPublishJobs.ts`
- Create: `apps/admin/src/payload/collections/AuditEvents.ts`
- Create: `apps/admin/src/migrations/20260818_001_collections.ts`
- Modify: `apps/admin/src/payload/collections/index.ts`
- Modify: `apps/admin/payload.config.ts`
- Modify: `apps/admin/package.json`
- Test: `apps/admin/tests/integration/payload/collection-indexes.int.test.ts`
- Create: `apps/admin/tests/integration/support/cms-db.ts`

**Interfaces:**
- Consumes: `CmsUsers`, `isAuthorizedAdmin` e Mongo CMS.
- Produces: slugs/db names `collections`, `collection_versions`, `collection_memberships`, `collection_draft_changes`, `collection_operations`, `collection_operation_items`, `collection_publish_jobs`, `audit_events`; script `migrate:cms`.

- [ ] **Step 1: Escrever o teste de schema e índices**

```typescript
import { describe, expect, test } from 'vitest'
import { cmsDb } from '../support/cms-db'

describe('Collections CMS indexes', () => {
  test('protege slug, interval aberto, staging e filas', async () => {
    const names = async (collection: string) =>
      (await cmsDb.collection(collection).indexes()).map((index) => index.name)

    expect(await names('collections')).toContain('collections_slug_unique')
    expect(await names('collection_memberships')).toEqual(expect.arrayContaining([
      'membership_interval_unique', 'membership_open_unique', 'membership_by_curation',
    ]))
    expect(await names('collection_draft_changes')).toContain('draft_change_item_unique')
    expect(await names('collection_operations')).toEqual(expect.arrayContaining([
      'operation_idempotency_unique', 'operation_queue_order', 'operation_lease_expiry',
    ]))
    expect(await names('collection_publish_jobs')).toContain('publish_lease_expiry')
  })
})
```

- [ ] **Step 2: Rodar e confirmar collections ausentes**

Run: `npm run test:integration --workspace=@concierge/admin -- tests/integration/payload/collection-indexes.int.test.ts`

Expected: FAIL porque as collections/índices ainda não existem.

- [ ] **Step 3: Criar configs e migration idempotente**

`Collections.ts` contém exatamente os campos pequenos:

```typescript
export const Collections: CollectionConfig = {
  slug: 'collections',
  dbName: 'collections',
  admin: { useAsTitle: 'title', group: 'Content' },
  access: { create: adminAccess, read: adminAccess, update: () => false, delete: () => false },
  versions: { maxPerDoc: 50 },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    { name: 'lifecycle', type: 'select', required: true,
      options: ['draft', 'published', 'archived'], defaultValue: 'draft', index: true },
    { name: 'currentPublishedVersion', type: 'number' },
    { name: 'draftBaseVersion', type: 'number' },
    { name: 'draftEpoch', type: 'text', required: true, index: true },
    { name: 'draftRevision', type: 'number', required: true, defaultValue: 0 },
    { name: 'draftState', type: 'select', required: true,
      options: ['clean', 'dirty', 'publishing', 'failed'], defaultValue: 'clean', index: true },
    { name: 'publishedSelectedCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'draftSelectedCount', type: 'number', required: true, defaultValue: 0 },
    { name: 'revision', type: 'number', required: true, defaultValue: 1 },
    { name: 'everPublished', type: 'checkbox', required: true, defaultValue: false },
  ],
}
```

As sete collections operacionais são `admin.hidden=true`, deny-all no REST e graváveis somente por serviços com `overrideAccess:true`. Tipar todos os status da spec. A migration cria os índices nomeados do teste, inclusive partial unique de interval aberto:

```text
collection_versions: collectionId, version, metadataSnapshot, selectedCount,
  membershipHash, publicationJobId, schemaVersion, status, publishedAt/By
collection_memberships: collectionId, curationId, addedInVersion,
  removedInVersion|null, createdAt/By
collection_draft_changes: collectionId, curationId, desiredState,
  basePublishedVersion, draftEpoch, baseDraftRevision, targetDraftRevision,
  operationId, operationSequence, validUntilDraftRevision|null
collection_operations: collectionId, parentOperationId|null, mode, action,
  selectionId|null, operationSequence, baseDraftRevision, targetDraftRevision,
  idempotencyKey, requestHash, selectedCount, status, progress, checkpoint, leaseOwner,
  leaseExpiresAt, fencingToken, actorId, errorCode
collection_operation_items: operationId, curationId, desiredState, status,
  reasonCode|null, targetDraftRevision
collection_publish_jobs: collectionId, fixedDraftEpoch, fixedDraftRevision,
  baseVersion, targetVersion, status, checkpoint, selectedCount,
  membershipHash, leaseOwner, leaseExpiresAt, fencingToken, actorId
audit_events: eventKey, eventType, actorId, requestId, collectionId|null,
  operationId|null, publicationJobId|null, beforeRevision|null, afterRevision|null,
  metadata, createdAt
```

```typescript
await db.collection('collection_memberships').createIndex(
  { collectionId: 1, curationId: 1 },
  { unique: true, partialFilterExpression: { removedInVersion: null }, name: 'membership_open_unique' },
)
await db.collection('audit_events').createIndex(
  { eventKey: 1 }, { unique: true, name: 'audit_event_key_unique' },
)
```

`tests/integration/support/cms-db.ts` cria `MongoClient(process.env.CMS_MONGODB_URL)`, recusa database sem sufixo `-test`, exporta `cmsDb`, `clearCmsCollections(names)` e fecha o client em `afterAll`; nenhum teste integration aceita URL produtiva.

Adicionar `migrate:cms: payload migrate` ao package; migration é invocada apenas manual/release step.

- [ ] **Step 4: Migrar banco de teste e validar tipos/índices**

Run:

```bash
CMS_MONGODB_DB_NAME=concierge-cms-test npm run migrate:cms --workspace=@concierge/admin
npm run generate:types --workspace=@concierge/admin
npm run test:integration --workspace=@concierge/admin -- tests/integration/payload/collection-indexes.int.test.ts
npm run typecheck:admin
```

Expected: PASS; segundo `migrate:cms` é no-op; `payload-types.ts` fica versionado.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(collections): criar schema CMS e indices"
```

---

### Task 2: Implementar lifecycle, slug imutável e auditoria

**Files:**
- Create: `apps/admin/src/collections/types.ts`
- Create: `apps/admin/src/collections/lifecycle.ts`
- Create: `apps/admin/src/collections/repository.ts`
- Create: `apps/admin/src/audit/append-event.ts`
- Create: `apps/admin/src/payload/endpoints/collections.ts`
- Modify: `apps/admin/payload.config.ts`
- Test: `apps/admin/tests/unit/collections/lifecycle.test.ts`
- Test: `apps/admin/tests/integration/payload/collection-lifecycle.int.test.ts`

**Interfaces:**
- Consumes: collections Task 1, `withAdmin`, headers `If-Match`, `Idempotency-Key`, `X-Request-Id`.
- Produces: `createCollection`, `patchCollectionMetadata`, `hardDeleteNeverPublished`, `archiveCollection`, `restoreCollection`; CRUD/transitions em `/api/admin/v1/collections`.

- [ ] **Step 1: Escrever tabela de transições que falha**

```typescript
import { describe, expect, test } from 'vitest'
import { decideLifecycle } from '../../../src/collections/lifecycle'

describe('Collection lifecycle', () => {
  test.each([
    ['draft', false, 'delete', 'hard-delete'],
    ['published', true, 'delete', 'reject'],
    ['published', true, 'archive', 'archived'],
    ['archived', true, 'restore', 'published'],
    ['archived', true, 'patch', 'reject'],
  ] as const)('%s + %s + %s -> %s', (lifecycle, everPublished, command, result) => {
    expect(decideLifecycle({ lifecycle, everPublished }, command)).toBe(result)
  })

  test('slug publicado nunca muda', () => {
    expect(() => decideLifecycle(
      { lifecycle: 'published', everPublished: true, slug: 'a' },
      'patch', { slug: 'b' },
    )).toThrow('slug_immutable')
  })
})
```

- [ ] **Step 2: Rodar e confirmar módulo ausente**

Run: `npm run test:admin -- --run tests/unit/collections/lifecycle.test.ts`

Expected: FAIL por import inexistente.

- [ ] **Step 3: Implementar comandos com CAS e audit**

Definir `CollectionRecord` com os campos da Task 1. `decideLifecycle` é função pura e cobre cada linha da spec. Repository atualiza sempre com filtro `{id, revision: ifMatch}` e `$inc:{revision:1}`; zero match retorna `412 revision_conflict`.

Ao editar metadata de Collection publicada, repository fixa `draftBaseVersion=currentPublishedVersion`, preserva/reutiliza `draftEpoch`, muda `draftState='dirty'` e mantém a metadata publicada somente em `collection_versions`. Archive é kill switch e pode vencer até uma corrida com publish: CAS grava `lifecycle='archived'`, incrementa `revision` e marca o publish concorrente stale; a promoção fixa a revision/lifecycle anterior e então falha. Restore volta a `published` sem alterar `currentPublishedVersion`, mas exige que o reconciliador já tenha tornado qualquer publish concorrente terminal.

`appendAuditEvent` grava `{eventKey,eventType,actorId,requestId,collectionId,beforeRevision,afterRevision,metadata,createdAt}`; `eventKey` deriva do command/job para retry idempotente. Lifecycle CAS e seu audit são commitados na mesma transação curta. O access layer rejeita update/delete. Registrar endpoints:

```text
POST   /api/admin/v1/collections
GET    /api/admin/v1/collections/:id
PATCH  /api/admin/v1/collections/:id
DELETE /api/admin/v1/collections/:id
POST   /api/admin/v1/collections/:id/archive
POST   /api/admin/v1/collections/:id/restore
```

Normalize slug com lowercase ASCII, `-`, 3–80 chars; criar reserva única na própria Collection e nunca apagar documento publicado.

- [ ] **Step 4: Rodar unit e integração de lifecycle**

Run:

```bash
npm run test:admin -- --run tests/unit/collections/lifecycle.test.ts
npm run test:integration --workspace=@concierge/admin -- tests/integration/payload/collection-lifecycle.int.test.ts
```

Expected: PASS para slug conflict, stale If-Match, delete never-published, archive/restore e audit append-only.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src apps/admin/tests apps/admin/payload.config.ts
git commit -m "feat(collections): implementar lifecycle auditado"
```

---

### Task 3: Projetar membership, delta líquido e hash canônico

**Files:**
- Create: `apps/admin/src/collections/membership.ts`
- Create: `apps/admin/src/collections/draft-delta.ts`
- Create: `apps/admin/src/collections/canonical-membership-hash.ts`
- Test: `apps/admin/tests/unit/collections/membership.test.ts`
- Test: `apps/admin/tests/unit/collections/draft-delta.test.ts`
- Test: `apps/admin/tests/unit/collections/hash.test.ts`

**Interfaces:**
- Produces: `isMemberAtVersion(interval, version) -> boolean`; `convergeDraftDelta(published, current, action) -> 'add'|'remove'|null`; `computeCanonicalMembershipHash(ids: Iterable<string>|AsyncIterable<string>, schemaVersion: number) -> Promise<string>`.

- [ ] **Step 1: Escrever testes de interval/reentrada/convergência**

```typescript
import { describe, expect, test } from 'vitest'
import { isMemberAtVersion } from '../../../src/collections/membership'
import { convergeDraftDelta } from '../../../src/collections/draft-delta'

test('interval fechado vale somente antes de removedInVersion', () => {
  const interval = { addedInVersion: 2, removedInVersion: 5 }
  expect([1, 2, 4, 5].map((v) => isMemberAtVersion(interval, v)))
    .toEqual([false, true, true, false])
})

test.each([
  [false, null, 'add', 'add'], [true, null, 'remove', 'remove'],
  [false, 'add', 'remove', null], [true, 'remove', 'add', null],
  [false, 'add', 'add', 'add'], [true, 'remove', 'remove', 'remove'],
] as const)('delta converge', (published, current, action, expected) => {
  expect(convergeDraftDelta(published, current, action)).toBe(expected)
})
```

- [ ] **Step 2: Rodar e confirmar falha de imports**

Run: `npm run test:admin -- --run tests/unit/collections/membership.test.ts tests/unit/collections/draft-delta.test.ts tests/unit/collections/hash.test.ts`

Expected: FAIL porque as três funções não existem.

- [ ] **Step 3: Implementar funções puras e streaming hash**

```typescript
export function isMemberAtVersion(
  interval: { addedInVersion: number; removedInVersion: number | null }, version: number,
): boolean {
  return interval.addedInVersion <= version &&
    (interval.removedInVersion === null || interval.removedInVersion > version)
}

export function convergeDraftDelta(
  published: boolean, current: 'add' | 'remove' | null, action: 'add' | 'remove',
): 'add' | 'remove' | null {
  const desired = action === 'add'
  if (desired === published) return null
  return desired ? 'add' : 'remove'
}
```

`computeCanonicalMembershipHash` recebe `Iterable<string> | AsyncIterable<string>` já ordenado pela query Mongo, valida monotonicidade, ignora somente duplicata adjacente e alimenta incrementalmente SHA-256 com `concierge-collection-membership\0`, `schemaVersion`, `\0`, e cada `curationId + '\n'`. O caller que parte de input compacto normaliza/sort antes; publish/manifests nunca criam array completo. Testes cobrem stream ordenado, duplicata adjacente, input fora de ordem rejeitado e schema version diferente.

- [ ] **Step 4: Rodar testes e typecheck**

Run:

```bash
npm run test:admin -- --run tests/unit/collections
npm run typecheck:admin
```

Expected: todos PASS, sem ordenar significado editorial em DTO/UI.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/collections apps/admin/tests/unit/collections
git commit -m "feat(collections): projetar intervals delta e hash"
```

---

### Task 4: Enfileirar e aplicar operações de draft atomicamente

**Files:**
- Create: `concierge-api-v3/app/models/catalog.py`
- Create: `concierge-api-v3/app/services/catalog_service.py`
- Create: `concierge-api-v3/app/api/catalog.py`
- Modify: `concierge-api-v3/main.py`
- Modify: `contracts/openapi/fastapi-admin-internal.v1.json` (via geração)
- Modify: `packages/fastapi-client/src/generated.ts` (via geração)
- Create: `concierge-api-v3/tests/factories.py`
- Test: `concierge-api-v3/tests/test_catalog_resolve.py`
- Create: `apps/admin/src/operations/types.ts`
- Create: `apps/admin/src/operations/idempotency.ts`
- Create: `apps/admin/src/operations/enqueue.ts`
- Create: `apps/admin/src/operations/apply-draft-operation.ts`
- Create: `apps/admin/src/jobs/applyDraftOperationTask.ts`
- Create: `apps/admin/src/payload/endpoints/operations.ts`
- Modify: `apps/admin/payload.config.ts`
- Test: `apps/admin/tests/unit/operations/idempotency.test.ts`
- Test: `apps/admin/tests/integration/worker/draft-operation.int.test.ts`
- Test: `apps/admin/tests/integration/worker/draft-operation-concurrency.int.test.ts`
- Create: `apps/admin/tests/integration/support/collection-fixtures.ts`

**Interfaces:**
- Consumes: Task 3, `CreateDraftOperationCommand`, `requireCurrentAdmin`.
- Produces: `POST /api/v3/catalog/curations/resolve`; `resolveCurations(ids, actorSubject)`; `enqueueDraftOperation(command)`, `applyDraftOperation(operationId, lease)`, Payload task `apply-draft-operation`, endpoints create/get/cancel.

- [ ] **Step 1: Escrever testes de idempotência e invisibilidade do staging**

```typescript
test('same key/same hash returns original; different hash conflicts', async () => {
  const first = await enqueueDraftOperation(command({ key: 'k', hash: 'h1' }))
  const retry = await enqueueDraftOperation(command({ key: 'k', hash: 'h1' }))
  expect(retry.id).toBe(first.id)
  await expect(enqueueDraftOperation(command({ key: 'k', hash: 'h2' })))
    .rejects.toMatchObject({ status: 409, code: 'idempotency_conflict' })
})

test('crash before CAS leaves visible revision unchanged', async () => {
  const operation = await seedOperation({ curationIds: ['c1', 'c2'] })
  await expect(runUntilCheckpoint(operation.id, 'before_commit')).rejects.toThrow('simulated_crash')
  expect((await loadCollection(operation.collectionId)).draftRevision).toBe(0)
  expect(await visibleDraftChanges(operation.collectionId)).toEqual([])
})
```

```python
from app.core.config import settings

def test_resolve_accepts_selectable_statuses_and_rejects_archived(
    client, test_db, admin_auth_headers,
):
    test_db.curations.insert_many([
        active_curation(curation_id="c-active", status="active"),
        active_curation(curation_id="c-draft", status="draft"),
        active_curation(curation_id="c-old", status="archived"),
    ])
    response = client.post(
        "/api/v3/catalog/curations/resolve",
        headers={
            "X-CMS-Service-Key": settings.cms_service_key_value,
            "X-CMS-Actor-Id": "cms-admin-test",
        },
        json={"curation_ids": ["c-active", "c-draft", "c-old", "missing"]},
    )
    assert response.status_code == 200
    assert response.json() == {
        "eligible_ids": ["c-active", "c-draft"],
        "rejected": [
            {"curation_id": "c-old", "reason": "ineligible_status"},
            {"curation_id": "missing", "reason": "not_found"},
        ],
    }
```

`collection-fixtures.ts` exporta `seedOperation({curationIds})`, `runUntilCheckpoint(operationId, checkpoint)`, `loadCollection`, `visibleDraftChanges`, `seedPublishedWithDirtyDraft`, `runPublishWithCrash` e `loadOperation`; cada helper grava apenas no `concierge-cms-test`, recebe IDs fixos por teste e apaga os documentos no `afterEach`.

- [ ] **Step 2: Rodar e confirmar falhas**

Run:

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_catalog_resolve.py -v
cd .. && npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/draft-operation.int.test.ts
```

Expected: FAIL/404 porque resolve/enqueue/task não existem.

- [ ] **Step 3: Implementar fila, lease, staging e CAS**

O novo router FastAPI aceita no máximo 500 IDs, exige `X-CMS-Service-Key` e `X-CMS-Actor-Id`, recarrega esse actor como admin e resolve somente Curations existentes cujo status é `active`, `draft` ou legado `linked`. Ele deduplica preservando a primeira ocorrência e devolve `eligible_ids` mais `rejected[{curation_id,reason}]`; `deleted`/`archived` são `ineligible_status`. Não hidrata Entity e não confunde elegibilidade de seleção com disponibilidade pública.

`tests/factories.py` já nasce nesta task com `active_curation(**overrides)` e `active_entity(**overrides)`: ambos retornam cópias de documentos mínimos válidos com IDs, status, nome/version/timestamps fixos e aplicam apenas os overrides pedidos. O conftest de teste fixa `CMS_SERVICE_KEY=test-cms-key`; o fixture `admin_auth_headers` da fase 02 também garante que `cms-admin-test@example.com` existe antes do resolve interno.

`enqueueDraftOperation` valida `mode='explicit'`, `curationIds.length` entre 1 e 500 e exige `baseDraftRevision`. Primeiro calcula `requestHash` somente sobre input normalizado estável (Collection, action, revision e IDs pedidos); mesma key/hash retorna o registro existente sem nova resolução. Para comando novo, chama `FastApiAdminClient.resolveCurations` com o actor autoritativo. Erros de formato/auth/dependência recusam o comando inteiro; resultados esperados `not_found|ineligible_status|duplicate` ficam num snapshot separado e viram operation items `skipped` com reason, nunca delta. `selectedCount` conserva a cardinalidade lógica. Depois cria `operationSequence` via contador atômico por Collection, retorna 202 e enfileira Payload job na queue `collection-mutations`.

`applyDraftOperation`:

1. só reclama a menor `operationSequence` não terminal;
2. grava `leaseOwner`, `leaseExpiresAt`, incrementa `fencingToken`;
3. introspecta admin;
4. revalida elegibilidade em lotes contra FastAPI e grava novos expected skips se o estado mudou desde enqueue;
5. calcula `targetDraftRevision=current+1` e faz upsert por `(operationId,curationId)` somente dos IDs elegíveis, em lotes de 500, convergindo delta;
6. revalida admin e fence;
7. numa transação curta, faz CAS `{collectionId,draftRevision,draftEpoch,draftState:{$ne:'publishing'}} -> draftRevision+1`, muda a operation de `committing` para `committed` com o mesmo fencing token e insere o audit idempotente;
8. se o CAS não altera exatamente um documento, aborta a transação, marca `conflicted` sob o fence atual e o staging segue invisível;
9. revalida admin/fence antes de cada checkpoint e imediatamente antes da transação.

A projeção de draft só considera items cuja operation está `committed` **e** cujo `targetDraftRevision <= collection.draftRevision`; portanto nem um crash entre staging e commit, nem um commit de operação sem avanço do ponteiro pode tornar linhas visíveis. Quando todos os itens são skipped, não avança `draftRevision` e termina `completed_with_skips`; quando há elegíveis, skipped esperados acompanham o commit atômico. O audit de commit usa chave única `(eventType,operationId)` para ser idempotente após retry.

O endpoint único é:

```text
POST /api/admin/v1/collections/:id/draft/operations
GET  /api/admin/v1/operations/:id
POST /api/admin/v1/operations/:id/cancel
```

Cancelar é permitido até antes de `committing`; após commit retorna 409 e oferece operação compensatória. `423` inclui `blockingJobId` quando `draftState='publishing'`.

- [ ] **Step 4: Rodar integração, concorrência e restart**

Run:

```bash
npm run test:admin -- --run tests/unit/operations
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/draft-operation.int.test.ts tests/integration/worker/draft-operation-concurrency.int.test.ts
npm run generate:contracts
npm run check:contracts
cd concierge-api-v3 && venv/bin/pytest tests/test_catalog_resolve.py -v
```

Expected: PASS para add/add, add/remove, remove/remove, stale If-Match, retry de lote, crash em cada checkpoint, cancel e fence antigo rejeitado.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src apps/admin/tests apps/admin/payload.config.ts concierge-api-v3/app concierge-api-v3/tests/test_catalog_resolve.py concierge-api-v3/main.py contracts packages/fastapi-client
git commit -m "feat(collections): aplicar operacoes de draft por CAS"
```

---

### Task 5: Publicar versão imutável com promoção atômica

**Files:**
- Create: `concierge-api-v3/app/models/distribution.py`
- Create: `concierge-api-v3/app/services/distribution_service.py`
- Create: `concierge-api-v3/app/api/internal_curations.py`
- Modify: `concierge-api-v3/main.py`
- Create: `concierge-api-v3/tests/test_distribution_service.py`
- Modify: `concierge-api-v3/tests/factories.py`
- Create: `apps/admin/src/publishing/types.ts`
- Create: `apps/admin/src/publishing/publish-collection.ts`
- Create: `apps/admin/src/jobs/publishCollectionTask.ts`
- Create: `apps/admin/src/payload/endpoints/publishing.ts`
- Modify: `apps/admin/payload.config.ts`
- Test: `apps/admin/tests/integration/worker/publish.int.test.ts`
- Test: `apps/admin/tests/integration/worker/publish-concurrency.int.test.ts`

**Interfaces:**
- Consumes: intervals/delta, `FastApiAdminClient`, current live Curations/Entities.
- Produces: `POST /api/v3/internal/curations/hydrate`; `enqueuePublish`; `runPublishJob`; `POST /api/admin/v1/collections/:id/publish`; immutable `collection_versions`.

- [ ] **Step 1: Escrever testes de availability e promoção**

```python
from unittest.mock import MagicMock
from pymongo.errors import AutoReconnect

def test_distribution_availability_requires_active_curation_and_entity():
    result = evaluate_public_item(
        {"curation_id": "c1", "status": "draft", "entity_id": "e1"},
        {"entity_id": "e1", "status": "active", "name": "Place"},
    )
    assert result.reason == "curation_not_public"

def test_transient_failure_is_not_unavailable():
    failing_db = MagicMock()
    failing_db.curations.find.side_effect = AutoReconnect("transient test failure")
    with pytest.raises(DistributionDependencyError):
        hydrate_public_items(failing_db, ["c1"])
```

```typescript
test('falha antes da transação mantém current e draft', async () => {
  const collection = await seedPublishedWithDirtyDraft()
  await expect(runPublishWithCrash(collection.id, 'before_promote')).rejects.toThrow()
  const reloaded = await loadCollection(collection.id)
  expect(reloaded.currentPublishedVersion).toBe(1)
  expect(reloaded.draftState).toBe('dirty')
})
```

`tests/factories.py` reutiliza `active_curation(**overrides)`/`active_entity(**overrides)` criados na Task 4; os testes nunca importam dados reais.

- [ ] **Step 2: Rodar e confirmar falhas**

Run:

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_distribution_service.py -v
cd .. && npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/publish.int.test.ts
```

Expected: FAIL por serviços/tasks ausentes.

- [ ] **Step 3: Implementar predicado e publish resumível**

FastAPI cria `AvailabilityReason`, `UnavailableItem`, `PublicCurationItem` allowlisted e `evaluate_public_item`. Somente Curation `active`, Entity `active`, IDs/nome válidos e serialização allowlisted ficam disponíveis; `draft`, legado `linked`, `deleted`, `archived`, entity ausente/inactive e schema inválido geram os reason codes da spec. Erros PyMongo/http não viram unavailable.

O endpoint interno aceita até 500 IDs, exige service key e devolve `items`, `unavailable`, `selected_count`, `available_count`, `unavailable_count`.

`enqueuePublish` exige `If-Match`/idempotency, prova ausência de operation não terminal e de outro publish, fixa metadata snapshot + `draftEpoch` + `draftRevision`, e faz CAS de `draftState` para `publishing` antes de criar/enfileirar o job. Corrida com operation/publish retorna 409/423 sem job órfão; criação do job, lock e audit de enqueue ficam numa transação curta. Retry da mesma key recupera o mesmo job.

`runPublishJob` segue os dez passos da spec, com checkpoints `locked`, `intervals_applied`, `version_ready`, `validated`, `promoted`. Abre/fecha intervals idempotentemente para `newVersion`, calcula hash, cria version `ready`, revalida role/fence/revision e promove em sessão Mongo:

```typescript
const publishedAt = new Date()
const publicationAuditDocument = {
  eventKey: `collection.published:${jobId}`,
  eventType: 'collection.published', actorId, requestId, collectionId,
  publicationJobId: jobId, beforeRevision: collection.revision,
  afterRevision: collection.revision + 1, metadata: { version: nextVersion },
  createdAt: publishedAt,
}
await session.withTransaction(async () => {
  await versions.updateOne(
    { id: versionId, status: 'ready' },
    { $set: { status: 'published', publishedAt, publishedBy: actorId } }, { session },
  )
  const result = await collections.updateOne(
    { _id: collectionId, revision: fixedCollectionRevision,
      lifecycle: { $ne: 'archived' }, draftRevision: fixedRevision, draftEpoch: fixedEpoch,
      draftState: 'publishing', publishFencingToken: fence },
    { $set: { currentPublishedVersion: nextVersion, lifecycle: 'published', everPublished: true,
      draftBaseVersion: nextVersion, draftEpoch: crypto.randomUUID(), draftRevision: 0,
      draftState: 'clean', publishedSelectedCount: selectedCount, draftSelectedCount: selectedCount },
      $inc: { revision: 1 } },
    { session },
  )
  if (result.modifiedCount !== 1) throw new PublishConflictError()
  await publishJobs.updateOne(
    { id: jobId, status: 'committing', fencingToken: fence },
    { $set: { status: 'completed', completedAt: publishedAt, leaseExpiresAt: null } },
    { session },
  )
  await auditEvents.updateOne(
    { eventKey: `collection.published:${jobId}` },
    { $setOnInsert: publicationAuditDocument }, { upsert: true, session },
  )
})
```

Validar `modifiedCount === 1` também para version e job; qualquer mismatch lança dentro da transação e impede a troca do ponteiro.

Se `unavailable_count > 0`, endpoint exige `confirmUnavailable=true` ligado ao count/revision observado; mismatch retorna 409. Intervals de versão nunca promovida não ficam ativos porque o ponteiro não alcança a versão.

Adicionar `POST /api/admin/v1/collections/:id/versions/:version/restore-as-draft`: ele compara em cursor/batches a versão histórica com a current, enfileira deltas para o draft e audita `historical_version_restored_to_draft`; não move o ponteiro publicado. O usuário revisa o diff e publica, criando número monotônico novo.

- [ ] **Step 4: Rodar unit/integration/concurrency/restart**

Run:

```bash
cd concierge-api-v3 && venv/bin/pytest tests/test_distribution_service.py -v
cd ..
npm run test:integration --workspace=@concierge/admin -- tests/integration/worker/publish.int.test.ts tests/integration/worker/publish-concurrency.int.test.ts
```

Expected: PASS para dois publishes, pending operation, role revogada, takeover após lease, fence antigo, hash/count mismatch e crash/retry em cada checkpoint.

- [ ] **Step 5: Commit**

```bash
git add concierge-api-v3/app concierge-api-v3/tests apps/admin/src apps/admin/tests apps/admin/payload.config.ts
git commit -m "feat(collections): publicar versoes de forma atomica"
```

---

### Task 6: Entregar views de Members, Diff, Versions e Activity

**Files:**
- Create: `apps/admin/src/components/collections/CollectionViews.tsx`
- Create: `apps/admin/src/components/collections/MembersView.tsx`
- Create: `apps/admin/src/components/collections/DraftDiffView.tsx`
- Create: `apps/admin/src/components/collections/VersionsView.tsx`
- Create: `apps/admin/src/components/collections/ActivityView.tsx`
- Create: `apps/admin/src/components/overview/OverviewView.tsx`
- Create: `apps/admin/src/payload/endpoints/collection-reads.ts`
- Modify: `apps/admin/src/payload/collections/Collections.ts`
- Modify: `apps/admin/payload.config.ts`
- Test: `apps/admin/tests/unit/components/collection-views.test.tsx`
- Test: `apps/admin/tests/e2e/collections/publish.spec.ts`

**Interfaces:**
- Consumes: lifecycle/diff/version/audit endpoints cursor-paginados.
- Produces: tabs `Overview`, `Members`, `Draft Changes`, `Versions`, `Distribution`, `Activity`; publish confirmation; exports JSON/CSV de diff server-side.

- [ ] **Step 1: Escrever teste da UI sem ordem editorial**

```typescript
test('Collection view mostra contagens e não oferece reorder', async () => {
  render(<CollectionViews collection={publishedDirtyCollection} />)
  expect(screen.getByText('12,000 selected')).toBeVisible()
  expect(screen.getByRole('tab', { name: 'Draft Changes' })).toBeVisible()
  expect(screen.queryByText(/rank|position|reorder/i)).toBeNull()
  expect(screen.getByRole('button', { name: 'Publish new version' })).toBeEnabled()
})
```

O teste importa `render`/`screen` de `@testing-library/react`, usa `publishedDirtyCollection` local com counts/revision explícitos e mocka somente os quatro endpoints de leitura; nenhuma fixture global implícita.

- [ ] **Step 2: Rodar e confirmar componente ausente**

Run: `npm run test:admin -- --run tests/unit/components/collection-views.test.tsx`

Expected: FAIL por import ausente.

- [ ] **Step 3: Implementar views e reads paginadas**

Endpoints `members`, `draft/diff`, `versions`, `activity` aceitam `limit<=200`, cursor opaco e filtros server-side; diff nunca materializa tudo no browser. UI usa componentes Payload para metadata pequena e custom views para as tabs; publish mostra base/current/next, adds/removes/unavailable e exige confirmação quando unavailable > 0. Collection archived fica read-only com ação Restore.

Não incluir drag handle, número de ordem ou relationship field de Curations.

```typescript
export interface CursorPage<T> { items: T[]; nextCursor: string | null }
export type MemberPage = CursorPage<{ curationId: string; available: boolean; reasonCode?: string }>
export type DraftDiffPage = CursorPage<{ curationId: string; desiredState: 'add' | 'remove'; operationId: string }>
export type VersionPage = CursorPage<{ version: number; selectedCount: number; membershipHash: string; publishedAt: string }>
export type ActivityPage = CursorPage<{ eventType: string; actorId: string; createdAt: string }>
export interface CollectionReadAdapter {
  members(input: { collectionId: string; version: number; cursor?: string; availability?: string }): Promise<MemberPage>
  draftDiff(input: { collectionId: string; cursor?: string; desiredState?: 'add' | 'remove' }): Promise<DraftDiffPage>
  versions(input: { collectionId: string; cursor?: string }): Promise<VersionPage>
  activity(input: { collectionId: string; cursor?: string }): Promise<ActivityPage>
}
```

`MembersView` oferece filtro `unavailable` e lista reason code paginada. `VersionsView` oferece “Restore as draft”, nunca “set current”. `OverviewView` agrega drafts dirty/failed, jobs ativos/antigos, publicações recentes e Collections com unavailable crescente, com links para os recursos reais.

- [ ] **Step 4: Rodar UI/E2E e gate do domínio**

Run:

```bash
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run test:e2e --workspace=@concierge/admin -- tests/e2e/collections/publish.spec.ts
npm run typecheck:admin
npm run build:admin
```

Expected: PASS; E2E cria v1, acumula draft, comprova v1 estável, publica v2, arquiva/restaura a mesma v2.

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(cms): entregar gestao visual de Collections"
```

## Gate da fase

```bash
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
cd concierge-api-v3
venv/bin/pytest tests/test_distribution_service.py -v
venv/bin/pytest -m "not integration and not external_api and not mongo and not openai" -q
```

Expected: exit 0; teste semântico comprova que nenhuma mutação muda produção antes da promoção final bem-sucedida.
