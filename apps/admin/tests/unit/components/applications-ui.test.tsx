import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ApplicationViews } from '../../../src/components/applications/ApplicationViews'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const guideApplication = {
  id: '65f000000000000000000020',
  name: 'Guide API',
  owner: 'Web',
  status: 'active' as const,
  allowedCollectionIds: [] as string[],
  defaultRequestsPerMinute: 60,
  credentialsRevision: 0,
  revision: 1,
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubAdminFetch(applications: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url === '/api/admin/v1/applications' && (!init.method || init.method === 'GET')) {
      return json({ items: applications })
    }
    if (url === '/api/admin/v1/collections') {
      return json({ items: [], nextCursor: null })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
}

test('renders an explicit empty state when there are no consumer applications', async () => {
  stubAdminFetch([])
  render(<ApplicationViews />)

  expect(await screen.findByLabelText('No Applications yet')).toBeVisible()
  expect(screen.getByText('Create an Application to issue scoped credentials for published Collections.')).toBeVisible()
})

test('renders application health as a semantic status pill', async () => {
  stubAdminFetch([guideApplication])
  render(<ApplicationViews />)

  const status = await screen.findByText('active')
  expect(status.closest('[data-status]')).toHaveAttribute('data-status', 'active')
})

test('a failed read shows ErrorState and the retry really reads again', async () => {
  let attempt = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url === '/api/admin/v1/collections') return json({ items: [], nextCursor: null })
    if (url === '/api/admin/v1/applications' && (!init.method || init.method === 'GET')) {
      attempt += 1
      if (attempt === 1) return json({ error: { code: 'service_unavailable' } }, 503)
      return json({ items: [guideApplication] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))

  render(<ApplicationViews />)

  const failure = await screen.findByRole('alert')
  expect(failure).toHaveTextContent('Applications could not load')
  expect(screen.queryByRole('button', { name: 'Manage credentials' })).toBeNull()

  fireEvent.click(within(failure).getByRole('button', { name: 'Try again' }))

  expect(await screen.findByText('Guide API')).toBeVisible()
  expect(screen.queryByText('Applications could not load')).toBeNull()
})

test('lists credentials with the prefix as a technical value, status chip and relative validity', async () => {
  const credential = {
    id: '65f000000000000000000030',
    name: 'production reader',
    prefix: 'cck_abc123456789',
    status: 'active',
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    revokedAt: null,
    lastUsedAt: null,
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/admin/v1/applications') return json({ items: [guideApplication] })
    if (url === '/api/admin/v1/collections') return json({ items: [], nextCursor: null })
    if (url === `/api/admin/v1/applications/${guideApplication.id}/credentials`) return json({ items: [credential] })
    throw new Error(`unexpected fetch ${url}`)
  }))

  render(<ApplicationViews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Manage credentials' }))

  const table = await screen.findByRole('table', { name: 'Credentials' })
  expect(within(table).getByText('cck_abc123456789').tagName).toBe('CODE')
  expect(within(table).getByText('active').closest('[data-status]')).toHaveAttribute('data-status', 'active')
  expect(within(table).getByText('in 3 days')).toBeVisible()
  expect(within(table).getByText('Never')).toBeVisible()
})

test('revoking a credential confirms first and then reflects the new status in the row', async () => {
  const credential = {
    id: '65f000000000000000000030',
    name: 'production reader',
    prefix: 'cck_abc123456789',
    status: 'active',
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
  }
  const revokeCalls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/admin/v1/applications') return json({ items: [guideApplication] })
    if (url === '/api/admin/v1/collections') return json({ items: [], nextCursor: null })
    if (url === `/api/admin/v1/applications/${guideApplication.id}/credentials`) return json({ items: [credential] })
    if (url === `/api/admin/v1/credentials/${credential.id}/revoke`) {
      revokeCalls.push(url)
      return json({ ...credential, status: 'revoked', revokedAt: new Date().toISOString() })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))

  render(<ApplicationViews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Manage credentials' }))
  const table = await screen.findByRole('table', { name: 'Credentials' })
  fireEvent.click(within(table).getByRole('button', { name: 'Revoke production reader' }))

  const confirmation = await screen.findByRole('dialog', { name: 'Revoke credential' })
  expect(confirmation).toHaveTextContent('next API request')
  expect(revokeCalls).toHaveLength(0)

  fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm revoke' }))

  await waitFor(() => expect(revokeCalls).toHaveLength(1))
  await waitFor(() => expect(
    within(screen.getByRole('table', { name: 'Credentials' })).getByText('revoked').closest('[data-status]'),
  ).toHaveAttribute('data-status', 'revoked'))
})

test('a failed credential read shows ErrorState and the retry really reads again', async () => {
  let attempt = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/admin/v1/applications') return json({ items: [guideApplication] })
    if (url === '/api/admin/v1/collections') return json({ items: [], nextCursor: null })
    if (url === `/api/admin/v1/applications/${guideApplication.id}/credentials`) {
      attempt += 1
      if (attempt === 1) return json({ error: { code: 'service_unavailable' } }, 503)
      return json({ items: [{ id: 'credential-1', name: 'production reader', prefix: 'cck_abc123456789', status: 'active', expiresAt: null, revokedAt: null, lastUsedAt: null }] })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))

  render(<ApplicationViews />)
  fireEvent.click(await screen.findByRole('button', { name: 'Manage credentials' }))

  const failure = await screen.findByRole('alert')
  expect(failure).toHaveTextContent('Credentials could not load')

  fireEvent.click(within(failure).getByRole('button', { name: 'Try again' }))

  expect(await screen.findByRole('table', { name: 'Credentials' })).toBeVisible()
  expect(attempt).toBe(2)
})
