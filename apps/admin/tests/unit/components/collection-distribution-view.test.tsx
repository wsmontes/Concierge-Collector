import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CollectionDistributionView } from '../../../src/components/collections/CollectionDistributionView'
import type { CollectionDistributionClient } from '../../../src/collections/distribution-client'

afterEach(() => cleanup())

function client(items = [{ id: 'app-1', name: 'Guide API', owner: 'Guide Team', status: 'active' as const, defaultRequestsPerMinute: 60 }]): CollectionDistributionClient {
  return { applicationsForCollection: vi.fn().mockResolvedValue(items) }
}

test('shows consumer applications that currently allow the Collection', async () => {
  render(<CollectionDistributionView
    collectionId="col-1"
    lifecycle="published"
    currentPublishedVersion={3}
    client={client()}
  />)

  expect(await screen.findByRole('heading', { name: 'Guide API' })).toBeVisible()
  expect(screen.getByText('Guide Team · active · 60/min')).toBeVisible()
  expect(screen.getByText('Published version 3 is the externally addressable Collection version.')).toBeVisible()
  expect(screen.getByRole('link', { name: 'Manage consumer applications' })).toHaveAttribute('href', '/admin/applications')
})

test('explains archive as a reversible distribution kill switch', async () => {
  render(<CollectionDistributionView
    collectionId="col-1"
    lifecycle="archived"
    currentPublishedVersion={3}
    client={client()}
  />)

  expect(await screen.findByText(/public Collection reads return 410/i)).toBeVisible()
  expect(screen.getByText(/allowlists are preserved for restore/i)).toBeVisible()
})

test('does not imply distribution before the first publish', async () => {
  render(<CollectionDistributionView
    collectionId="col-1"
    lifecycle="draft"
    currentPublishedVersion={null}
    client={client([])}
  />)
  expect(screen.getByText('This Collection has not been published yet.')).toBeVisible()
})
