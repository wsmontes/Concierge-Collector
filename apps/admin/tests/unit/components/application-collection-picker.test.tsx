import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ApplicationViews } from '../../../src/components/applications/ApplicationViews'
import { browserLoadCollections, CollectionAccessPicker } from '../../../src/components/applications/CollectionAccessPicker'

const victoria = {
  id: '507f1f77bcf86cd799439011',
  slug: 'victoria',
  title: 'Victoria',
  lifecycle: 'published' as const,
  currentPublishedVersion: 2,
}
const archived = {
  id: '507f1f77bcf86cd799439012',
  slug: 'old',
  title: 'Old Collection',
  lifecycle: 'archived' as const,
  currentPublishedVersion: 1,
}
const vancouver = {
  id: '507f1f77bcf86cd799439013',
  slug: 'vancouver',
  title: 'Vancouver',
  lifecycle: 'published' as const,
  currentPublishedVersion: 1,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('browser Collection loader follows all bounded cursor pages', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [victoria], nextCursor: 'next-page' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [vancouver], nextCursor: null }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
  vi.stubGlobal('fetch', fetcher)

  await expect(browserLoadCollections()).resolves.toEqual([victoria, vancouver])
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    '/api/admin/v1/collections',
    '/api/admin/v1/collections?cursor=next-page',
  ])
})

test('picker exposes published Collections by name while archived rows cannot be newly granted', async () => {
  const onChange = vi.fn()
  render(<CollectionAccessPicker
    value={[]}
    onChange={onChange}
    loadCollections={vi.fn().mockResolvedValue([victoria, archived])}
  />)

  const victoriaBox = await screen.findByRole('checkbox', { name: /Victoria/ })
  const archivedBox = screen.getByRole('checkbox', { name: /Old Collection/ })
  expect(victoriaBox).toBeEnabled()
  expect(archivedBox).toBeDisabled()

  fireEvent.click(victoriaBox)
  expect(onChange).toHaveBeenCalledWith([victoria.id])
})

test('new application sends Collection IDs selected through the picker instead of a raw ID textarea', async () => {
  let createBody: Record<string, unknown> | null = null
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url === '/api/admin/v1/applications' && (!init.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === '/api/admin/v1/collections') {
      return new Response(JSON.stringify({ items: [victoria, vancouver], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === '/api/admin/v1/applications' && init.method === 'POST') {
      createBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return new Response(JSON.stringify({
        id: '65f000000000000000000020',
        name: 'Guide API', owner: 'Web', status: 'active', allowedCollectionIds: [victoria.id],
        defaultRequestsPerMinute: 60, credentialsRevision: 0, revision: 1,
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)

  render(<ApplicationViews />)
  await screen.findByRole('heading', { name: 'New application' })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Guide API' } })
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Web' } })
  fireEvent.click(await screen.findByRole('checkbox', { name: /Victoria/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Create application' }))

  await waitFor(() => expect(createBody).not.toBeNull())
  expect(createBody).toMatchObject({ allowedCollectionIds: [victoria.id] })
  expect(screen.queryByLabelText('Collection IDs')).toBeNull()
})

test('Edit access patches with the loaded application revision and selected Collections', async () => {
  const application = {
    id: '65f000000000000000000020',
    name: 'Guide API', owner: 'Web', status: 'active' as const, allowedCollectionIds: [victoria.id],
    defaultRequestsPerMinute: 60, credentialsRevision: 0, revision: 4,
  }
  let patchInit: RequestInit | null = null
  const fetcher = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url === '/api/admin/v1/applications' && (!init.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ items: [application] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === '/api/admin/v1/collections') {
      return new Response(JSON.stringify({ items: [victoria, vancouver], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === `/api/admin/v1/applications/${application.id}` && init.method === 'PATCH') {
      patchInit = init
      return new Response(JSON.stringify({ ...application, allowedCollectionIds: [victoria.id, vancouver.id], defaultRequestsPerMinute: 90, revision: 5 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal('fetch', fetcher)

  render(<ApplicationViews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit access for Guide API' }))
  const dialog = await screen.findByRole('dialog', { name: 'Edit Guide API access' })
  fireEvent.click(await within(dialog).findByRole('checkbox', { name: /Vancouver/ }))
  fireEvent.change(within(dialog).getByLabelText('Requests per minute'), { target: { value: '90' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save access' }))

  await waitFor(() => expect(patchInit).not.toBeNull())
  const headers = new Headers(patchInit!.headers)
  expect(headers.get('If-Match')).toBe('4')
  expect(JSON.parse(String(patchInit!.body))).toEqual({
    allowedCollectionIds: [victoria.id, vancouver.id],
    defaultRequestsPerMinute: 90,
  })
})