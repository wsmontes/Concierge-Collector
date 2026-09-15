import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CurationDetailWorkspace } from '../../src/components/curations/CurationDetailWorkspace'

/**
 * The curation picker is only useful if the record page actually reaches it and
 * saves what it applies: this is the integration the unit tests above cannot
 * see — `curator_id` must stay a registry-editable field of the Inspector, and
 * applying there must go through the page's ordinary save path (the opened
 * version, the touched root key only) and re-read the record it returns.
 */

const CURATION_ID = 'cur_01HE90A'

const record: Record<string, unknown> = {
  curation_id: CURATION_ID,
  restaurant_name: 'Ritz',
  status: 'active',
  curator_id: 'curator_1',
  curator: { name: 'Wagner Montes', email: 'wagner@example.com' },
  curator_type: 'human',
  version: 7,
}

function inspectorRow(path: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.content-inspector__row'))
  const row = rows.find((candidate) => candidate.querySelector('.content-field__path')?.textContent === path)
  if (row === undefined) throw new Error(`No Inspector row rendered for "${path}"`)
  return row
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('applying a curator PATCHes curator_id through the existing save path and refreshes the derived name', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({
    items: [{ curator_id: 'ana@example.test', name: 'Ana Beatriz', email: 'ana@example.test' }],
  })))
  const saveRecord = vi.fn().mockResolvedValue({
    record: { ...record, curator_id: 'ana@example.test', curator: { name: 'Ana Beatriz', email: 'ana@example.test' } },
  })

  render(
    <CurationDetailWorkspace
      curationId={CURATION_ID}
      loadRecord={vi.fn().mockResolvedValue({ record, collections: [] })}
      saveRecord={saveRecord}
      navigate={vi.fn()}
    />,
  )
  await screen.findByRole('heading', { level: 1, name: 'Ritz' })

  const row = inspectorRow('curator_id')
  fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
  fireEvent.click(await within(row).findByRole('button', { name: /Ana Beatriz/ }))
  fireEvent.click(within(row).getByRole('button', { name: 'Apply curator' }))

  await waitFor(() => {
    expect(saveRecord).toHaveBeenCalledWith({
      curationId: CURATION_ID,
      updates: { curator_id: 'ana@example.test' },
      expectedVersion: 7,
    })
  })

  // The derived `curator.name` comes from the record the save returned; the
  // picker is already unmounted, so this text can only be the refreshed record.
  expect(await screen.findByText('Ana Beatriz')).toBeVisible()
})
