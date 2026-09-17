import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  expect(screen.getByRole('link', { name: 'Manage Applications' })).toHaveAttribute('href', '/admin/applications')
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

test('o Retry volta a mostrar carregamento em vez de manter o erro antigo', async () => {
  // A recarga é um contador; se o carregamento fosse derivado só do id da
  // Collection (`loadedId === collectionId`), ele continuaria "carregado" depois
  // do Retry e a mensagem de erro antiga ficaria na tela durante toda a nova
  // requisição — sem esqueleto, sem sinal de que algo está acontecendo.
  let liberar: ((items: never[]) => void) | undefined
  const applicationsForCollection = vi
    .fn()
    .mockRejectedValueOnce(new Error('applications unavailable'))
    .mockImplementationOnce(
      () =>
        new Promise<never[]>((resolve) => {
          liberar = resolve
        }),
    )

  render(<CollectionDistributionView
    collectionId="col-1"
    lifecycle="published"
    currentPublishedVersion={3}
    client={{ applicationsForCollection }}
  />)

  expect(await screen.findByText('Distribution administration is unavailable')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

  await waitFor(() =>
    expect(screen.queryByText('Distribution administration is unavailable')).not.toBeInTheDocument(),
  )
  expect(applicationsForCollection).toHaveBeenCalledTimes(2)
  liberar?.([])
})
