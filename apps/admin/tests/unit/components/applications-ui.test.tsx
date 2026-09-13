import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ApplicationViews } from '../../../src/components/applications/ApplicationViews'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubAdminFetch(applications: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url === '/api/admin/v1/applications' && (!init.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ items: applications }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url === '/api/admin/v1/collections') {
      return new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch ${url}`)
  }))
}

test('renders an explicit empty state when there are no consumer applications', async () => {
  stubAdminFetch([])
  render(<ApplicationViews />)

  expect(await screen.findByLabelText('No consumer applications yet')).toBeVisible()
  expect(screen.getByText('Create an application to issue scoped credentials for published Collections.')).toBeVisible()
})

test('renders application health as a semantic status pill', async () => {
  stubAdminFetch([{
    id: '65f000000000000000000020',
    name: 'Guide API',
    owner: 'Web',
    status: 'active',
    allowedCollectionIds: [],
    defaultRequestsPerMinute: 60,
    credentialsRevision: 0,
    revision: 1,
  }])
  render(<ApplicationViews />)

  const status = await screen.findByText('active')
  expect(status.closest('[data-status]')).toHaveAttribute('data-status', 'active')
})
