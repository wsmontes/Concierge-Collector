import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { DraftDiffView } from '../../../src/components/collections/DraftDiffView'
import { makeRows } from '../../support/factories'

/** §25: the draft diff reads as editorial decisions, grouped ADDED / REMOVED. */

const added = makeRows(1, {
  curation_id: 'cur_add',
  restaurant_name: 'Ritz Restaurant',
  curator_name: 'Wagner Montes',
  entity_type: 'Restaurant',
  city: 'São Paulo',
  concepts: ['Business', 'Casual'],
})[0]

const removed = makeRows(1, {
  curation_id: 'cur_remove',
  restaurant_name: 'D.O.M.',
  curator_name: 'Carla',
  entity_type: 'Restaurant',
  city: 'São Paulo',
  concepts: ['Fine Dining'],
})[0]

afterEach(cleanup)

describe('DraftDiffView', () => {
  test('groups the pending changes by desired state with human identities', () => {
    render(<DraftDiffView items={[
      { curationId: 'cur_add', desiredState: 'add', operationId: 'op_1', summary: added },
      { curationId: 'cur_remove', desiredState: 'remove', operationId: 'op_2', summary: removed },
    ]} />)

    expect(screen.getByRole('heading', { name: /ADDED/ })).toBeVisible()
    expect(screen.getByRole('heading', { name: /REMOVED/ })).toBeVisible()

    const addedList = screen.getByRole('list', { name: 'Draft changes ADDED' })
    expect(within(addedList).getByText('Ritz Restaurant')).toBeVisible()
    expect(within(addedList).getByText('Wagner Montes')).toBeVisible()
    expect(within(addedList).getByText('Restaurant · São Paulo')).toBeVisible()
    expect(within(addedList).getByText('Business')).toBeVisible()
    expect(within(addedList).queryByText('D.O.M.')).toBeNull()

    const removedList = screen.getByRole('list', { name: 'Draft changes REMOVED' })
    expect(within(removedList).getByText('D.O.M.')).toBeVisible()
    expect(within(removedList).getByText('Carla')).toBeVisible()
    expect(within(removedList).getByText('Fine Dining')).toBeVisible()
  })

  test('keeps the ids and the operation linkage inside the collapsed disclosure', () => {
    render(<DraftDiffView items={[
      { curationId: 'cur_add', desiredState: 'add', operationId: 'op_1', summary: added },
    ]} />)

    const row = screen.getByRole('list', { name: 'Draft changes ADDED' }).querySelector('li')
    expect(row?.querySelector('.collection-curation__name')?.textContent).toBe('Ritz Restaurant')

    const details = row?.querySelector('details')
    expect(details?.open).toBe(false)
    expect(within(details as HTMLElement).getByText('cur_add')).toBeTruthy()
    expect(within(details as HTMLElement).getByText('op_1')).toBeTruthy()
  })

  test('degrades a change whose Curation left the catalog, and states an empty group', () => {
    render(<DraftDiffView items={[
      { curationId: 'cur_gone', desiredState: 'remove', operationId: 'op_3', summary: null },
    ]} />)

    expect(screen.getByText('No additions pending.')).toBeVisible()

    const removedList = screen.getByRole('list', { name: 'Draft changes REMOVED' })
    expect(within(removedList).getByText('No longer in the catalog')).toBeVisible()
    expect(within(removedList).getByText('cur_gone')).toBeVisible()
    // The operation that linked the change stays reachable.
    expect(within(removedList).getByText('op_3')).toBeTruthy()
  })
})
