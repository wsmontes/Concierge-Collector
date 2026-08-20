import { afterEach, describe, expect, test, vi } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
import {
  FastApiUsageClient,
  syncConsumerUsage,
  type ConsumerUsagePage,
  type SyncConsumerUsageDependencies,
  type UsageSyncDb,
  type UsageSyncStore,
} from '../../../src/jobs/syncConsumerUsage'

function fakePage(items: Array<{ credentialId: string; lastUsedAt: string }> = [], nextCursor: string | null = null): ConsumerUsagePage {
  return { items, next_cursor: nextCursor }
}

interface SyncWorld {
  /** lastUsedAt per credential as applied through the $max boundary */
  applied: Map<string, Date>
  /** checkpoint writes in order, each with the $max snapshot at write time */
  writes: Array<{ cursor: string | null; appliedSnapshot: Map<string, Date> }>
  cursor: string | null
  /** when set (undefined = never), the next writeCursor of this exact cursor throws once */
  failWriteCursor: string | null | undefined
  fetchPage: ReturnType<typeof vi.fn>
  deps: SyncConsumerUsageDependencies
}

/**
 * Hermetic sync world: the fake store implements $max semantics (values only
 * ever rise) and records a snapshot of applied values at every checkpoint
 * write, so tests can prove the checkpoint never advances before its page's
 * $max updates landed.
 */
function world(initialCursor: string | null): SyncWorld {
  const applied = new Map<string, Date>()
  const writes: Array<{ cursor: string | null; appliedSnapshot: Map<string, Date> }> = []
  const state: SyncWorld = {
    applied,
    writes,
    cursor: initialCursor,
    failWriteCursor: undefined,
    fetchPage: vi.fn(async () => fakePage()),
    deps: {} as SyncConsumerUsageDependencies,
  }
  const store: UsageSyncStore = {
    readCursor: async () => state.cursor,
    writeCursor: async (cursor) => {
      if (state.failWriteCursor !== undefined && state.failWriteCursor === cursor) {
        state.failWriteCursor = undefined
        throw new AdminHttpError(503, 'service_unavailable')
      }
      writes.push({ cursor, appliedSnapshot: new Map(applied) })
      state.cursor = cursor
    },
  }
  const db: UsageSyncDb = {
    applyLastUsed: async (updates) => {
      for (const update of updates) {
        const current = applied.get(update.credentialId)
        if (!current || update.lastUsedAt > current) applied.set(update.credentialId, update.lastUsedAt)
      }
    },
  }
  state.deps = { fetchClient: { fetchPage: state.fetchPage }, store, db }
  return state
}

describe('syncConsumerUsage job', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('sincroniza todas as páginas: $max aplicado antes de avançar o checkpoint', async () => {
    const state = world('cursor-0')
    state.fetchPage.mockImplementation(async (after) => {
      if (after === 'cursor-0') {
        return fakePage([{ credentialId: 'cred-1', lastUsedAt: '2026-08-20T10:00:00+00:00' }], 'cursor-1')
      }
      return fakePage([{ credentialId: 'cred-2', lastUsedAt: '2026-08-20T11:00:00+00:00' }], null)
    })

    const result = await syncConsumerUsage(state.deps)

    expect(result).toEqual({ pages: 2, items: 2 })
    expect(state.fetchPage.mock.calls.map((call) => call[0])).toEqual(['cursor-0', 'cursor-1'])
    expect(state.writes.map((write) => write.cursor)).toEqual(['cursor-1', null])
    // Nenhum checkpoint avançou antes da página correspondente ter sido aplicada.
    expect(state.writes[0].appliedSnapshot.get('cred-1')).toEqual(new Date('2026-08-20T10:00:00+00:00'))
    expect(state.writes[0].appliedSnapshot.get('cred-2')).toBeUndefined()
    expect(state.writes[1].appliedSnapshot.get('cred-2')).toEqual(new Date('2026-08-20T11:00:00+00:00'))
    expect(state.applied.get('cred-1')).toEqual(new Date('2026-08-20T10:00:00+00:00'))
    expect(state.applied.get('cred-2')).toEqual(new Date('2026-08-20T11:00:00+00:00'))
  })

  test('retry da mesma página é idempotente ($max) e o checkpoint converge', async () => {
    const state = world(null)
    state.fetchPage.mockImplementation(async (after) => {
      if (after === null) {
        return fakePage([{ credentialId: 'cred-1', lastUsedAt: '2026-08-20T10:00:00+00:00' }], 'c1')
      }
      return fakePage([{ credentialId: 'cred-2', lastUsedAt: '2026-08-20T11:00:00+00:00' }], null)
    })
    // Falha no write do checkpoint final: $max da segunda página já foi aplicado.
    state.failWriteCursor = null
    await expect(syncConsumerUsage(state.deps)).rejects.toBeInstanceOf(AdminHttpError)
    expect(state.applied.get('cred-2')).toEqual(new Date('2026-08-20T11:00:00+00:00'))
    expect(state.cursor).toBe('c1')

    // O retry reexecuta a MESMA página; $max não rebaixa e o checkpoint avança.
    await syncConsumerUsage(state.deps)
    expect(state.applied.get('cred-2')).toEqual(new Date('2026-08-20T11:00:00+00:00'))
    expect(state.cursor).toBe(null)
    expect(state.writes.map((write) => write.cursor)).toEqual(['c1', null])
  })

  test('401 não avança o checkpoint nem aplica escritas', async () => {
    const state = world('cursor-0')
    state.fetchPage.mockRejectedValue(new AdminHttpError(401, 'authentication_required'))

    await expect(syncConsumerUsage(state.deps)).rejects.toBeInstanceOf(AdminHttpError)
    expect(state.cursor).toBe('cursor-0')
    expect(state.writes).toHaveLength(0)
    expect(state.applied.size).toBe(0)
  })

  test('erro de rede não avança o checkpoint nem aplica escritas', async () => {
    const state = world('cursor-0')
    state.fetchPage.mockRejectedValue(new AdminHttpError(503, 'service_unavailable'))

    await expect(syncConsumerUsage(state.deps)).rejects.toBeInstanceOf(AdminHttpError)
    expect(state.cursor).toBe('cursor-0')
    expect(state.writes).toHaveLength(0)
    expect(state.applied.size).toBe(0)
  })

  test('cursor expirado (409) zera o checkpoint para o retry recomeçar limpo', async () => {
    const state = world('stale-cursor')
    state.fetchPage.mockRejectedValue(new AdminHttpError(409, 'conflict'))

    await expect(syncConsumerUsage(state.deps)).rejects.toBeInstanceOf(AdminHttpError)
    expect(state.cursor).toBe(null)
    expect(state.writes).toEqual([{ cursor: null, appliedSnapshot: new Map() }])
    expect(state.applied.size).toBe(0)
  })

  test('data inválida em um item aborta sem avançar o checkpoint', async () => {
    const state = world('cursor-0')
    state.fetchPage.mockResolvedValue(fakePage([{ credentialId: 'cred-1', lastUsedAt: 'not-a-date' }]))

    await expect(syncConsumerUsage(state.deps)).rejects.toBeInstanceOf(AdminHttpError)
    expect(state.cursor).toBe('cursor-0')
    expect(state.applied.size).toBe(0)
    expect(state.writes).toHaveLength(0)
  })

  test('FastApiUsageClient chama o endpoint com X-CMS-Service-Key, after e limit=500', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [{ credentialId: 'cred-1', lastUsedAt: '2026-08-20T10:00:00+00:00' }],
        next_cursor: 'next-cursor',
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new FastApiUsageClient('http://localhost:8000', 'svc-key-1')

    const page = await client.fetchPage('cursor-1')

    expect(page).toEqual({
      items: [{ credentialId: 'cred-1', lastUsedAt: '2026-08-20T10:00:00+00:00' }],
      next_cursor: 'next-cursor',
    })
    const [input, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(input)
    expect(url.pathname).toBe('/api/v3/internal/consumer-usage')
    expect(url.searchParams.get('after')).toBe('cursor-1')
    expect(url.searchParams.get('limit')).toBe('500')
    expect(init.method).toBe('GET')
    expect(new Headers(init.headers as HeadersInit).get('X-CMS-Service-Key')).toBe('svc-key-1')
  })

  test('primeira página omite o parâmetro after quando não há checkpoint', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => fakePage() }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new FastApiUsageClient('http://localhost:8000', 'svc-key-1')

    await client.fetchPage(null)

    const [input] = fetchMock.mock.calls[0] as [string]
    const url = new URL(input)
    expect(url.searchParams.has('after')).toBe(false)
    expect(url.searchParams.get('limit')).toBe('500')
  })

  test('FastApiUsageClient converte 401 em AdminHttpError', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new FastApiUsageClient('http://localhost:8000', 'svc-key-1')

    await expect(client.fetchPage('cursor-1')).rejects.toMatchObject({ status: 401 })
  })

  test('FastApiUsageClient mapeia falha de rede em 503', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('network down')
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = new FastApiUsageClient('http://localhost:8000', 'svc-key-1')

    await expect(client.fetchPage(null)).rejects.toMatchObject({ status: 503 })
  })

  test('FastApiUsageClient rejeita payload malformado', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: 'nope' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new FastApiUsageClient('http://localhost:8000', 'svc-key-1')

    await expect(client.fetchPage(null)).rejects.toMatchObject({ status: 503 })
  })
})
