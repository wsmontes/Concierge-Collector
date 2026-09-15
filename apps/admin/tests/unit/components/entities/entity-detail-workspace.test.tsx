import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { EntityDetailWorkspace } from '../../../../src/components/entities/EntityDetailWorkspace'
import { EntityDetailError } from '../../../../src/components/entities/entity-detail-client'
import type { SaveEntityRecord } from '../../../../src/content/record-types'
import { isRecord } from '../../../../src/content/value-guards'

/**
 * The Entity full-record page is exercised through its injected loaders: the
 * record that comes back is the whole fixture, and every assertion is about
 * what an editor can see, click and save.
 */

afterEach(cleanup)

const ENTITY_DATA: Record<string, unknown> = {
  city: 'São Paulo',
  address: { street: 'Rua Augusta 1', postalCode: '01304-000' },
  website: 'https://ritz.example',
  phone: '+55 11 5555 0100',
  priceLevel: 3,
  photos: [{ url: 'https://cdn.example/ritz.jpg' }],
}

const ENTITY_RECORD: Record<string, unknown> = {
  _id: 'ent_1',
  entity_id: 'entity-ritz',
  name: 'Ritz Restaurant',
  type: 'restaurant',
  status: 'active',
  externalId: 'ext-9',
  data: ENTITY_DATA,
  metadata: [{ type: 'google_places', source: 'places', data: { place_id: 'abc' } }],
  sync: { status: 'synced' },
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-02-03T18:30:00.000Z',
  createdBy: 'curator-1',
  updatedBy: 'curator-2',
  version: 7,
}

const CURATION_ROW: Record<string, unknown> = {
  _id: 'cur_1',
  curation_id: 'cur_1',
  restaurant_name: 'Ritz Restaurant',
  status: 'active',
  curator: { id: 'curator-9', name: 'Wagner Montes' },
  curator_type: 'human',
  categories: { Occasion: ['Business'], Mood: ['Casual', 'Friends'] },
  updatedAt: '2026-02-01T10:00:00.000Z',
}

/**
 * The gallery an Entity with no resolved image reports. Injected everywhere the
 * page renders, so no test reaches the media BFF through the browser client.
 */
const NO_IMAGES = async () => ({ items: [] })

function fieldBlock(path: string): HTMLElement {
  const block = document.querySelector<HTMLElement>(`.entity-field[data-path="${path}"]`)
  if (block === null) throw new Error(`No Entity field block rendered for path "${path}"`)
  return block
}

function section(title: string): HTMLElement {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('.admin-section'))
  const found = sections.find((candidate) => candidate.querySelector('h2')?.textContent === title)
  if (found === undefined) throw new Error(`No section rendered titled "${title}"`)
  return found
}

function inspectorValue(path: string): string {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.content-inspector__row'))
  const row = rows.find((candidate) => candidate.querySelector('.content-field__path')?.textContent === path)
  if (row === undefined) throw new Error(`No All fields row rendered for path "${path}"`)
  return row.querySelector('.content-field__value')?.textContent ?? ''
}

function inspectorPaths(): string[] {
  return Array.from(document.querySelectorAll('.content-inspector__row .content-field__path')).map(
    (element) => element.textContent ?? '',
  )
}

async function openEditor(path: string) {
  fireEvent.click(within(fieldBlock(path)).getByRole('button', { name: 'Edit' }))
  await waitFor(() => expect(within(fieldBlock(path)).getByRole('button', { name: 'Save' })).toBeVisible())
  return fieldBlock(path)
}

describe('EntityDetailWorkspace', () => {
  test('shows a loading surface before the record resolves', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    // The loader has not settled inside this sync act, so the page is mid-load.
    expect(screen.getByText('Loading Entity…')).toHaveAttribute('role', 'status')
    // Let the pending load settle so its update is not left un-flushed.
    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
  })

  test('renders the header, canonical identity and history from the stored record', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    const header = document.querySelector<HTMLElement>('.entity-detail__header')
    expect(header).not.toBeNull()
    if (header === null) return
    expect(within(header).getByText('Restaurant')).toBeVisible()
    expect(within(header).getByText('São Paulo')).toBeVisible()
    expect(within(header).getByText('ext-9')).toBeVisible()
    expect(within(header).getByText('Active').closest('[data-status]')).toHaveAttribute('data-status', 'active')

    const canonical = section('Canonical identity')
    expect(within(canonical).getByText('name')).toBeVisible()
    expect(within(canonical).getByText('type')).toBeVisible()
    expect(within(canonical).getByText('status')).toBeVisible()
    expect(within(canonical).getByText('externalId')).toBeVisible()
    // Every canonical field is editable through the registry editor.
    expect(within(canonical).getAllByRole('button', { name: 'Edit' })).toHaveLength(4)

    const history = section('History')
    expect(within(history).getByText('entity_id')).toBeVisible()
    expect(within(history).getByText('entity-ritz')).toBeVisible()
    expect(within(history).getByText('version')).toBeVisible()
    expect(within(history).getByText('7')).toBeVisible()
    expect(within(history).getByText('createdBy')).toBeVisible()
    expect(within(history).getByText('curator-1')).toBeVisible()
  })

  test('renders location, contact, media, attributes and metadata from what the record stores', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    expect(within(section('Location')).getByText('data.city')).toBeVisible()
    expect(within(section('Location')).getByText('São Paulo')).toBeVisible()
    expect(within(section('Location')).getByText('data.address.street')).toBeVisible()
    expect(within(section('Location')).getByText('Rua Augusta 1')).toBeVisible()
    // The location surface carries only location keys.
    expect(within(section('Location')).queryByText('Price Level')).toBeNull()

    expect(within(section('Contact')).getByText('data.phone')).toBeVisible()
    expect(within(section('Contact')).getByText('+55 11 5555 0100')).toBeVisible()
    expect(within(section('Contact')).getByText('data.website')).toBeVisible()

    expect(within(section('Media')).getByText('data.photos')).toBeVisible()

    const attributes = section('Attributes')
    expect(within(attributes).getByText('data.priceLevel')).toBeVisible()
    expect(within(attributes).getByText('Price Level').closest('.entity-field')).toHaveTextContent(
      'Not in the field registry',
    )

    const metadata = section('Metadata')
    expect(within(metadata).getByText('metadata[0].type')).toBeVisible()
    expect(within(metadata).getByText('google_places')).toBeVisible()
    expect(within(metadata).getByText('sync.status')).toBeVisible()
    expect(within(metadata).getByText('synced')).toBeVisible()
  })

  test('renders the All fields inspector with record-local search over names and values', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    expect(screen.getByRole('heading', { name: 'All stored fields' })).toBeVisible()
    expect(inspectorValue('name')).toBe('Ritz Restaurant')
    expect(inspectorValue('data.priceLevel')).toBe('3')

    const search = screen.getByLabelText('Search fields')

    // A value the editor knows but the field name does not: only the holder stays.
    fireEvent.change(search, { target: { value: 'entity-ritz' } })
    expect(inspectorPaths()).toEqual(['entity_id'])

    // A field name keeps the matching branch and drops unrelated sections.
    fireEvent.change(search, { target: { value: 'phone' } })
    expect(inspectorPaths()).toContain('data.phone')
    expect(inspectorPaths()).not.toContain('name')
    expect(inspectorPaths()).not.toContain('metadata[0].type')

    fireEvent.change(search, { target: { value: '' } })
    expect(inspectorPaths()).toContain('name')
  })

  test('edits a field through the All fields inspector over the same save path', async () => {
    const saveRecord = vi.fn<SaveEntityRecord>(async () => ({
      record: { ...ENTITY_RECORD, externalId: 'ext-77' },
    }))
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={saveRecord}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    const row = Array.from(document.querySelectorAll<HTMLElement>('.content-inspector__row')).find(
      (candidate) => candidate.querySelector('.content-field__path')?.textContent === 'externalId',
    )
    expect(row).not.toBeUndefined()
    if (row === undefined) return
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    // The block owns its own surface: opening the inspector row never opens a
    // second editor on the same path in Canonical identity.
    expect(within(fieldBlock('externalId')).queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.change(within(row).getByRole('textbox'), { target: { value: 'ext-77' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveRecord).toHaveBeenCalledTimes(1))
    expect(saveRecord.mock.calls[0][0]).toEqual({
      entityId: 'ent_1',
      updates: { externalId: 'ext-77' },
      expectedVersion: 7,
    })
    await screen.findByText('Saved externalId.')
    expect(inspectorValue('externalId')).toBe('ext-77')
  })

  test('saves a canonical string field as one top-level key with the loaded version', async () => {
    const saveRecord = vi.fn<SaveEntityRecord>(async () => ({ record: { ...ENTITY_RECORD, name: 'Le Grand Ritz' } }))
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={saveRecord}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
    const block = await openEditor('name')
    fireEvent.change(within(block).getByRole('textbox'), { target: { value: 'Le Grand Ritz' } })
    fireEvent.click(within(block).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveRecord).toHaveBeenCalledTimes(1))
    expect(saveRecord.mock.calls[0][0]).toEqual({
      entityId: 'ent_1',
      updates: { name: 'Le Grand Ritz' },
      expectedVersion: 7,
    })
    await screen.findByText('Saved name.')
    expect(within(fieldBlock('name')).getByText('Le Grand Ritz')).toBeVisible()
    expect(screen.getByRole('heading', { level: 1, name: 'Le Grand Ritz' })).toBeVisible()
  })

  test('renders type and status as enum controls holding the registry values', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    const typeBlock = await openEditor('type')
    const typeSelect = within(typeBlock).getByRole('combobox')
    expect(typeSelect).toHaveValue('restaurant')
    for (const value of ['restaurant', 'hotel', 'venue', 'bar', 'cafe', 'other']) {
      expect(within(typeBlock).getByRole('option', { name: value })).toBeVisible()
    }

    const statusBlock = await openEditor('status')
    const statusSelect = within(statusBlock).getByRole('combobox')
    expect(statusSelect).toHaveValue('active')
    for (const value of ['active', 'inactive', 'draft']) {
      expect(within(statusBlock).getByRole('option', { name: value })).toBeVisible()
    }
    expect(within(statusBlock).queryByRole('option', { name: 'restaurant' })).toBeNull()
  })

  test('saves an unregistered data key as the whole data blob for that path', async () => {
    const saveRecord = vi.fn<SaveEntityRecord>(async () => ({
      record: { ...ENTITY_RECORD, data: { ...ENTITY_DATA, priceLevel: 4 } },
    }))
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={saveRecord}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    const block = await openEditor('data.priceLevel')
    expect(within(block).getByText('Not in the field registry')).toBeVisible()
    fireEvent.change(within(block).getByRole('textbox'), { target: { value: '4' } })
    fireEvent.click(within(block).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveRecord).toHaveBeenCalledTimes(1))
    const input = saveRecord.mock.calls[0][0]
    expect(Object.keys(input.updates)).toEqual(['data'])
    expect(input.expectedVersion).toBe(7)
    const data = input.updates.data
    expect(isRecord(data)).toBe(true)
    if (!isRecord(data)) return
    expect(data.priceLevel).toBe(4)
    expect(data.city).toBe('São Paulo')
    expect(data.phone).toBe('+55 11 5555 0100')
    expect(data.address).toEqual({ street: 'Rua Augusta 1', postalCode: '01304-000' })
  })

  test('keeps the draft and the stored value when the save conflicts', async () => {
    const saveRecord = vi.fn(async () => {
      throw new EntityDetailError(409, 'version_conflict')
    })
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={saveRecord}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
    const block = await openEditor('name')
    fireEvent.change(within(block).getByRole('textbox'), { target: { value: 'Contested name' } })
    fireEvent.click(within(block).getByRole('button', { name: 'Save' }))

    await screen.findByText('This Entity changed while you were editing it.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
    // The draft survives: the editor is still open with what the editor typed.
    expect(within(fieldBlock('name')).getByRole('textbox')).toHaveValue('Contested name')
    // Nothing was overwritten: the record still holds the value it was loaded with.
    expect(inspectorValue('name')).toBe('Ritz Restaurant')
    expect(screen.getByRole('heading', { level: 1, name: 'Ritz Restaurant' })).toBeVisible()
  })

  test('reloads the latest record after a conflict without saving anything', async () => {
    const saveRecord = vi.fn(async () => {
      throw new EntityDetailError(409, 'version_conflict')
    })
    const loadRecord = vi.fn(async () => ({ record: ENTITY_RECORD }))
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={loadRecord}
        saveRecord={saveRecord}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
    const block = await openEditor('name')
    fireEvent.change(within(block).getByRole('textbox'), { target: { value: 'Contested name' } })
    fireEvent.click(within(block).getByRole('button', { name: 'Save' }))
    await screen.findByText('This Entity changed while you were editing it.')

    loadRecord.mockResolvedValueOnce({ record: { ...ENTITY_RECORD, name: 'Server name', version: 8 } })
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))

    await screen.findByRole('heading', { level: 1, name: 'Server name' })
    expect(screen.queryByText('This Entity changed while you were editing it.')).toBeNull()
    expect(within(fieldBlock('name')).getByRole('button', { name: 'Edit' })).toBeVisible()
    expect(loadRecord).toHaveBeenCalledTimes(2)
    expect(saveRecord).toHaveBeenCalledTimes(1)
  })

  test('renders system-managed fields read-only with no Edit affordance', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    for (const path of ['entity_id', 'version', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']) {
      const block = fieldBlock(path)
      expect(within(block).queryByRole('button')).toBeNull()
      expect(within(block).getByText('System managed')).toBeVisible()
    }
    // The identity other records point at is never editable from this page.
    expect(within(section('Canonical identity')).queryByText('entity_id')).toBeNull()
  })

  test('lists the Curations about this Entity with links, kind, status and concepts', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [CURATION_ROW], total: 1 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })

    const curations = section('Curations about this Entity')
    await within(curations).findByText('1 Curation')
    const link = within(curations).getByRole('link', { name: 'Wagner Montes' })
    expect(link).toHaveAttribute('href', '/admin/curations/cur_1')
    expect(within(curations).getByText('Human')).toBeVisible()
    expect(within(curations).getByText('Active').closest('[data-status]')).toHaveAttribute('data-status', 'active')
    expect(within(curations).getByText('Business')).toBeVisible()
    expect(within(curations).getByText('Casual')).toBeVisible()
    expect(within(curations).getByText('Friends')).toBeVisible()
    expect(within(curations).getByText(/^Updated /)).toBeVisible()
    // The stored id identifies the row; it is never the row's label.
    expect(within(curations).queryByText('cur_1')).toBeNull()
  })

  test('routes a Curation row through the injected navigate', async () => {
    const navigate = vi.fn()
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [CURATION_ROW], total: 1 })}
        loadImages={NO_IMAGES}
        navigate={navigate}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
    fireEvent.click(await screen.findByRole('link', { name: 'Wagner Montes' }))

    expect(navigate).toHaveBeenCalledWith('/admin/curations/cur_1')
  })

  test('shows an explicit empty state when the Entity has no Curations', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
    expect(await screen.findByRole('heading', { name: 'No Curations about this Entity' })).toBeVisible()
  })

  test('shows explicit empty states for sections the record does not feed', async () => {
    const bare: Record<string, unknown> = {
      entity_id: 'entity-bare',
      name: 'Bare Entity',
      type: 'other',
      status: 'draft',
      version: 1,
    }
    render(
      <EntityDetailWorkspace
        entityId="ent_2"
        loadRecord={async () => ({ record: bare })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Bare Entity' })
    expect(await screen.findByRole('heading', { name: 'No location stored' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'No contact stored' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'No media stored' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'No attributes stored' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'No metadata stored' })).toBeVisible()
    // A registered canonical field the record does not carry is still named.
    expect(within(section('Canonical identity')).getByText('Not set')).toBeVisible()
  })

  test('renders a not-found surface for a 404', async () => {
    render(
      <EntityDetailWorkspace
        entityId="missing"
        loadRecord={async () => {
          throw new EntityDetailError(404, 'not_found')
        }}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    expect(await screen.findByRole('heading', { level: 1, name: 'Entity not found' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to Entities' })).toHaveAttribute('href', '/admin/entities')
  })

  test('renders an error state whose retry loads the record again', async () => {
    const loadRecord = vi.fn()
      .mockRejectedValueOnce(new EntityDetailError(503, 'unavailable'))
      .mockResolvedValueOnce({ record: ENTITY_RECORD })
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={loadRecord}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={NO_IMAGES}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('The Entity service is unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })).toBeVisible()
    expect(loadRecord).toHaveBeenCalledTimes(2)
  })

  test('shows the Entity image the gallery resolves as the Media thumbnail', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={async () => ({
          items: [
            { rank: 0, source: 'website_og', url: '/api/admin/v1/records/entities/ent_1/image?rank=0' },
            { rank: 1, source: 'google_places', url: '/api/admin/v1/records/entities/ent_1/image?rank=1' },
          ],
        })}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
    const thumbnail = await within(section('Media')).findByRole('img', { name: 'Entity image' })
    // The rank-0 hero, fetched through the BFF: never a boundary or origin URL.
    expect(thumbnail).toHaveAttribute('src', '/api/admin/v1/records/entities/ent_1/image?rank=0')
    expect(within(section('Media')).getByRole('link', { name: 'Open image' }))
      .toHaveAttribute('href', '/api/admin/v1/records/entities/ent_1/image?rank=0')
  })

  test('says the Entity has no image instead of rendering a broken frame', async () => {
    render(
      <EntityDetailWorkspace
        entityId="ent_1"
        loadRecord={async () => ({ record: ENTITY_RECORD })}
        saveRecord={vi.fn()}
        loadCurations={async () => ({ items: [], total: 0 })}
        loadImages={async () => {
          throw new EntityDetailError(404, 'not_found')
        }}
      />,
    )

    await screen.findByRole('heading', { level: 1, name: 'Ritz Restaurant' })
    const media = section('Media')
    expect(await within(media).findByText('No image is available for this Entity.')).toBeVisible()
    expect(within(media).queryByRole('img')).toBeNull()
  })
})
