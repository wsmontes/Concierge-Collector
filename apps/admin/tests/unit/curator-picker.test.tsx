import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ContentFieldEditor } from '../../src/components/content/ContentFieldEditor'
import { CuratorPickerField } from '../../src/components/content/fields/CuratorPickerField'
import type { FieldNode } from '../../src/content/field-types'

/**
 * The node the Curation record builds for `curator_id`: a registered, editable
 * text field whose value is an opaque curator identity.
 */
const curatorNode: FieldNode = {
  path: 'curator_id',
  label: 'Curator',
  type: 'text',
  value: 'old@example.test',
  depth: 0,
  descriptor: null,
  owner: 'curation',
  editable: true,
  system: false,
  children: [],
}

const ana = { curator_id: 'ana@example.test', name: 'Ana Beatriz', email: 'ana@example.test' }
const wagner = { curator_id: 'wagner@example.test', name: 'Wagner Montes', email: 'wagner@example.test' }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('edits curator_id through the picker: the BFF directory supplies the value that gets applied', async () => {
  const fetcher = vi.fn(async () => Response.json({ items: [ana, wagner] }))
  vi.stubGlobal('fetch', fetcher)
  const onCommit = vi.fn()

  render(<ContentFieldEditor node={curatorNode} onCommit={onCommit} onCancel={vi.fn()} />)

  // The directory is what the browser reads — never the collector API directly.
  expect(await screen.findByRole('button', { name: /Ana Beatriz/ })).toBeVisible()
  expect(screen.getByRole('button', { name: /Wagner Montes/ })).toBeVisible()
  expect(fetcher).toHaveBeenCalledWith(
    '/api/admin/v1/records/curators',
    expect.objectContaining({ credentials: 'same-origin' }),
  )

  fireEvent.click(screen.getByRole('button', { name: /Wagner Montes/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Apply curator' }))

  expect(onCommit).toHaveBeenCalledWith('wagner@example.test')
})

test('searches the directory with what the editor typed', async () => {
  const fetcher = vi.fn(async () => Response.json({ items: [wagner] }))
  vi.stubGlobal('fetch', fetcher)

  render(<CuratorPickerField node={curatorNode} onCommit={vi.fn()} onCancel={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Curator'), { target: { value: '  wag  ' } })

  expect(await screen.findByRole('button', { name: /Wagner Montes/ })).toBeVisible()
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/admin/v1/records/curators?q=wag',
    expect.objectContaining({ credentials: 'same-origin' }),
  )
})

test('offers nothing and applies nothing until a curator is chosen', async () => {
  const search = vi.fn().mockResolvedValue([ana])
  const onCommit = vi.fn()

  render(
    <CuratorPickerField node={curatorNode} onCommit={onCommit} onCancel={vi.fn()} searchCurators={search} />,
  )

  const apply = await screen.findByRole('button', { name: 'Apply curator' })
  expect(apply).toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: /Ana Beatriz/ }))
  expect(apply).toBeEnabled()
  fireEvent.click(apply)

  expect(onCommit).toHaveBeenCalledWith('ana@example.test')
})

test('shows the BFF refusal as the BFF sent it, never as an empty directory', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    Response.json({ error: { code: 'authorization_revoked' } }, { status: 403 }),
  ))

  render(<CuratorPickerField node={curatorNode} onCommit={vi.fn()} onCancel={vi.fn()} />)

  expect(await screen.findByRole('alert')).toHaveTextContent('authorization_revoked')
  expect(screen.queryByRole('listitem')).toBeNull()
  expect(screen.getByRole('button', { name: 'Apply curator' })).toBeDisabled()
})
