# Collections Admin Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Collections domain and presentational React views into a complete Admin workflow for list, create, detail, metadata, lifecycle, paginated reads, publish and historical restore.

**Architecture:** Keep Payload custom endpoints as the only mutation boundary and keep `CollectionViews` presentational. Add a typed browser admin client plus controller/workspace components under `apps/admin/src/components/collections`, mount them through custom Next Admin pages, and reuse the existing cursor-paginated read endpoints and worker-backed publish pipeline.

**Tech Stack:** Next.js 16.2.12, React 19.2.6, TypeScript 5.9.3, Payload CMS 3.86.0, Vitest 4.1.1, Testing Library, Playwright, MongoDB/Payload Jobs.

**Spec:** `docs/superpowers/specs/2026-09-02-collections-admin-convergence-design.md`

## Global Constraints

- Do not change the N:N Collection data model.
- Do not add Collection ordering, rank or position fields.
- Never use native Payload create/update/delete for Collection lifecycle or membership.
- Unsafe commands continue to use `If-Match`, `Idempotency-Key` where required, and `X-Request-Id`.
- No optimistic membership mutation in the browser.
- Lists remain cursor-paginated; never load the full membership universe into the browser.
- Existing FastAPI role revalidation and `collections_admin` feature flag remain authoritative.
- No database migration unless a real missing index is discovered by a failing integration test.
- Preserve the existing direct API publish E2E as a lower-level regression.

---

### Task 1: Add the typed Collections Admin client and close list/read DTOs

**Files:**
- Create: `apps/admin/src/collections/admin-client.ts`
- Modify: `apps/admin/src/collections/types.ts`
- Modify: `apps/admin/src/payload/endpoints/collections.ts`
- Test: `apps/admin/tests/unit/collections/admin-client.test.ts`
- Test: `apps/admin/tests/unit/payload/collection-list-endpoint.test.ts`

**Interfaces:**
- Consumes: existing `/api/admin/v1/collections`, `/members`, `/draft/diff`, `/versions`, `/activity`, publish/archive/restore/restore-as-draft endpoints.
- Produces:

```typescript
export type CollectionLifecycle = 'draft' | 'published' | 'archived'
export type CollectionDraftState = 'clean' | 'dirty' | 'publishing' | 'failed'

export interface AdminCollectionRecord {
  id: string
  slug: string
  title: string
  description: string | null
  lifecycle: CollectionLifecycle
  currentPublishedVersion: number | null
  draftRevision: number
  draftState: CollectionDraftState
  publishedSelectedCount: number
  draftSelectedCount: number
  revision: number
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export class CollectionsAdminError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly retryable: boolean) {
    super(code)
  }
}

export interface CollectionsAdminClient {
  list(): Promise<AdminCollectionRecord[]>
  get(collectionId: string): Promise<AdminCollectionRecord>
  create(input: { slug: string; title: string; description?: string | null }, commandId?: string): Promise<AdminCollectionRecord>
  patchMetadata(collection: AdminCollectionRecord, input: { title?: string; description?: string | null }): Promise<AdminCollectionRecord>
  archive(collection: AdminCollectionRecord): Promise<AdminCollectionRecord>
  restore(collection: AdminCollectionRecord): Promise<AdminCollectionRecord>
  publish(collection: AdminCollectionRecord, input: { confirmUnavailable: boolean; expectedUnavailableCount?: number }, commandId?: string): Promise<{ id: string; status: string }>
  restoreVersionAsDraft(collectionId: string, version: number): Promise<{ operationId?: string; status?: string }>
  members(collectionId: string, version: number, cursor?: string): Promise<CursorPage<MemberRow>>
  draftDiff(collectionId: string, cursor?: string): Promise<CursorPage<DraftDiffRow>>
  versions(collectionId: string, cursor?: string): Promise<CursorPage<VersionRow>>
  activity(collectionId: string, cursor?: string): Promise<CursorPage<ActivityRow>>
}
```

- [ ] **Step 1: Write the failing admin-client tests**

Create `apps/admin/tests/unit/collections/admin-client.test.ts` with explicit fetch assertions:

```typescript
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createBrowserCollectionsAdminClient, CollectionsAdminError } from '../../../src/collections/admin-client'

const collection = {
  id: '507f1f77bcf86cd799439011', slug: 'victoria', title: 'Victoria', description: null,
  lifecycle: 'published' as const, currentPublishedVersion: 2, draftRevision: 7,
  draftState: 'dirty' as const, publishedSelectedCount: 8, draftSelectedCount: 9, revision: 12,
}

afterEach(() => vi.restoreAllMocks())

describe('CollectionsAdminClient', () => {
  test('patch metadata sends If-Match and command headers', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...collection, title: 'Victoria 2027', revision: 13 }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    const client = createBrowserCollectionsAdminClient({ fetcher, uuid: () => '11111111-1111-4111-8111-111111111111' })

    await client.patchMetadata(collection, { title: 'Victoria 2027' })

    expect(fetcher).toHaveBeenCalledWith('/api/admin/v1/collections/507f1f77bcf86cd799439011', expect.objectContaining({
      method: 'PATCH', credentials: 'same-origin',
      headers: expect.objectContaining({
        'If-Match': '12',
        'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
        'X-Request-Id': '11111111-1111-4111-8111-111111111111',
      }),
    }))
  })

  test('publish preserves an explicit logical command id', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'job-1', status: 'queued' }), {
      status: 202, headers: { 'content-type': 'application/json' },
    }))
    const client = createBrowserCollectionsAdminClient({ fetcher, uuid: () => 'request-1' })

    await client.publish(collection, { confirmUnavailable: true, expectedUnavailableCount: 2 }, 'publish-command-1')

    expect(fetcher).toHaveBeenCalledWith('/api/admin/v1/collections/507f1f77bcf86cd799439011/publish', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'If-Match': '12', 'Idempotency-Key': 'publish-command-1', 'X-Request-Id': 'request-1' }),
    }))
  })

  test.each([
    [401, 'unauthorized', false], [403, 'forbidden', false], [409, 'revision_conflict', false],
    [412, 'precondition_failed', false], [423, 'locked', true], [503, 'unavailable', true],
  ])('normalizes HTTP %i into CollectionsAdminError', async (status, code, retryable) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code }), {
      status, headers: { 'content-type': 'application/json' },
    }))
    const client = createBrowserCollectionsAdminClient({ fetcher, uuid: () => 'request-1' })
    await expect(client.get(collection.id)).rejects.toEqual(new CollectionsAdminError(code, status, retryable))
  })
})
```

- [ ] **Step 2: Run the client test and verify the module is missing**

Run:

```bash
npm run test:admin -- --run tests/unit/collections/admin-client.test.ts
```

Expected: FAIL because `src/collections/admin-client.ts` does not exist.

- [ ] **Step 3: Write a failing list-endpoint shape test**

Create `apps/admin/tests/unit/payload/collection-list-endpoint.test.ts` using the endpoint factory with the same lightweight Payload model stubs used by existing payload endpoint tests. Assert the list row contains all fields required by `AdminCollectionRecord`:

```typescript
expect(await response.json()).toEqual({ items: [{
  id: '507f1f77bcf86cd799439011', slug: 'victoria', title: 'Victoria', description: null,
  lifecycle: 'published', currentPublishedVersion: 2, draftRevision: 7, draftState: 'dirty',
  publishedSelectedCount: 8, draftSelectedCount: 9, revision: 12,
}] })
```

- [ ] **Step 4: Implement the minimal typed client and extend the list DTO**

`admin-client.ts` must use one internal `requestJson<T>` helper. It must always use `credentials:'same-origin'`, set `Accept: application/json`, and set `Content-Type` only when a body is present.

Use the following error normalization:

```typescript
function retryableStatus(status: number) {
  return status === 423 || status === 503 || status >= 500
}

async function requestJson<T>(fetcher: typeof fetch, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetcher(path, { ...init, credentials: 'same-origin' })
  } catch {
    throw new CollectionsAdminError('network_error', 0, true)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null
    throw new CollectionsAdminError(body?.code ?? `http_${response.status}`, response.status, retryableStatus(response.status))
  }
  return response.json() as Promise<T>
}
```

Extend the existing GET list projection in `apps/admin/src/payload/endpoints/collections.ts` to include `description`, `currentPublishedVersion`, `publishedSelectedCount` and `revision`; keep archived rows available to the management workspace by removing the current `{ lifecycle: { $ne: 'archived' } }` filter. Sorting remains by title.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
npm run test:admin -- --run tests/unit/collections/admin-client.test.ts tests/unit/payload/collection-list-endpoint.test.ts
npm run typecheck:admin
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/collections apps/admin/src/payload/endpoints/collections.ts apps/admin/tests/unit/collections apps/admin/tests/unit/payload/collection-list-endpoint.test.ts
git commit -m "feat(cms): add typed collections admin client"
```

---

### Task 2: Build the custom Collection list and create flow

**Files:**
- Create: `apps/admin/app/(payload)/admin/collections/page.tsx`
- Create: `apps/admin/src/components/collections/CollectionsWorkspace.tsx`
- Create: `apps/admin/src/components/collections/NewCollectionDialog.tsx`
- Modify: `apps/admin/src/styles/admin.css`
- Test: `apps/admin/tests/unit/components/collections-workspace.test.tsx`

**Interfaces:**
- Consumes: `CollectionsAdminClient.list()` and `.create()` from Task 1.
- Produces: custom `/admin/collections` management page; list filtering and new Collection creation.

- [ ] **Step 1: Write failing UI tests for list, archived visibility and create**

```typescript
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CollectionsWorkspace } from '../../../src/components/collections/CollectionsWorkspace'

const rows = [
  { id: '1'.repeat(24), slug: 'victoria', title: 'Victoria', description: null, lifecycle: 'published' as const,
    currentPublishedVersion: 2, draftRevision: 7, draftState: 'dirty' as const, publishedSelectedCount: 8, draftSelectedCount: 9, revision: 12 },
  { id: '2'.repeat(24), slug: 'old', title: 'Old', description: null, lifecycle: 'archived' as const,
    currentPublishedVersion: 1, draftRevision: 0, draftState: 'clean' as const, publishedSelectedCount: 4, draftSelectedCount: 4, revision: 5 },
]

afterEach(cleanup)

test('lists published and archived Collections with management state', async () => {
  const client = { list: vi.fn().mockResolvedValue(rows) }
  render(<CollectionsWorkspace client={client as never} />)
  expect(await screen.findByRole('link', { name: 'Victoria' })).toHaveAttribute('href', `/admin/collections/${rows[0].id}`)
  expect(screen.getByRole('link', { name: 'Old' })).toBeVisible()
  expect(screen.getByText('dirty')).toBeVisible()
  expect(screen.getByText('Version 2')).toBeVisible()
})

test('creates through the command API and navigates to the detail page', async () => {
  const created = { ...rows[0], id: '3'.repeat(24), slug: 'new', title: 'New' }
  const client = { list: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue(created) }
  const navigate = vi.fn()
  render(<CollectionsWorkspace client={client as never} navigate={navigate} />)

  fireEvent.click(await screen.findByRole('button', { name: 'New Collection' }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New' } })
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'new' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }))

  await waitFor(() => expect(client.create).toHaveBeenCalledWith({ title: 'New', slug: 'new', description: null }))
  expect(navigate).toHaveBeenCalledWith(`/admin/collections/${created.id}`)
})
```

- [ ] **Step 2: Run the workspace test and verify imports fail**

Run:

```bash
npm run test:admin -- --run tests/unit/components/collections-workspace.test.tsx
```

Expected: FAIL because `CollectionsWorkspace` and `NewCollectionDialog` do not exist.

- [ ] **Step 3: Implement the workspace and dialog**

`CollectionsWorkspace` owns only management-list state: `rows`, `loading`, `error`, `query`, `lifecycleFilter`, `draftStateFilter`, and dialog visibility. It receives `client` and optional `navigate`; browser defaults are `createBrowserCollectionsAdminClient()` and `window.location.assign`.

Filtering is local over the small Collection management list:

```typescript
const visible = rows.filter((row) => {
  const q = query.trim().toLocaleLowerCase()
  return (!q || `${row.title} ${row.slug}`.toLocaleLowerCase().includes(q)) &&
    (lifecycle === 'all' || row.lifecycle === lifecycle) &&
    (draftState === 'all' || row.draftState === draftState)
})
```

`NewCollectionDialog` is a real `<dialog open>`-style accessible surface or equivalent `role="dialog"` with labelled title. It uses normal inputs, no `window.prompt`, disables submit while pending, and displays normalized error codes without raw server bodies.

- [ ] **Step 4: Mount the custom Next Admin route**

Create:

```typescript
// apps/admin/app/(payload)/admin/collections/page.tsx
import { CollectionsWorkspace } from '../../../../src/components/collections/CollectionsWorkspace'

export default function CollectionsPage() {
  return <CollectionsWorkspace />
}
```

Add focused styles to `apps/admin/src/styles/admin.css` using existing design tokens/classes. Do not introduce a new CSS framework.

- [ ] **Step 5: Run unit tests, typecheck and build**

Run:

```bash
npm run test:admin -- --run tests/unit/components/collections-workspace.test.tsx
npm run typecheck:admin
npm run build:admin
```

Expected: PASS and Next route list includes `/admin/collections`.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/'(payload)'/admin/collections apps/admin/src/components/collections apps/admin/src/styles/admin.css apps/admin/tests/unit/components/collections-workspace.test.tsx
git commit -m "feat(cms): add collections management workspace"
```

---

### Task 3: Build the live Collection detail controller and paginated tabs

**Files:**
- Create: `apps/admin/app/(payload)/admin/collections/[id]/page.tsx`
- Create: `apps/admin/src/components/collections/CollectionDetailWorkspace.tsx`
- Modify: `apps/admin/src/components/collections/CollectionViews.tsx`
- Modify: `apps/admin/src/components/collections/MembersView.tsx`
- Modify: `apps/admin/src/components/collections/DraftDiffView.tsx`
- Modify: `apps/admin/src/components/collections/VersionsView.tsx`
- Modify: `apps/admin/src/components/collections/ActivityView.tsx`
- Test: `apps/admin/tests/unit/components/collection-detail-workspace.test.tsx`
- Test: `apps/admin/tests/unit/components/collection-views.test.tsx`

**Interfaces:**
- Consumes: `CollectionsAdminClient.get/members/draftDiff/versions/activity`.
- Produces: live `/admin/collections/[id]` detail page and tab data pagination.

- [ ] **Step 1: Write a failing detail-controller test**

```typescript
test('loads Collection and tab previews from live cursor endpoints', async () => {
  const client = {
    get: vi.fn().mockResolvedValue(collection),
    members: vi.fn().mockResolvedValue({ items: [{ curationId: 'c1' }], nextCursor: 'm2' }),
    draftDiff: vi.fn().mockResolvedValue({ items: [{ curationId: 'c2', desiredState: 'add', operationId: 'op1' }], nextCursor: null }),
    versions: vi.fn().mockResolvedValue({ items: [{ version: 2, selectedCount: 8, membershipHash: 'a'.repeat(64) }], nextCursor: null }),
    activity: vi.fn().mockResolvedValue({ items: [{ eventType: 'collection.published', actorId: 'admin-1', createdAt: '2026-09-01T12:00:00Z' }], nextCursor: null }),
  }

  render(<CollectionDetailWorkspace collectionId={collection.id} client={client as never} />)

  expect(await screen.findByRole('heading', { name: collection.title })).toBeVisible()
  await waitFor(() => {
    expect(client.members).toHaveBeenCalledWith(collection.id, collection.currentPublishedVersion, undefined)
    expect(client.draftDiff).toHaveBeenCalledWith(collection.id, undefined)
    expect(client.versions).toHaveBeenCalledWith(collection.id, undefined)
    expect(client.activity).toHaveBeenCalledWith(collection.id, undefined)
  })
})
```

Add a second test that clicks `Load more members`, supplies `nextCursor='m2'`, and asserts the second page is appended instead of replacing the first.

- [ ] **Step 2: Run and verify the controller is missing**

Run:

```bash
npm run test:admin -- --run tests/unit/components/collection-detail-workspace.test.tsx
```

Expected: FAIL because `CollectionDetailWorkspace` does not exist.

- [ ] **Step 3: Implement the controller with separate page-state per tab**

Use one focused state object per read model:

```typescript
interface PageState<T> {
  items: T[]
  nextCursor: string | null
  loading: boolean
  error: string | null
}
```

The controller loads the Collection first, then loads preview pages in parallel. Members are loaded only when a published version exists; a never-published Collection gets an empty members page.

Expose callbacks to `CollectionViews`:

```typescript
export interface CollectionViewActions {
  onLoadMoreMembers?: () => void
  onLoadMoreDiff?: () => void
  onLoadMoreVersions?: () => void
  onLoadMoreActivity?: () => void
}
```

`CollectionViews` remains presentational and receives `preview`, `pagination` and action callbacks. Child list components get optional `loading`, `hasMore` and `onLoadMore`; they render a `Load more` button only when `hasMore` is true.

- [ ] **Step 4: Mount the detail route with strict Mongo ObjectId validation delegated to the API**

```typescript
// apps/admin/app/(payload)/admin/collections/[id]/page.tsx
import { CollectionDetailWorkspace } from '../../../../../src/components/collections/CollectionDetailWorkspace'

export default async function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <CollectionDetailWorkspace collectionId={id} />
}
```

Do not duplicate endpoint ObjectId rules in the page.

- [ ] **Step 5: Run detail and existing presentational regressions**

Run:

```bash
npm run test:admin -- --run tests/unit/components/collection-detail-workspace.test.tsx tests/unit/components/collection-views.test.tsx
npm run typecheck:admin
npm run build:admin
```

Expected: PASS; existing no-reorder assertions stay green.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/'(payload)'/admin/collections/'[id]' apps/admin/src/components/collections apps/admin/tests/unit/components
git commit -m "feat(cms): connect collection detail to live reads"
```

---

### Task 4: Wire metadata, archive and restore commands into the detail workspace

**Files:**
- Create: `apps/admin/src/components/collections/CollectionMetadataForm.tsx`
- Modify: `apps/admin/src/components/collections/CollectionDetailWorkspace.tsx`
- Modify: `apps/admin/src/components/collections/CollectionViews.tsx`
- Test: `apps/admin/tests/unit/components/collection-commands.test.tsx`

**Interfaces:**
- Consumes: `CollectionsAdminClient.patchMetadata/archive/restore`.
- Produces: metadata edit and lifecycle commands with server-state reload.

- [ ] **Step 1: Write failing command tests**

```typescript
test('metadata save uses the currently loaded revision and refreshes server state', async () => {
  const updated = { ...collection, title: 'Victoria 2027', revision: collection.revision + 1 }
  const client = detailClient({ patchMetadata: vi.fn().mockResolvedValue(updated) })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={client as never} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Edit metadata' }))
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Victoria 2027' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save metadata' }))

  await waitFor(() => expect(client.patchMetadata).toHaveBeenCalledWith(expect.objectContaining({ revision: collection.revision }), {
    title: 'Victoria 2027', description: collection.description,
  }))
  expect(await screen.findByRole('heading', { name: 'Victoria 2027' })).toBeVisible()
})

test('stale revision reloads instead of applying optimistic metadata', async () => {
  const client = detailClient({
    patchMetadata: vi.fn().mockRejectedValue(new CollectionsAdminError('revision_conflict', 409, false)),
    get: vi.fn().mockResolvedValueOnce(collection).mockResolvedValueOnce({ ...collection, title: 'Changed elsewhere', revision: 13 }),
  })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={client as never} />)
  // edit/save as above
  expect(await screen.findByText('Collection changed on the server. The latest state has been reloaded.')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Changed elsewhere' })).toBeVisible()
})
```

Add archive/restore tests that assert `window.confirm` is not used; use an in-component confirmation panel/dialog with explicit buttons.

- [ ] **Step 2: Run and verify command controls are absent**

Run:

```bash
npm run test:admin -- --run tests/unit/components/collection-commands.test.tsx
```

Expected: FAIL because metadata and lifecycle actions are not wired.

- [ ] **Step 3: Implement metadata editing without allowing slug mutation after creation**

`CollectionMetadataForm` edits `title` and `description` only. It displays slug as read-only text. This deliberately avoids creating a client rule that could diverge from server slug immutability.

On successful command, replace the controller's Collection state with the response object and reload previews if counts/state changed.

On `409/412`, call `client.get(collectionId)` before showing the conflict message. On `423`, show `Publication in progress. Collection changes are temporarily locked.` and keep controls disabled until refresh.

- [ ] **Step 4: Add explicit lifecycle confirmation surfaces**

`CollectionViews` receives optional callbacks:

```typescript
onEditMetadata?: () => void
onArchive?: () => void
onRestore?: () => void
```

The controller owns confirmation state. Archive text must say the Collection becomes unavailable to external distribution immediately; restore text must say the same `currentPublishedVersion` is restored.

- [ ] **Step 5: Run command tests and domain regressions**

Run:

```bash
npm run test:admin -- --run tests/unit/components/collection-commands.test.tsx tests/unit/components/collection-views.test.tsx
npm run test:integration --workspace=@concierge/admin -- tests/integration/payload/collection-lifecycle.int.test.ts
npm run typecheck:admin
```

Expected: PASS; lifecycle integration still proves slug immutability, CAS, archive/restore and audit.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/components/collections apps/admin/tests/unit/components/collection-commands.test.tsx
git commit -m "feat(cms): wire collection metadata and lifecycle commands"
```

---

### Task 5: Wire publish and historical restore, then add UI-driven E2E

**Files:**
- Create: `apps/admin/src/components/collections/PublishCollectionDialog.tsx`
- Modify: `apps/admin/src/components/collections/CollectionDetailWorkspace.tsx`
- Modify: `apps/admin/src/components/collections/CollectionViews.tsx`
- Modify: `apps/admin/src/components/collections/VersionsView.tsx`
- Create: `apps/admin/tests/unit/components/collection-publish.test.tsx`
- Create: `apps/admin/tests/e2e/collections/admin-ui-lifecycle.spec.ts`
- Modify: `apps/admin/tests/e2e/collections/publish.spec.ts` only if shared helpers are extracted without changing its direct-API coverage.

**Interfaces:**
- Consumes: `CollectionsAdminClient.publish`, `.restoreVersionAsDraft`, `.get`, `.draftDiff`, `.versions`, `.activity`.
- Produces: operator-driven publish and restore-as-draft UI.

- [ ] **Step 1: Write failing publish confirmation tests**

Use draft-diff preview counts as the initial publish summary and exercise the server confirmation handshake:

```typescript
test('publish retries only after server reports the observed unavailable count', async () => {
  const publish = vi.fn()
    .mockRejectedValueOnce(new CollectionsAdminError('unavailable_confirmation_required', 409, false))
    .mockResolvedValueOnce({ id: 'job-1', status: 'queued' })
  const client = detailClient({ publish })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={client as never} />)

  fireEvent.click(await screen.findByRole('button', { name: 'Publish new version' }))
  expect(screen.getByRole('dialog', { name: 'Publish Collection' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

  expect(await screen.findByText(/availability changed/i)).toBeVisible()
})
```

Because the existing publish endpoint returns `unavailable_confirmation_required` when the expected count mismatches, the UI must not guess counts by brute force. Extend the error parser in `admin-client.ts` to preserve a safe numeric `expectedUnavailableCount`/observed count only if the endpoint already returns it. If the current endpoint does not expose that safe field, add it to the `AdminHttpError` response for this specific code and cover it with a unit endpoint test.

- [ ] **Step 2: Write failing historical restore test**

```typescript
test('restore as draft never changes the displayed published version immediately', async () => {
  const restoreVersionAsDraft = vi.fn().mockResolvedValue({ status: 'queued' })
  const client = detailClient({ restoreVersionAsDraft })
  render(<CollectionDetailWorkspace collectionId={collection.id} client={client as never} />)

  fireEvent.click(await screen.findByRole('tab', { name: 'Versions' }))
  fireEvent.click(screen.getByRole('button', { name: 'Restore version 1 as draft' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore as draft' }))

  await waitFor(() => expect(restoreVersionAsDraft).toHaveBeenCalledWith(collection.id, 1))
  expect(screen.getByText('Published version 2')).toBeVisible()
})
```

- [ ] **Step 3: Implement publish dialog and job polling**

`PublishCollectionDialog` shows:

- current published version or `None`;
- next version (`(currentPublishedVersion ?? 0) + 1`);
- draft selected count;
- add/remove counts from the loaded diff preview;
- server unavailable count when confirmation is required.

The logical publish command gets one UUID stored in dialog state and reused only if the first network outcome is uncertain. A normal server rejection followed by corrected confirmation starts a new command id unless the server contract defines the response as continuation of the same idempotent intent.

After HTTP 202, poll `client.get(collection.id)` every 1 second, with the same 150 second deadline already used by the direct E2E. Terminal success is `draftState === 'clean'` and `currentPublishedVersion` advanced. `draftState === 'failed'` is terminal failure. On success reload diff, versions and activity.

- [ ] **Step 4: Add `Restore as draft` controls to VersionsView**

Change the interface to:

```typescript
export function VersionsView({
  items,
  currentPublishedVersion,
  onRestoreAsDraft,
}: {
  items: readonly VersionRow[]
  currentPublishedVersion?: number | null
  onRestoreAsDraft?: (version: number) => void
})
```

Render a button for historical versions only. Never render `Set current` or direct pointer controls.

- [ ] **Step 5: Add a UI-driven Playwright lifecycle spec**

`apps/admin/tests/e2e/collections/admin-ui-lifecycle.spec.ts` uses the same live-stack gate as `publish.spec.ts` (`CMS_E2E_PUBLISH=1`) and the same handoff setup, but drives the UI after login:

```typescript
await page.goto('/admin/collections')
await page.getByRole('button', { name: 'New Collection' }).click()
await page.getByLabel('Title').fill(`UI Collection ${Date.now()}`)
await page.getByLabel('Slug').fill(`ui-collection-${Date.now()}`)
await page.getByRole('button', { name: 'Create Collection' }).click()
await expect(page).toHaveURL(/\/admin\/collections\/[a-f\d]{24}$/)
await expect(page.getByRole('heading', { name: /UI Collection/ })).toBeVisible()
```

Then use the existing draft-operation API helper or Explorer UI only to seed membership for this first core plan; publish/archive/restore must be driven through the Collection detail UI. Full Explorer-target integration belongs to the next plan.

Assertions:

- publish button queues and eventually shows `Version 1`;
- a second draft does not mutate Version 1 before publish;
- publishing again shows Version 2;
- Versions tab lists both;
- archive makes the detail read-only;
- restore returns lifecycle to published while Version 2 stays current.

- [ ] **Step 6: Run the complete core gate**

Run:

```bash
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
npm run test:collector
```

With the disposable full local stack running, also run:

```bash
CMS_E2E_PUBLISH=1 npm run test:e2e --workspace=@concierge/admin -- tests/e2e/collections/publish.spec.ts tests/e2e/collections/admin-ui-lifecycle.spec.ts
```

Expected: all green; the direct API E2E and UI E2E both prove the publish invariant.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src apps/admin/tests apps/admin/app
git commit -m "feat(cms): complete collection publish lifecycle UI"
```

## Core Plan Gate

This plan is complete only when:

```bash
npm run test:admin
npm run test:integration --workspace=@concierge/admin
npm run typecheck:admin
npm run build:admin
npm run test:collector
```

all exit 0, and the live UI lifecycle E2E passes in the same disposable stack used by Architecture Baseline 1 qualification.

The next implementation plan starts only after this gate: Explorer target-Collection convergence + Operations workspace.
