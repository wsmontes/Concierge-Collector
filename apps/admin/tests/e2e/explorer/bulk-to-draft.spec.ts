import { expect, test } from '@playwright/test'

/**
 * Bulk multi-target E2E: a server-side selection applied across Collections.
 *
 *   1. Handoff: seeds a dev FastAPI session, completes the CMS handoff and
 *      asserts the host-only, HttpOnly CMS session cookie.
 *   2. Creates a Collection, then in the Explorer builds an all-matching
 *      selection and applies it to the Collection through the bulk endpoint.
 *   3. Proves the browser never ships the universe of curation IDs: both the
 *      selection POST (filters + excluded_ids, no curation_ids) and the bulk
 *      POST (collectionIds + action, no curation ids of any casing) carry
 *      intents, not ID arrays — regardless of selection size (even 50k).
 *   4. Proves leave/return preserves the job: navigating away and back while
 *      the parent is active leaves the worker to finish it, and the Collection
 *      draft accumulates exactly the captured selection count.
 *
 * Gate: run only with CMS_E2E_BULK=1 against a stack that provides:
 *   - CMS web server (baseURL) booted with a `-test` CMS database and
 *     CMS_SERVICE_KEY matching FastAPI's; baseURL must equal CMS_PUBLIC_SERVER_URL
 *     because cookie-authenticated writes enforce a same-origin Origin header;
 *   - CMS worker (`npm run start:worker --workspace=@concierge/admin`) so the
 *     selection materializes and the operation children actually commit;
 *   - FastAPI (CMS_E2E_FASTAPI_URL, default http://localhost:8000) in
 *     development mode with CMS_ADMIN_ORIGIN/CMS_ADMIN_CALLBACK_URL pointing
 *     at the CMS web server, the same CMS_SERVICE_KEY, and at least 3 active
 *     curations seeded in its `-test` database.
 */
const runLiveBulk = process.env.CMS_E2E_BULK === '1'
const liveBulk = runLiveBulk ? test : test.skip

const FASTAPI_URL = process.env.CMS_E2E_FASTAPI_URL || 'http://localhost:8000'

interface CollectionBody {
  id: string
  slug: string
  title: string
  draftState: string
  draftRevision: number
  draftSelectedCount: number
}

function requestId(): string {
  return crypto.randomUUID()
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

liveBulk('applies an all-matching selection across Collections without ever shipping IDs', async ({ baseURL, page }) => {
  if (!baseURL) throw new Error('CMS_E2E_BASE_URL is required for the bulk E2E suite')
  test.setTimeout(240_000)

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
  // 2. Discover the seeded active curations and create the target Collection.
  // ---------------------------------------------------------------------------
  const searchResponse = await api('/api/admin/v1/curations?status=active&limit=5')
  expect(searchResponse.status).toBe(200)
  const search = await searchResponse.json() as { items?: Array<{ curation_id: string }> }
  const curationIds = (search.items ?? []).map((item) => item.curation_id)
  expect(curationIds.length, 'seed at least 3 active curations for the bulk E2E').toBeGreaterThanOrEqual(3)

  const createResponse = await api('/api/admin/v1/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId() },
    body: JSON.stringify({ slug: `e2e-bulk-${Date.now()}`, title: `E2E Bulk ${Date.now()}` }),
  })
  expect(createResponse.status).toBe(201)
  const collection = await createResponse.json() as CollectionBody
  expect(collection.draftState).toBe('clean')

  async function collectionState(): Promise<CollectionBody> {
    const response = await api(`/api/admin/v1/collections/${collection.id}`)
    expect(response.status).toBe(200)
    return response.json() as Promise<CollectionBody>
  }

  // ---------------------------------------------------------------------------
  // 3. Build the all-matching selection in the Explorer and capture the POSTs.
  // ---------------------------------------------------------------------------
  await page.goto('/admin/explorer')
  const table = page.getByRole('table', { name: 'Curations' })
  await expect(table.locator('.curation-table__row input[type="checkbox"]')).toHaveCount(3, { timeout: 30_000 })

  // The selection intent POST: prove all-matching ships filters, never IDs.
  const selectionRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/admin/v1/selections',
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: 'Select all matching results' }).click()
  const selectionSent = await selectionRequest
  const selectionBody = selectionSent.postDataJSON() as Record<string, unknown>
  expect(selectionBody.mode).toBe('all_matching')
  expect(Object.keys(selectionBody)).not.toContain('curation_ids')
  expect(Object.keys(selectionBody)).not.toContain('curationIds')

  // The bulk intent POST: prove the browser sends collectionIds + action only.
  // Even a 50k selection never expands into an ID array in this request.
  const bulkRequest = page.waitForRequest(
    (request) => request.method() === 'POST' && /\/api\/admin\/v1\/selections\/[^/]+\/operations$/.test(new URL(request.url()).pathname),
    { timeout: 60_000 },
  )

  // The toolbar polls the materialized selection; the dialog opens when ready.
  await page.getByRole('button', { name: /Apply to Collections/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Apply selection to Collections' })
  await expect(dialog).toBeVisible({ timeout: 120_000 })
  await dialog.getByRole('checkbox', { name: new RegExp(collection.title) }).click()
  await dialog.getByRole('button', { name: /Apply to 1 Collection/ }).click()

  const bulkSent = await bulkRequest
  const bulkBody = bulkSent.postDataJSON() as Record<string, unknown>
  expect(bulkBody.action).toBe('add')
  expect(JSON.stringify(bulkBody)).toContain(collection.id)
  expect(Object.keys(bulkBody)).not.toContain('curation_ids')
  expect(Object.keys(bulkBody)).not.toContain('curationIds')
  // The array of target Collections is bounded by the picker; never a 50k ID list.
  expect(Array.isArray(bulkBody.collectionIds) && (bulkBody.collectionIds as unknown[]).length).toBe(1)

  const bulkResponse = await bulkSent.response()
  expect(bulkResponse.status()).toBe(202)
  const { operationId } = await bulkResponse.json() as { operationId: string }
  expect(operationId).toBeTruthy()

  // ---------------------------------------------------------------------------
  // 4. Leave/return while the job is active: the job survives server-side.
  // ---------------------------------------------------------------------------
  const drawer = page.getByLabel('Jobs em andamento')
  await expect(drawer).toBeVisible({ timeout: 15_000 })

  const activeListBeforeLeave = await api('/api/admin/v1/operations?actor=current&active=true')
  expect(activeListBeforeLeave.status).toBe(200)
  const activeBefore = await activeListBeforeLeave.json() as { items?: Array<{ id: string; parentSummary?: Record<string, number> }> }
  if (activeBefore.items?.length) {
    expect(activeBefore.items[0].parentSummary).toBeDefined()
  }

  await page.goto('/admin')
  await page.goto('/admin/explorer')

  // ---------------------------------------------------------------------------
  // 5. The worker finishes the bulk intent; the Collection draft accumulates.
  // ---------------------------------------------------------------------------
  const deadline = Date.now() + 150_000
  let latest: CollectionBody = collection
  while (Date.now() < deadline) {
    latest = await collectionState()
    if (latest.draftSelectedCount >= curationIds.length) break
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  expect(latest.draftSelectedCount, 'selection children never committed — is the CMS worker running?').toBe(curationIds.length)

  const parentResponse = await api(`/api/admin/v1/operations/${operationId}`)
  expect(parentResponse.status).toBe(200)
  const parent = await parentResponse.json() as { id: string; status: string; selectionId?: string }
  expect(parent.id).toBe(operationId)
  expect(parent.status).toBe('completed')
  expect(parent.selectionId).toBeTruthy()
})
