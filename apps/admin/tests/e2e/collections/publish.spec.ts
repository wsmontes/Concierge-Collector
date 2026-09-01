import { expect, test } from '@playwright/test'

/**
 * Collection publish E2E (requires the full local stack):
 *
 *   1. Handoff: seeds a dev FastAPI session, completes the CMS handoff and
 *      asserts the host-only, HttpOnly, SameSite=Lax CMS session cookie.
 *   2. Creates a Collection, accumulates a draft through the serialized
 *      operation queue and waits for the worker to commit it.
 *   3. Publishes version 1 ("cria v1"), then accumulates a second draft and
 *      proves v1 stays stable while v2 is being drafted.
 *   4. Publishes version 2, archives and restores the very same v2.
 *
 * Gate: run only with CMS_E2E_PUBLISH=1 against a stack that provides:
 *   - CMS web server (baseURL) booted with a `-test` CMS database and
 *     CMS_SERVICE_KEY matching FastAPI's; baseURL must equal CMS_PUBLIC_SERVER_URL
 *     because cookie-authenticated writes enforce a same-origin Origin header;
 *   - CMS worker (`npm run start:worker --workspace=@concierge/admin`) so the
 *     serialized operations and publish jobs actually commit and promote;
 *   - FastAPI (CMS_E2E_FASTAPI_URL, default http://localhost:8000) in
 *     development mode with CMS_ADMIN_ORIGIN/CMS_ADMIN_CALLBACK_URL pointing
 *     at the CMS web server and the same CMS_SERVICE_KEY.
 *
 * The suite leaves one published collection behind in the `-test` CMS
 * database (published collections can never be hard-deleted by design).
 */
const runLivePublish = process.env.CMS_E2E_PUBLISH === '1'
const livePublish = runLivePublish ? test : test.skip

const FASTAPI_URL = process.env.CMS_E2E_FASTAPI_URL || 'http://localhost:8000'

interface CollectionBody {
  id: string
  slug: string
  title: string
  lifecycle: 'draft' | 'published' | 'archived'
  draftState: 'clean' | 'dirty' | 'publishing' | 'failed'
  draftRevision: number
  revision: number
  currentPublishedVersion?: number | null
  publishedSelectedCount?: number
}

function requestId(): string {
  return crypto.randomUUID()
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Request-Id': requestId(), ...extra }
}

/** Cookie-authenticated Admin fetches: unsafe methods need the same-origin Origin. */
function sessionFetch(baseURL: string, sessionCookie: string) {
  const origin = new URL(baseURL).origin
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase()
    const isUnsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    return fetch(`${baseURL}${path}`, {
      ...init,
      headers: {
        ...(isUnsafe ? { Origin: origin } : {}),
        Cookie: `cms_session=${sessionCookie}`,
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    })
  }
}

livePublish('creates v1, drafts v2, proves v1 stable, publishes v2, archives and restores v2', async ({ baseURL, page }) => {
  if (!baseURL) throw new Error('CMS_E2E_BASE_URL is required for the publish E2E suite')
  // O worker do stack processa jobs a cada MINUTO (cron) — v1+v2 com
  // ticks de 60s + primeira compilação das páginas do Next dev passam
  // folgado de 240s; o fluxo completo leva ~5 min.
  test.setTimeout(600_000)

  // ---------------------------------------------------------------------------
  // 1. Session bootstrap: dev FastAPI session + CMS handoff.
  // ---------------------------------------------------------------------------
  const fastApiOrigin = new URL(FASTAPI_URL).origin
  const devLogin = await fetch(`${FASTAPI_URL}/api/v3/auth/dev-login`)
  expect(devLogin.status, 'FastAPI must run in development mode for dev-login').toBe(200)
  const tokens = await devLogin.json() as { access_token?: string; refresh_token?: string }
  expect(tokens.access_token).toBeTruthy()

  await page.context().addCookies([
    { name: 'access_token', value: tokens.access_token ?? '', domain: new URL(fastApiOrigin).hostname, path: '/' },
    { name: 'refresh_token', value: tokens.refresh_token ?? '', domain: new URL(fastApiOrigin).hostname, path: '/' },
  ])

  const callbackResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.origin === new URL(baseURL).origin && url.pathname === '/auth/callback'
  })
  await page.goto('/auth/start?return_to=/admin')
  const callback = await callbackResponse
  // /auth/callback answers with a redirect (307), which Response.ok() reports
  // as false — only assert it is not an error status; the CMS session cookie
  // below is the real proof the handoff completed.
  expect(callback.status(), 'CMS handoff callback failed — is FastAPI CMS_ADMIN_* configured?').toBeLessThan(400)
  await page.waitForURL(`${new URL(baseURL).origin}/admin**`)
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'cms_session')
  expect(sessionCookie).toMatchObject({
    domain: new URL(baseURL).hostname,
    httpOnly: true,
    sameSite: 'Lax',
  })
  const api = sessionFetch(baseURL, sessionCookie?.value ?? '')

  // ---------------------------------------------------------------------------
  // 2. Discover real eligible curation IDs through the existing Explorer BFF.
  // ---------------------------------------------------------------------------
  const searchResponse = await api('/api/admin/v1/curations?status=active&limit=3')
  expect(searchResponse.status).toBe(200)
  const search = await searchResponse.json() as { items?: Array<{ curation_id: string }> }
  const curationIds = (search.items ?? []).map((item) => item.curation_id)
  expect(curationIds.length, 'seed at least 3 active curations for the publish E2E').toBeGreaterThanOrEqual(3)
  const [first, second, third] = curationIds

  // ---------------------------------------------------------------------------
  // 3. Create the Collection and accumulate the v1 draft.
  // ---------------------------------------------------------------------------
  const createResponse = await api('/api/admin/v1/collections', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': requestId(),
      ...headers(),
    },
    body: JSON.stringify({
      slug: `e2e-publish-${Date.now()}`,
      title: `E2E Publish ${Date.now()}`,
      description: 'Created by the Collections publish E2E suite.',
    }),
  })
  expect(createResponse.status).toBe(201)
  const collection = await createResponse.json() as CollectionBody
  expect(collection.draftState).toBe('clean')

  async function collectionState(): Promise<CollectionBody> {
    const response = await api(`/api/admin/v1/collections/${collection.id}`)
    expect(response.status).toBe(200)
    return response.json() as Promise<CollectionBody>
  }

  async function enqueueDraft(action: 'add' | 'remove', ids: string[], current: CollectionBody) {
    const response = await api(`/api/admin/v1/collections/${collection.id}/draft/operations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId(),
        'If-Match': String(current.draftRevision),
        ...headers(),
      },
      body: JSON.stringify({ action, mode: 'explicit', curation_ids: ids, draft_revision: current.draftRevision }),
    })
    expect(response.status).toBe(202)
    return (await response.json()) as { id: string }
  }

  async function waitForOperationCommitted(operationId: string) {
    const deadline = Date.now() + 150_000
    let status: string | null = null
    while (Date.now() < deadline) {
      const response = await api(`/api/admin/v1/operations/${operationId}`)
      expect(response.status).toBe(200)
      const operation = await response.json() as { status: string }
      status = operation.status
      if (status === 'committed') return
      if (status === 'completed_with_skips' || status === 'failed' || status === 'conflicted' || status === 'cancelled' || status === 'stale') {
        throw new Error(`Draft operation reached terminal status ${status}; worker or eligibility issue`)
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    throw new Error(`Draft operation still ${status ?? 'unknown'} after timeout — is the CMS worker running?`)
  }

  const v1Operation = await enqueueDraft('add', [first, second], collection)
  await waitForOperationCommitted(v1Operation.id)

  // ---------------------------------------------------------------------------
  // 4. Publish v1 (probing the confirmed unavailable count, 0..selected).
  // ---------------------------------------------------------------------------
  async function publish(expectedUnavailableCount: number) {
    const current = await collectionState()
    const response = await api(`/api/admin/v1/collections/${collection.id}/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestId(),
        'If-Match': String(current.revision),
        ...headers(),
      },
      body: JSON.stringify({ confirmUnavailable: true, expectedUnavailableCount }),
    })
    return { status: response.status, body: await response.json().catch(() => null) as { code?: string } | null }
  }

  async function publishWithProbe() {
    for (let expected = 0; expected <= 3; expected += 1) {
      const attempt = await publish(expected)
      if (attempt.status === 202) return
      expect(attempt.status === 409 && attempt.body?.code === 'unavailable_confirmation_required',
        `publish probe failed with ${attempt.status} ${attempt.body?.code ?? ''}`).toBe(true)
    }
    throw new Error('Publish confirmation probe exhausted 0..3 unavailable counts')
  }

  async function waitForPublishedVersion(version: number) {
    const deadline = Date.now() + 150_000
    let latest: CollectionBody | null = null
    while (Date.now() < deadline) {
      latest = await collectionState()
      if (latest.currentPublishedVersion === version && latest.draftState === 'clean') return latest
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    throw new Error(`Version ${version} never promoted (current=${latest?.currentPublishedVersion ?? null}, draftState=${latest?.draftState ?? 'unknown'}) — is the CMS worker running?`)
  }

  await publishWithProbe()
  await waitForPublishedVersion(1)
  const v1 = await collectionState()
  expect(v1.lifecycle).toBe('published')
  expect(v1.publishedSelectedCount).toBe(2)

  // ---------------------------------------------------------------------------
  // 5. Accumulate the v2 draft and prove v1 stays stable.
  // ---------------------------------------------------------------------------
  const v2Add = await enqueueDraft('add', [third], await collectionState())
  await waitForOperationCommitted(v2Add.id)
  const v2Remove = await enqueueDraft('remove', [first], await collectionState())
  await waitForOperationCommitted(v2Remove.id)

  const whileDrafting = await collectionState()
  expect(whileDrafting.currentPublishedVersion).toBe(1)
  expect(whileDrafting.draftRevision).toBeGreaterThan(0)
  expect(whileDrafting.draftState).toBe('dirty')
  expect(whileDrafting.publishedSelectedCount).toBe(2)

  const versionsBefore = await api(`/api/admin/v1/collections/${collection.id}/versions`)
  expect(versionsBefore.status).toBe(200)
  const versionsBeforeBody = await versionsBefore.json() as { items: Array<{ version: number }> }
  expect(versionsBeforeBody.items.map((item) => item.version)).toEqual([1])

  // ---------------------------------------------------------------------------
  // 6. Publish v2, then archive and restore the very same v2.
  // ---------------------------------------------------------------------------
  await publishWithProbe()
  const v2 = await waitForPublishedVersion(2)
  expect(v2.publishedSelectedCount).toBe(2)

  const versionsAfter = await api(`/api/admin/v1/collections/${collection.id}/versions`)
  const versionsAfterBody = await versionsAfter.json() as { items: Array<{ version: number }> }
  expect(versionsAfterBody.items.map((item) => item.version)).toEqual([2, 1])

  const archivedResponse = await api(`/api/admin/v1/collections/${collection.id}/archive`, {
    method: 'POST',
    headers: { 'Idempotency-Key': requestId(), 'If-Match': String(v2.revision), ...headers() },
  })
  expect(archivedResponse.status).toBe(200)
  const archived = await archivedResponse.json() as CollectionBody
  expect(archived.lifecycle).toBe('archived')
  expect(archived.currentPublishedVersion).toBe(2)

  const restoredResponse = await api(`/api/admin/v1/collections/${collection.id}/restore`, {
    method: 'POST',
    headers: { 'Idempotency-Key': requestId(), 'If-Match': String(archived.revision), ...headers() },
  })
  expect(restoredResponse.status).toBe(200)
  const restored = await restoredResponse.json() as CollectionBody
  expect(restored.lifecycle).toBe('published')
  expect(restored.currentPublishedVersion, 'restore must keep exactly the archived version').toBe(2)

  // ---------------------------------------------------------------------------
  // 7. The visual CMS surface lists the collection the E2E just managed.
  // ---------------------------------------------------------------------------
  // Rota do Payload é /admin/collections/<slug> — slug é 'collections'.
  await page.goto('/admin/collections/collections')
  await expect(page.getByText(collection.title, { exact: true })).toBeVisible({ timeout: 20_000 })
})
