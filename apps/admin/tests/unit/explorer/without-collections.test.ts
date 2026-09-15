import { describe, expect, test, vi } from 'vitest'
import type { AdminCurationRow } from '@concierge/fastapi-client'
import {
  catalogScanFilters,
  summariesRowsFor,
  withoutCollectionsCursor,
  withoutCollectionsOffset,
  withoutCollectionsPage,
  type WithoutCollectionsScan,
} from '../../../src/explorer/without-collections'

function summaryRow(curation_id: string): AdminCurationRow {
  return { catalog_sequence: 1, curation_id, status: 'active', has_transcript: false }
}

/**
 * A frozen scan stand-in that applies the exclusion the way the boundary does
 * (the API's own suite pins that behavior): the excluded ids never enter the
 * materialized set, and a page never exceeds the requested limit.
 */
function fakeScan(scanIds: readonly string[]) {
  const started: Array<Parameters<WithoutCollectionsScan['startScan']>[0]> = []
  const pages: Array<Parameters<WithoutCollectionsScan['scanPage']>[0]> = []
  let remaining: string[] = []
  const scan: WithoutCollectionsScan = {
    async startScan(input) {
      started.push(input)
      remaining = scanIds.filter((id) => !input.excludeCurationIds.includes(id))
      return `scan-token-${started.length}`
    },
    async scanPage(input) {
      pages.push(input)
      const page = remaining.slice(0, input.limit)
      remaining = remaining.slice(input.limit)
      return { ids: page, nextCursor: remaining.length > 0 ? 'more' : null }
    },
  }
  return { pages, scan, started }
}

const SCANNED = ['cur-1', 'cur-2', 'cur-3', 'cur-4', 'cur-5']

describe('Without Collections scan filters', () => {
  test('carries the ledger exclusion and drops the view mode the boundary does not know', () => {
    expect(catalogScanFilters(
      { q: 'sushi', status: ['active', 'archived', 'nonsense'], without_collections: true },
      ['cur-2', 'cur-4'],
      'updated_at_desc',
    )).toEqual({
      q: 'sushi',
      status: ['active', 'archived'],
      sort: 'updated_at_desc',
      exclude_curation_ids: ['cur-2', 'cur-4'],
    })
  })

  test('sends an empty exclusion for a plain listing instead of a view mode', () => {
    expect(catalogScanFilters({ city: 'Victoria' }, [])).toEqual({ city: 'Victoria', exclude_curation_ids: [] })
  })
})

describe('Without Collections page cursor', () => {
  test('round-trips the page offset', () => {
    expect(withoutCollectionsOffset(withoutCollectionsCursor(300))).toBe(300)
    expect(withoutCollectionsOffset(withoutCollectionsCursor(0))).toBe(0)
  })

  test('restarts at the first page for a cursor it did not mint', () => {
    const foreign = Buffer.from(JSON.stringify({ after: 'cur-9' }), 'utf8').toString('base64url')

    expect(withoutCollectionsOffset(null)).toBe(0)
    expect(withoutCollectionsOffset('not-a-cursor')).toBe(0)
    expect(withoutCollectionsOffset(foreign)).toBe(0)
  })
})

describe('Without Collections page', () => {
  test('reads the page out of the frozen scan, excluding the ledger members', async () => {
    const { scan, started } = fakeScan(SCANNED)
    const rowsFor = vi.fn(async (ids: string[]) => ids.map(summaryRow))

    const page = await withoutCollectionsPage({
      actorId: 'admin-1',
      cursor: null,
      filters: { status: ['active'] },
      limit: 3,
      memberCurationIds: ['cur-2', 'cur-4'],
      rowsFor,
      scan,
      sort: 'updated_at_desc',
    })

    expect(started[0]).toEqual({
      actorId: 'admin-1',
      excludeCurationIds: ['cur-2', 'cur-4'],
      filters: { status: ['active'] },
      sort: 'updated_at_desc',
    })
    expect(page.items.map((row) => row.curation_id)).toEqual(['cur-1', 'cur-3', 'cur-5'])
    expect(rowsFor).toHaveBeenCalledWith(['cur-1', 'cur-3', 'cur-5'], 'admin-1')
    // Every row of the view is outside the set the exclusion was built from.
    expect(page.items.every((row) => row.collections_count === 0)).toBe(true)
    expect(page.total).toBeNull()
    expect(page.next_cursor).toBeNull()
  })

  test('serves the next page from a snapshot it freezes for that request', async () => {
    const { pages, scan, started } = fakeScan(SCANNED)
    const rowsFor = vi.fn(async (ids: string[]) => ids.map(summaryRow))
    const input = {
      actorId: 'admin-1',
      filters: { without_collections: true },
      limit: 2,
      memberCurationIds: ['cur-2', 'cur-4'],
      rowsFor,
      scan,
    }

    const first = await withoutCollectionsPage({ ...input, cursor: null })

    expect(first.items.map((row) => row.curation_id)).toEqual(['cur-1', 'cur-3'])
    expect(first.next_cursor).toBe(withoutCollectionsCursor(2))

    const second = await withoutCollectionsPage({ ...input, cursor: first.next_cursor })

    expect(second.items.map((row) => row.curation_id)).toEqual(['cur-5'])
    expect(second.next_cursor).toBeNull()
    // One walk per request, each asking the boundary for exactly what it needs.
    expect(started).toHaveLength(2)
    expect(pages.map((page) => page.limit)).toEqual([2, 4])
  })

  test('never asks for rows when the view has none', async () => {
    const { scan } = fakeScan(SCANNED)
    const rowsFor = vi.fn(async (ids: string[]) => ids.map(summaryRow))

    const page = await withoutCollectionsPage({
      actorId: 'admin-1',
      cursor: null,
      filters: {},
      limit: 100,
      memberCurationIds: SCANNED,
      rowsFor,
      scan,
    })

    expect(page.items).toEqual([])
    expect(page.next_cursor).toBeNull()
    expect(rowsFor).not.toHaveBeenCalled()
  })

  test('stops walking a scan that advances nothing instead of looping', async () => {
    const rowsFor = vi.fn(async (ids: string[]) => ids.map(summaryRow))
    const scan: WithoutCollectionsScan = {
      async startScan() { return 'scan-token' },
      async scanPage() { return { ids: [], nextCursor: 'more' } },
    }

    const page = await withoutCollectionsPage({
      actorId: 'admin-1',
      cursor: null,
      filters: {},
      limit: 10,
      memberCurationIds: [],
      rowsFor,
      scan,
    })

    expect(page.items).toEqual([])
    expect(page.next_cursor).toBeNull()
  })

  test('propagates a boundary failure instead of serving a half-materialized page', async () => {
    const scan: WithoutCollectionsScan = {
      async startScan() { throw new Error('boundary unavailable') },
      async scanPage() { return { ids: [], nextCursor: null } },
    }

    await expect(withoutCollectionsPage({
      actorId: 'admin-1',
      cursor: null,
      filters: {},
      limit: 10,
      memberCurationIds: [],
      rowsFor: async () => [],
      scan,
    })).rejects.toThrow('boundary unavailable')
  })
})

describe('Without Collections row batches', () => {
  test('fetches the rows in boundary-sized batches, in order', async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `cur-${index}`)
    const summaries = vi.fn(async (batch: string[]) => batch.map(summaryRow))

    const rows = await summariesRowsFor(summaries)(ids, 'admin-1')

    expect(summaries.mock.calls.map(([batch]) => batch.length)).toEqual([200, 50])
    expect(rows.map((row) => row.curation_id)).toEqual(ids)
  })
})
