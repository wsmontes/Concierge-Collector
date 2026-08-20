import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Model } from 'mongoose'
import type { Payload } from 'payload'
import { lease, page } from '../../support/factories'
import { createSelectionHarness, type SelectionHarness } from '../../support/selection-harness'

const hasTestMongo = Boolean(
  process.env.CMS_SKIP_MONGO_INTEGRATION !== '1' &&
  process.env.CMS_MONGODB_URL &&
  process.env.CMS_MONGODB_DB_NAME?.endsWith('-test'),
)
const integrationSuite = hasTestMongo ? describe : describe.skip

const adminIdentity = {
  authz_revision: 'revision-1', authorized: true, email: 'admin@example.test', name: 'Admin', picture: null,
  role: 'admin', user_id: 'admin-1',
}

integrationSuite('selection manifest restart', () => {
  let payload: Payload
  let manifests: Model<Record<string, unknown>>
  let items: Model<Record<string, unknown>>
  let jobs: Model<Record<string, unknown>>
  let sessions: Model<Record<string, unknown>>
  let users: Model<Record<string, unknown>>

  beforeAll(async () => {
    if (!hasTestMongo) return
    const { getSharedPayload } = await import('../support/collection-fixtures')
    payload = await getSharedPayload()
    manifests = payload.db.collections['selection-manifests'] as unknown as Model<Record<string, unknown>>
    items = payload.db.collections['selection-manifest-items'] as unknown as Model<Record<string, unknown>>
    jobs = payload.db.collections['payload-jobs'] as unknown as Model<Record<string, unknown>>
    sessions = payload.db.collections['cms-sessions'] as unknown as Model<Record<string, unknown>>
    users = payload.db.collections['cms-users'] as unknown as Model<Record<string, unknown>>
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (!hasTestMongo) return
    await Promise.all([
      manifests.deleteMany({}),
      items.deleteMany({}),
      jobs.deleteMany({}),
      sessions.deleteMany({}),
      users.deleteMany({}),
    ])
  })

  test('restart retoma do cursor do checkpoint após interrupção do worker', async () => {
    const { createAllMatchingSelection, fastApi, manifestIds, loadSelection, materializeSelection } =
      await createSelectionHarness()
    const { AdminHttpError } = await import('../../../src/http/errors')
    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })

    fastApi.scanPage
      .mockResolvedValueOnce(page(['c1', 'c2'], 'cursor-2'))
      .mockRejectedValueOnce(new AdminHttpError(503, 'authorization_unavailable'))
    await expect(materializeSelection(selection.id, lease())).rejects.toMatchObject({ status: 503 })

    const interrupted = await loadSelection(selection.id)
    expect(interrupted.status).toBe('materializing')
    expect(interrupted.checkpointCursor).toBe('cursor-2')
    expect(interrupted.candidateCount).toBe(2)
    expect(await manifestIds(selection.id)).toEqual(['c1', 'c2'])

    fastApi.scanPage.mockResolvedValueOnce(page(['c3'], null))
    await materializeSelection(selection.id, lease({ owner: 'restart-worker' }))

    // The restarted worker resumed from the checkpoint instead of restarting the scan.
    expect(fastApi.scanPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2' }))
    const ready = await loadSelection(selection.id)
    expect(ready.status).toBe('ready')
    expect(ready.scanComplete).toBe(true)
    expect(ready.capturedCount).toBe(3)
    expect(await manifestIds(selection.id)).toEqual(['c1', 'c2', 'c3'])
  })

  test('cursor terminal null não reinicia o scan em chamadas posteriores', async () => {
    const { createAllMatchingSelection, fastApi, loadSelection, manifestIds, materializeSelection } =
      await createSelectionHarness()
    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })

    fastApi.scanPage.mockResolvedValueOnce(page(['c1'], null))
    await materializeSelection(selection.id, lease())

    expect(await manifestIds(selection.id)).toEqual(['c1'])
    expect(await loadSelection(selection.id)).toMatchObject({
      status: 'ready', scanComplete: true, checkpointCursor: null,
    })
    expect(fastApi.scanPage).toHaveBeenCalledTimes(1)

    // A second worker cannot re-claim a ready manifest: claim returns null and
    // no further scan page is fetched.
    await expect(materializeSelection(selection.id, lease({ owner: 'second-worker' }))).resolves.toBeNull()
    expect(fastApi.scanPage).toHaveBeenCalledTimes(1)
  })

  test('payload.jobs.runByID retoma o job de materialização até o manifest ready', async () => {
    const { createAllMatchingSelection, loadSelection, manifestIds } = await createSelectionHarness()
    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })
    expect(selection.payloadJobId).toBeTruthy()

    let failScan = true
    let scanCalls = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v3/auth/cms/introspect')) {
        return new Response(JSON.stringify(adminIdentity), { status: 200 })
      }
      if (url.endsWith('/api/v3/catalog/curations/scan/page')) {
        if (failScan) return new Response('temporary outage', { status: 503 })
        scanCalls += 1
        return new Response(
          JSON.stringify(scanCalls === 1 ? page(['c1', 'c2'], 'cursor-2') : page(['c3'], null)),
          { status: 200 },
        )
      }
      throw new Error(`Unexpected worker request: ${url}`)
    })

    await payload.jobs.runByID({ id: selection.payloadJobId!, overrideAccess: true, silent: true })
    expect((await loadSelection(selection.id)).status).toBe('materializing')
    expect((await loadSelection(selection.id)).checkpointCursor).toBeNull()
    expect((await loadSelection(selection.id)).candidateCount).toBe(0)

    failScan = false
    await payload.jobs.runByID({ id: selection.payloadJobId!, overrideAccess: true, silent: true })

    const ready = await loadSelection(selection.id)
    expect(ready.status).toBe('ready')
    expect(ready.capturedCount).toBe(3)
    expect(await manifestIds(selection.id)).toEqual(['c1', 'c2', 'c3'])
  })

  test('GET /api/admin/v1/selections/:id devolve 410 para manifest expirado', async () => {
    const { createAllMatchingSelection } = await createSelectionHarness()
    const { createCmsSession } = await import('../../../src/auth/cms-session')
    const { mirrorCmsUser } = await import('../../../src/auth/cms-strategy')
    const { selectionEndpoints } = await import('../../../src/payload/endpoints/selections')
    const selection = await createAllMatchingSelection({ filters: { q: 'sushi' } })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/v3/auth/cms/introspect')) {
        return new Response(JSON.stringify(adminIdentity), { status: 200 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    // cms-sessions.user is a relationship to cms-users: mirror the admin identity first.
    const user = await mirrorCmsUser(payload, adminIdentity)
    const token = await createCmsSession(payload, { subject: 'admin-1', user: user.id })
    const endpoint = selectionEndpoints().find(
      ({ method, path }) => method === 'get' && path === '/admin/v1/selections/:id',
    )!
    const getSelection = (id: string) => {
      const request = Object.assign(new Request(`http://localhost:3000/api/admin/v1/selections/${id}`, {
        method: 'GET',
        headers: { cookie: `cms_session=${token}` },
      }), { payload, routeParams: { id } })
      return endpoint.handler(request as never)
    }

    const live = await getSelection(selection.id)
    expect(live.status).toBe(200)
    expect(await live.json()).toMatchObject({ id: selection.id, mode: 'all_matching', status: 'queued' })

    await manifests.updateOne({ _id: selection.id }, { $set: { expiresAt: new Date(Date.now() - 1_000) } })
    const expired = await getSelection(selection.id)
    expect(expired.status).toBe(410)
    expect(await expired.json()).toEqual({ error: { code: 'selection_expired' } })
  })
})
