import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { JobDrawer } from '../../../src/components/operations/JobDrawer'
import type { ActiveJobRow } from '../../../src/components/operations/JobDrawer'

function activeJob(overrides: Partial<ActiveJobRow> = {}): ActiveJobRow {
  return {
    id: 'parent-1',
    action: 'add',
    selectionId: 'selection-1',
    status: 'active',
    parentSummary: { active: 1, completed: 1, failed: 1 },
    progress: { processed: 5, skipped: 1, failed: 0 },
    cancellable: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

/** Resolved fetch mocks settle on the microtask queue, which the fake-timer
 *  clock only drains one tick per advancement — flush enough ticks for the
 *  fetch -> json -> setState -> re-render chains to settle. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await vi.advanceTimersByTimeAsync(0)
}

describe('JobDrawer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

  test('renders active jobs with aggregate progress, skips and failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [activeJob()], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    render(<JobDrawer />)
    await flush()
    expect(screen.getByLabelText('Jobs em andamento')).toBeInTheDocument()
    expect(screen.getByText('Add selection across 3 Collections')).toBeInTheDocument()
    expect(screen.getByText('5 applied, 1 skipped')).toBeInTheDocument()
    expect(screen.getByText('1 pending, 1 done, 1 failed')).toBeInTheDocument()
  })

  test('polls on the interval and aborts the in-flight request on unmount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<JobDrawer pollMs={2_000} />)
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect(firstCall[1]?.signal).toBeInstanceOf(AbortSignal)
    const signal = firstCall[1]?.signal as AbortSignal
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  test('backs off instead of spinning when the server is unavailable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, false, 500))
    vi.stubGlobal('fetch', fetchMock)
    render(<JobDrawer pollMs={2_000} />)
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to reach the server')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Backoff doubles the interval: the second attempt waits 4s, not 2s.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('offers cancel only while the job is cancellable (never when committing)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [activeJob({ cancellable: false })], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    render(<JobDrawer />)
    await flush()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [activeJob({ cancellable: true })], nextCursor: null })))
    render(<JobDrawer />)
    await flush()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  test('cancels through the cancel endpoint and refreshes the list', async () => {
    const listMock = vi.fn().mockResolvedValue(jsonResponse({ items: [activeJob()], nextCursor: null }))
    const cancelMock = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/cancel') ? cancelMock(input, init) : listMock(input, init)))
    render(<JobDrawer />)
    await flush()
    screen.getByRole('button', { name: 'Cancel' }).click()
    await flush()
    expect(cancelMock).toHaveBeenCalledTimes(1)
    const cancelCall = cancelMock.mock.calls[0] as [string, RequestInit]
    expect(cancelCall[1].method).toBe('POST')
    // The cancel refresh re-polled the list immediately.
    expect(listMock).toHaveBeenCalledTimes(2)
  })
})
