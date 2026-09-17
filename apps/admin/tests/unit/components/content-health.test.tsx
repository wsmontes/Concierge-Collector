import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ContentHealthView, type ContentHealth } from '../../../src/components/overview/ContentHealthView'

const health: ContentHealth = {
  total: 18430,
  unlinked: 1203,
  synthetic_drafts: 312,
  without_images: 630,
  entities_total: 21600,
  entities_display_media_resolved: 1500,
  entities_no_sources: 100,
  entities_unresolved: 20000,
  without_transcript: 4021,
  updated_today: 125,
  without_collections: 2491,
  collections_members_tracked: 9420,
  degraded: null,
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function link(name: string | RegExp): HTMLElement {
  return screen.getByRole('link', { name })
}

/**
 * The list's advanced-filter wire contract: a repeated `where` query parameter
 * whose every value is URL-encoded JSON. Decoding it here is what proves the
 * card and the list agree on the clause.
 */
function whereClauses(href: string | null): unknown[] {
  const query = href?.split('?')[1] ?? ''
  return new URLSearchParams(query).getAll('where').map((raw) => JSON.parse(raw))
}

function renderWith(loadHealth: () => Promise<ContentHealth>) {
  return render(<ContentHealthView loadHealth={loadHealth} />)
}

test('renders every counter the loader reports, localized', async () => {
  renderWith(vi.fn().mockResolvedValue(health))

  expect(await screen.findByRole('link', { name: '18,430 Curations' })).toBeVisible()
  expect(link('1,203 Unlinked')).toBeVisible()
  expect(link('312 Synthetic drafts')).toBeVisible()
  expect(link('630 Without evidence media')).toBeVisible()
  expect(link('4,021 Without transcript')).toBeVisible()
  expect(link('125 Updated today')).toBeVisible()
  expect(link(/Without Collections/)).toBeVisible()
})

test('every filtering card links to a query the Curations list honours', async () => {
  renderWith(vi.fn().mockResolvedValue(health))
  await screen.findByRole('link', { name: '18,430 Curations' })

  // The unfiltered list is the only honest destination for the whole catalog.
  expect(link('18,430 Curations')).toHaveAttribute('href', '/admin/curations')
  expect(link('1,203 Unlinked')).toHaveAttribute('href', '/admin/curations?unlinked=true')
  // No `updated_after` parameter exists yet: the card opens the newest-first
  // list and its title says exactly that.
  expect(link('125 Updated today')).toHaveAttribute('href', '/admin/curations?sort=updated_at_desc')
  expect(link('125 Updated today')).toHaveAttribute('title', expect.stringContaining('no updated-after parameter'))
  // The "without Collections" view is a query the list honours: the card opens
  // exactly the set it counted (same membership-ledger predicate).
  expect(link(/Without Collections/)).toHaveAttribute('href', '/admin/curations?without_collections=true')
  expect(link(/Without Collections/)).toHaveAttribute('title', expect.stringContaining('membership ledger'))
})

test('the two is_empty cards decode back to the frozen where clause', async () => {
  renderWith(vi.fn().mockResolvedValue(health))
  await screen.findByRole('link', { name: '18,430 Curations' })

  expect(whereClauses(link('630 Without evidence media').getAttribute('href')))
    .toEqual([{ field: 'sources.image', op: 'is_empty' }])
  expect(whereClauses(link('4,021 Without transcript').getAttribute('href')))
    .toEqual([{ field: 'transcript', op: 'is_empty' }])
})

test('the synthetic-draft card keeps the draft status and filters the synthetic curator', async () => {
  renderWith(vi.fn().mockResolvedValue(health))

  const card = await screen.findByRole('link', { name: '312 Synthetic drafts' })
  const href = card.getAttribute('href')
  expect(new URLSearchParams(href?.split('?')[1] ?? '').getAll('status')).toEqual(['draft'])
  expect(whereClauses(href)).toEqual([{ field: 'curator_type', op: 'equals', value: 'synthetic' }])
})

test('reports a degraded answer and renders an unreported counter as unknown, not zero', async () => {
  const degraded = 'The CMS membership ledger exceeds the boundary cap, so "Without Collections" is unavailable.'
  renderWith(vi.fn().mockResolvedValue({ ...health, without_collections: null, degraded }))

  expect(await screen.findByText(degraded)).toBeVisible()
  const card = link(/Without Collections/)
  expect(within(card).getByText('—')).toBeVisible()
  expect(within(card).queryByText('0')).toBeNull()
  // The ledger size stays reported, so the card can state where the count comes from.
  expect(within(card).getByText(/tracks 9,420 Curations/)).toBeVisible()
})

test('offers a retry when the BFF fails, and recovers on demand', async () => {
  const loadHealth = vi.fn()
    .mockRejectedValueOnce(new Error('service_unavailable'))
    .mockResolvedValueOnce(health)
  renderWith(loadHealth)

  expect(await screen.findByRole('alert')).toHaveTextContent('service_unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

  expect(await screen.findByRole('link', { name: '18,430 Curations' })).toBeVisible()
  expect(loadHealth).toHaveBeenCalledTimes(2)
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

test('shows a loading status until the loader settles', async () => {
  let settle: (value: ContentHealth) => void = () => {}
  const pending = new Promise<ContentHealth>((resolve) => {
    settle = resolve
  })
  renderWith(() => pending)

  expect(screen.getByRole('status')).toHaveTextContent('Loading content health')
  settle(health)
  expect(await screen.findByRole('link', { name: '18,430 Curations' })).toBeVisible()
})

test('the default loader reads the Admin BFF route with the session cookie', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(health), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetcher)

  render(<ContentHealthView />)

  expect(await screen.findByRole('link', { name: '18,430 Curations' })).toBeVisible()
  expect(fetcher).toHaveBeenCalledWith(
    '/api/admin/v1/records/content-health',
    expect.objectContaining({ credentials: 'same-origin' }),
  )
})


test('a cobertura de mídia de exibição aparece separada da evidência da Curation', async () => {
  // Os dois números nomeiam fatos DIFERENTES: `without_images` conta a evidência
  // que o curador capturou (sources.image da Curation); o grupo de mídia de
  // exibição conta o hero que o card mostra (Entity + website/Places). Antes
  // desta separação o painel exibia um número com o nome do outro.
  renderWith(vi.fn().mockResolvedValue(health))

  expect(await screen.findByText('Entity display media')).toBeVisible()
  expect(screen.getByText('1,500')).toBeVisible()
  expect(screen.getByText('With a display image')).toBeVisible()
  expect(screen.getByText('No source at all')).toBeVisible()
  expect(screen.getByText('Not yet resolved')).toBeVisible()
  expect(screen.getByText('Entity display media')).toBeVisible()
})
