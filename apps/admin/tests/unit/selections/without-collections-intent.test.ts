import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Payload } from 'payload'
import { CurationAdapter } from '../../../src/fastapi/curation-adapter'
import { withoutCollectionsPage } from '../../../src/explorer/without-collections'
import { FastApiSelectionCatalogClient } from '../../../src/selections/catalog-client'
import { scanExclusionIds } from '../../../src/selections/materialize-selection'
import type { NormalizedCurationFilters } from '../../../src/explorer/types'

vi.mock('../../../src/env', () => ({
  readEnv: () => ({ fastApiBaseUrl: 'http://api.example.test', cmsServiceKey: 'service-key' }),
}))

const CATALOG = ['cur-1', 'cur-2', 'cur-3', 'cur-4', 'cur-5']
const MEMBERS = ['cur-2', 'cur-4']

/** The ledger as `scanExclusionIds` reads it: one `distinct` of the live member ids. */
function ledgerPayload(ids: readonly string[]): Payload {
  const calls: unknown[] = []
  return {
    calls,
    db: { collections: { 'collection-memberships': { distinct: async (field: string, query: unknown) => {
      calls.push({ field, query })
      return [...ids]
    } } } },
  } as unknown as Payload
}

/**
 * An in-memory catalog boundary behind `fetch`, applying the exclusion the way
 * the API does: the excluded ids never enter the frozen set, and a page never
 * exceeds the requested limit.
 */
function boundary() {
  const scans: Array<{ exclude_curation_ids: string[]; [key: string]: unknown }> = []
  return {
    scans,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}
      if (url.pathname === '/api/v3/catalog/curations/scan/start') {
        const filters = body.filters as { exclude_curation_ids?: string[] }
        scans.push({ ...filters, exclude_curation_ids: filters.exclude_curation_ids ?? [] })
        return Response.json({ scan_token: `scan-${scans.length}`, max_catalog_sequence: CATALOG.length })
      }
      if (url.pathname === '/api/v3/catalog/curations/scan/page') {
        const scan = scans[scans.length - 1]!
        const materialized = CATALOG.filter((id) => !scan.exclude_curation_ids.includes(id))
        const limit = Number(body.limit)
        const cursor = typeof body.cursor === 'string' ? Number(body.cursor) : 0
        const page = materialized.slice(cursor, cursor + limit)
        const next = cursor + page.length
        return Response.json({
          items: page.map((curation_id) => ({ curation_id })),
          next_cursor: next < materialized.length ? String(next) : null,
        })
      }
      throw new Error(`unexpected boundary call: ${url.pathname}`)
    }),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Without Collections scan exclusion', () => {
  test('reads the live membership ledger only for the view that asked for it', async () => {
    const payload = ledgerPayload(MEMBERS)

    await expect(scanExclusionIds(payload, null)).resolves.toEqual([])
    await expect(scanExclusionIds(payload, { city: 'Victoria' })).resolves.toEqual([])
    await expect(scanExclusionIds(payload, { without_collections: true })).resolves.toEqual(MEMBERS)
    expect((payload as unknown as { calls: unknown[] }).calls).toEqual([
      { field: 'curationId', query: { removedInVersion: null } },
    ])
  })

  test('refuses an intent whose ledger exceeds the boundary bound instead of trimming it', async () => {
    const ids = Array.from({ length: 10_001 }, (_, index) => `cur-${index}`)

    await expect(scanExclusionIds(ledgerPayload(ids), { without_collections: true }))
      .rejects.toMatchObject({ status: 503, code: 'service_unavailable' })
  })
})

describe('Materialized set of a "Without Collections" intent', () => {
  test('is the set the filtered listing serves, because both freeze the same scan', async () => {
    const api = boundary()
    vi.stubGlobal('fetch', api.fetch)
    const filters: NormalizedCurationFilters = { without_collections: true, status: ['active'] }
    const exclusion = await scanExclusionIds(ledgerPayload(MEMBERS), filters)
    const expected = CATALOG.filter((id) => !MEMBERS.includes(id))

    // The intent's worker walk: the scan is frozen once, then materialized page
    // by page — exactly what `materializeSelection` consumes.
    const client = new FastApiSelectionCatalogClient()
    const { scanToken } = await client.startScan(filters, 'admin-1', exclusion)
    const materialized: string[] = []
    for (let cursor: string | null = null; ; ) {
      const page = await client.scanPage({ actorId: 'admin-1', cursor, limit: 500, scanToken })
      materialized.push(...page.items.map((item) => item.curation_id))
      cursor = page.next_cursor
      if (cursor === null) break
    }

    // The listing's own composition over the same boundary, through the same
    // adapter and scan primitives the BFF route uses, page by page.
    const listed: string[] = []
    for (let cursor: string | null = null; ; ) {
      const page = await withoutCollectionsPage({
        actorId: 'admin-1',
        cursor,
        filters,
        limit: 2,
        memberCurationIds: exclusion,
        rowsFor: async (ids) => ids.map((curation_id) => ({
          catalog_sequence: 1,
          curation_id,
          status: 'active',
          has_transcript: false,
        })),
        scan: new CurationAdapter(),
      })
      listed.push(...page.items.map((row) => row.curation_id))
      cursor = page.next_cursor
      if (cursor === null) break
    }

    // Every freeze — the intent's and each listing page's — carried the same
    // ledger exclusion, and no scan body carried the view mode itself.
    expect(api.scans.length).toBeGreaterThanOrEqual(2)
    expect(api.scans.every((scan) => scan.exclude_curation_ids.join(',') === MEMBERS.join(','))).toBe(true)
    expect(api.scans.every((scan) => !('without_collections' in scan))).toBe(true)
    expect(materialized.sort()).toEqual([...expected].sort())
    expect(listed.sort()).toEqual([...expected].sort())
  })
})
