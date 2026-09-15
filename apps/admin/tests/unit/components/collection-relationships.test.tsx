import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CollectionRelationships, relationshipsOf } from '../../../src/components/collections/CollectionRelationships'
import { makeRows } from '../../support/factories'

/** §26: the Collection's relationships, counted over the loaded page only. */

const ritz = makeRows(1, { curation_id: 'cur_1', restaurant_name: 'Ritz Restaurant', curator_id: 'admin-1' })[0]
// Same Entity and same Curator as `ritz`: only the stored spelling differs.
const ritzAgain = makeRows(1, { curation_id: 'cur_2', restaurant_name: 'ritz restaurant', curator_id: 'admin-1' })[0]
const dom = makeRows(1, { curation_id: 'cur_3', restaurant_name: 'D.O.M.', curator_id: 'admin-2' })[0]
const cantina = makeRows(1, { curation_id: 'cur_4', restaurant_name: 'Cantina', curator_id: null, curator_name: 'Carla' })[0]

const loaded = [ritz, ritzAgain, dom, cantina].map((row) => ({ curationId: row.curation_id, summary: row }))

function fact(facts: HTMLElement, term: string): string {
  const label = within(facts).getByText(term)
  return label.parentElement?.querySelector('dd')?.textContent ?? ''
}

afterEach(cleanup)

describe('relationshipsOf', () => {
  test('counts distinct entities and curators over the loaded summaries', () => {
    expect(relationshipsOf(loaded)).toEqual({ curations: 4, entities: 3, curators: 3, withoutSummary: 0 })
  })

  test('leaves a member with no catalog row out of the counts and reports it', () => {
    expect(relationshipsOf([
      { curationId: 'cur_1', summary: ritz },
      { curationId: 'cur_gone', summary: null },
    ])).toEqual({ curations: 2, entities: 1, curators: 1, withoutSummary: 1 })
  })
})

describe('CollectionRelationships', () => {
  test('says a bounded page is bounded instead of claiming a Collection total', () => {
    const { container } = render(<CollectionRelationships hasMore members={loaded} />)

    const facts = container.querySelector('.collection-relationships__facts') as HTMLElement
    expect(fact(facts, 'Curations')).toBe('4')
    expect(fact(facts, 'Entities represented')).toBe('3')
    expect(fact(facts, 'Curators represented')).toBe('3')

    expect(screen.getByText('Based on the first 4 members.')).toBeVisible()
    expect(screen.queryByText(/Based on all/)).toBeNull()
    expect(screen.queryByText(/^4 Curations/)).toBeNull()
  })

  test('marks a complete page as the whole loaded set and reports the excluded members', () => {
    render(<CollectionRelationships members={[...loaded, { curationId: 'cur_gone', summary: null }]} />)

    expect(screen.getByText('Based on all 5 loaded members.')).toBeVisible()
    expect(screen.queryByText(/Based on the first/)).toBeNull()
    expect(screen.getByText('1 loaded member is no longer in the catalog and is not counted.')).toBeVisible()
  })

  test('renders no counts before any member is loaded', () => {
    render(<CollectionRelationships members={[]} />)

    expect(screen.getByText('No members loaded yet.')).toBeVisible()
    expect(screen.queryByText('Curations')).toBeNull()
  })
})
