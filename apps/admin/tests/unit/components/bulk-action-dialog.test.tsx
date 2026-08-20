import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BulkActionDialog } from '../../../src/components/operations/BulkActionDialog'

async function jsonResponse(body: unknown, ok = true, status = 200): Promise<Response> {
  return { ok, status, json: async () => body } as unknown as Response
}

const collections = {
  items: [
    { id: 'col-a', slug: 'sao-paulo', title: 'São Paulo', draftRevision: 7, draftState: 'dirty', draftSelectedCount: 3 },
    { id: 'col-b', slug: 'rio', title: 'Rio', draftRevision: 1, draftState: 'clean', draftSelectedCount: 0 },
  ],
}

/** Resolved fetch mocks settle on the microtask queue, which the fake-timer
 *  clock only drains one tick per advancement — flush enough ticks for the
 *  fetch -> json -> setState -> re-render chains to settle. */
async function flush() {
  for (let i = 0; i < 10; i += 1) await vi.advanceTimersByTimeAsync(0)
}

describe('BulkActionDialog', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

  test('loads the collection picker and posts only collectionIds plus the action', async () => {
    const listMock = vi.fn().mockResolvedValue(jsonResponse(collections))
    const postMock = vi.fn().mockResolvedValue(jsonResponse({ operationId: 'parent-1' }))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/operations') ? postMock(input, init) : listMock(input, init)))
    const onPosted = vi.fn()
    render(<BulkActionDialog selectionId="selection-1" onClose={vi.fn()} onPosted={onPosted} />)
    await flush()
    screen.getByRole('checkbox', { name: /São Paulo/ }).click()
    screen.getByRole('checkbox', { name: /Rio/ }).click()
    screen.getByRole('button', { name: 'Apply to 2 Collections' }).click()
    await flush()
    expect(postMock).toHaveBeenCalledTimes(1)
    const call = postMock.mock.calls[0] as [string, RequestInit]
    expect(call[0]).toBe('/api/admin/v1/selections/selection-1/operations')
    expect(call[1].method).toBe('POST')
    expect(call[1].headers).toMatchObject({ 'idempotency-key': expect.any(String), 'x-request-id': expect.any(String) })
    const sent = JSON.parse(String(call[1].body)) as Record<string, unknown>
    expect(sent).toEqual({ collectionIds: ['col-a', 'col-b'], action: 'add' })
    // The selection manifest never leaves the server: no curation ids in sight.
    expect(Object.keys(sent)).not.toContain('curationIds')
    expect(Object.keys(sent)).not.toContain('curation_ids')
    expect(onPosted).toHaveBeenCalledWith('parent-1')
  })

  test('an all-matching selection still posts only collections — never an array of IDs', async () => {
    const postMock = vi.fn().mockResolvedValue(jsonResponse({ operationId: 'parent-2' }))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/operations') ? postMock(input, init) : jsonResponse(collections)))
    render(<BulkActionDialog selectionId="selection-2" onClose={vi.fn()} onPosted={vi.fn()} />)
    await flush()
    screen.getByRole('checkbox', { name: /Rio/ }).click()
    screen.getByRole('button', { name: 'Apply to 1 Collection' }).click()
    await flush()
    const sent = JSON.parse(String((postMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>
    expect(sent).toEqual({ collectionIds: ['col-b'], action: 'add' })
  })

  test('a single selected Collection pins If-Match to its draft revision', async () => {
    const postMock = vi.fn().mockResolvedValue(jsonResponse({ operationId: 'parent-3' }))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/operations') ? postMock(input, init) : jsonResponse(collections)))
    render(<BulkActionDialog selectionId="selection-1" onClose={vi.fn()} onPosted={vi.fn()} />)
    await flush()
    screen.getByRole('checkbox', { name: /São Paulo/ }).click()
    screen.getByRole('button', { name: 'Apply to 1 Collection' }).click()
    await flush()
    const init = postMock.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ 'if-match': '7' })
  })

  test('a revision conflict surfaces the refresh message without calling onPosted', async () => {
    const postMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'revision_conflict' }, false, 412))
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/operations') ? postMock(input, init) : jsonResponse(collections)))
    const onPosted = vi.fn()
    render(<BulkActionDialog selectionId="selection-1" onClose={vi.fn()} onPosted={onPosted} />)
    await flush()
    screen.getByRole('checkbox', { name: /São Paulo/ }).click()
    screen.getByRole('button', { name: 'Apply to 1 Collection' }).click()
    await flush()
    expect(screen.getByRole('alert')).toHaveTextContent('A Collection changed on the server')
    expect(onPosted).not.toHaveBeenCalled()
  })

  test('does not submit while no Collection is selected', async () => {
    const listMock = vi.fn().mockResolvedValue(jsonResponse(collections))
    const postMock = vi.fn()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).includes('/operations') ? postMock(input, init) : listMock(input, init)))
    render(<BulkActionDialog selectionId="selection-1" onClose={vi.fn()} onPosted={vi.fn()} />)
    await flush()
    const submit = screen.getByRole('button', { name: /Apply to 0 Collections/ }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    submit.click()
    await flush()
    expect(postMock).not.toHaveBeenCalled()
  })
})
