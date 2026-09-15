import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ContentFieldInspector } from '../../../../src/components/content/ContentFieldInspector'
import type { FieldDescriptor, FieldNode } from '../../../../src/content/field-types'

/**
 * The Field Inspector is a presentational surface: the parent owns the record,
 * the search term and the editing path. Every fixture below is local and
 * explicit, and every assertion is about what an editor can see and click.
 */

type RenderEditor = (node: FieldNode, commit: (value: unknown) => void, cancel: () => void) => ReactNode

function rowFor(path: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('.content-inspector__row'))
  const row = rows.find((candidate) => candidate.querySelector('.content-field__path')?.textContent === path)
  if (row === undefined) throw new Error(`No field row rendered for path "${path}"`)
  return row
}

function renderedPaths(): string[] {
  return Array.from(document.querySelectorAll('.content-inspector__tree .content-field__path')).map(
    (element) => element.textContent ?? '',
  )
}

function previewOf(path: string): string {
  return rowFor(path).querySelector('.content-field__value')?.textContent ?? ''
}

const nestedRecord = {
  restaurant_name: 'Le Bernardin',
  notes: { public: 'Corner table', private: 'Never publish' },
  status: 'draft',
}

const nestedDescriptors: readonly FieldDescriptor[] = [
  {
    path: 'restaurant_name',
    label: 'Restaurant name',
    owner: 'curation',
    type: 'text',
    editable: true,
  },
]

const deepRecord = {
  restaurant_name: 'Le Bernardin',
  contact: { phone: '+1 250 555 0134' },
  notes: { public: 'Corner table please' },
}

const editableRecord = {
  restaurant_name: 'Le Bernardin',
  notes: { public: 'Corner table' },
  city: 'New York',
  version: 7,
}

const editableDescriptors: readonly FieldDescriptor[] = [
  {
    path: 'restaurant_name',
    label: 'Restaurant name',
    owner: 'curation',
    type: 'text',
    editable: true,
  },
  { path: 'notes', label: 'Notes', owner: 'curation', type: 'object', editable: false },
  {
    path: 'notes.public',
    label: 'Public recommendation',
    owner: 'curation',
    type: 'longText',
    editable: true,
  },
  {
    path: 'city',
    label: 'City',
    owner: 'entity',
    type: 'text',
    editable: false,
    derivedFrom: 'Entity',
  },
  { path: 'version', label: 'Version', owner: 'system', type: 'number', editable: true, system: true },
]

describe('ContentFieldInspector', () => {
  afterEach(cleanup)

  test('renders one row per stored key, nested paths included', () => {
    render(
      <ContentFieldInspector
        record={nestedRecord}
        kind="curation"
        descriptors={nestedDescriptors}
        label="All fields"
        search=""
        onSearchChange={() => {}}
      />,
    )

    const paths = renderedPaths()
    expect(paths).toHaveLength(5)
    expect(new Set(paths)).toEqual(
      new Set(['restaurant_name', 'notes', 'notes.public', 'notes.private', 'status']),
    )
    expect(within(rowFor('restaurant_name')).getByText('Restaurant name')).toBeVisible()
    expect(within(rowFor('notes')).getByText('Curation')).toBeVisible()
    expect(rowFor('notes').getAttribute('style') ?? '').toMatch(/0px/)
    expect(rowFor('notes.public').getAttribute('style') ?? '').toMatch(/14px/)
    expect(rowFor('notes').getAttribute('data-owner')).toBe('curation')
  })

  test('keeps ancestors and hides unrelated rows when only the value matches', () => {
    render(
      <ContentFieldInspector
        record={deepRecord}
        kind="curation"
        descriptors={[]}
        label="All fields"
        search="+1 250 555"
        onSearchChange={() => {}}
      />,
    )

    expect(new Set(renderedPaths())).toEqual(new Set(['contact', 'contact.phone']))
    expect(rowFor('contact.phone').textContent).toContain('+1 250 555 0134')
  })

  test('matches a field by its name', () => {
    render(
      <ContentFieldInspector
        record={deepRecord}
        kind="curation"
        descriptors={[]}
        label="All fields"
        search="restaurant"
        onSearchChange={() => {}}
      />,
    )

    expect(renderedPaths()).toEqual(['restaurant_name'])
  })

  test('lists registered fields the record does not hold as declared but empty', () => {
    render(
      <ContentFieldInspector
        record={editableRecord}
        kind="curation"
        descriptors={[
          ...editableDescriptors,
          {
            path: 'catalog_sequence',
            label: 'Catalog sequence',
            owner: 'system',
            type: 'number',
            system: true,
          },
        ]}
        label="All fields"
        search=""
        onSearchChange={() => {}}
      />,
    )

    const declared = document.querySelector<HTMLElement>('.content-inspector__declared')
    expect(declared).not.toBeNull()
    if (declared === null) return
    expect(within(declared).getByRole('heading', { name: 'Declared but empty' })).toBeVisible()
    expect(within(declared).getByText('Catalog sequence')).toBeVisible()
    expect(within(declared).getByText('catalog_sequence')).toBeVisible()
    // A field the record holds is never "declared but empty", and an empty
    // declaration has nothing to edit yet.
    expect(within(declared).queryByText('city')).toBeNull()
    expect(within(declared).queryByRole('button')).toBeNull()
  })

  test('offers Edit only for editable rows and hands the node to the parent', () => {
    const onRequestEdit = vi.fn<(node: FieldNode) => void>()
    render(
      <ContentFieldInspector
        record={editableRecord}
        kind="curation"
        descriptors={editableDescriptors}
        label="All fields"
        search=""
        onSearchChange={() => {}}
        onRequestEdit={onRequestEdit}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2)
    expect(within(rowFor('notes')).queryByRole('button')).toBeNull()
    expect(within(rowFor('city')).queryByRole('button')).toBeNull()
    expect(within(rowFor('city')).getByText('Derived from Entity')).toBeVisible()
    expect(within(rowFor('version')).queryByRole('button')).toBeNull()
    expect(within(rowFor('version')).getByText('System')).toBeVisible()
    expect(within(rowFor('version')).getByText('System managed')).toBeVisible()

    fireEvent.click(within(rowFor('notes.public')).getByRole('button', { name: 'Edit' }))
    expect(onRequestEdit).toHaveBeenCalledTimes(1)
    expect(onRequestEdit.mock.calls[0][0]).toMatchObject({
      path: 'notes.public',
      label: 'Public recommendation',
      editable: true,
    })
  })

  test('renders the parent editor for the editing path and forwards commit and cancel', () => {
    const renderEditor = vi.fn<RenderEditor>(() => <span data-testid="field-editor" />)
    const onCommitValue = vi.fn<(node: FieldNode, value: unknown) => void>()
    const onCancelEdit = vi.fn<() => void>()
    render(
      <ContentFieldInspector
        record={editableRecord}
        kind="curation"
        descriptors={editableDescriptors}
        label="All fields"
        search=""
        onSearchChange={() => {}}
        editingPath="notes.public"
        onCommitValue={onCommitValue}
        onCancelEdit={onCancelEdit}
        renderEditor={renderEditor}
      />,
    )

    expect(renderEditor).toHaveBeenCalledTimes(1)
    const [node, commit, cancel] = renderEditor.mock.calls[0]
    expect(node.path).toBe('notes.public')
    expect(within(rowFor('notes.public')).getByTestId('field-editor')).toBeVisible()
    // The row being edited shows the editor instead of the Edit affordance.
    expect(within(rowFor('notes.public')).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1)

    commit('Corner table, updated')
    expect(onCommitValue).toHaveBeenCalledTimes(1)
    expect(onCommitValue.mock.calls[0][0]).toMatchObject({ path: 'notes.public' })
    expect(onCommitValue.mock.calls[0][1]).toBe('Corner table, updated')

    cancel()
    expect(onCancelEdit).toHaveBeenCalledTimes(1)
  })

  test('keeps a system row closed even when the parent points editingPath at it', () => {
    const renderEditor = vi.fn<RenderEditor>(() => <span data-testid="field-editor" />)
    render(
      <ContentFieldInspector
        record={editableRecord}
        kind="curation"
        descriptors={editableDescriptors}
        label="All fields"
        search=""
        onSearchChange={() => {}}
        editingPath="version"
        renderEditor={renderEditor}
      />,
    )

    expect(renderEditor).not.toHaveBeenCalled()
    expect(screen.queryByTestId('field-editor')).toBeNull()
    expect(within(rowFor('version')).queryByRole('button')).toBeNull()
  })

  test('keeps commit and cancel safe when the parent supplies no handler', () => {
    const renderEditor = vi.fn<RenderEditor>(() => <span data-testid="field-editor" />)
    render(
      <ContentFieldInspector
        record={editableRecord}
        kind="curation"
        descriptors={editableDescriptors}
        label="All fields"
        search=""
        onSearchChange={() => {}}
        editingPath="restaurant_name"
        renderEditor={renderEditor}
      />,
    )

    const [, commit, cancel] = renderEditor.mock.calls[0]
    expect(() => {
      commit('ignored')
      cancel()
    }).not.toThrow()
  })

  test('shows missing, empty and container values instead of hiding them', () => {
    render(
      <ContentFieldInspector
        record={{
          note: null,
          blank: undefined,
          tags: ['a', 'b'],
          meta: { a: 1 },
          long: 'x'.repeat(200),
        }}
        kind="curation"
        descriptors={[]}
        label="All fields"
        search=""
        onSearchChange={() => {}}
      />,
    )

    expect(previewOf('note')).toBe('null')
    expect(previewOf('blank')).toBe('empty')
    expect(previewOf('tags')).toBe('2 items')
    expect(previewOf('meta')).toBe('1 fields')
    const truncated = previewOf('long')
    expect(truncated).toHaveLength(81)
    expect(truncated.endsWith('…')).toBe(true)
  })

  test('badges an unregistered field with the record kind and never as an error', () => {
    render(
      <ContentFieldInspector
        record={{ captured_audio: 'voice-note-7' }}
        kind="collection"
        descriptors={[]}
        label="All fields"
        search=""
        onSearchChange={() => {}}
      />,
    )

    const row = rowFor('captured_audio')
    expect(within(row).getByText('Collection')).toBeVisible()
    expect(within(row).getByText('Not in the field registry')).toBeVisible()
    expect(row.textContent?.toLocaleLowerCase()).not.toContain('error')
  })

  test('still offers an editor for a field the registry has never described', () => {
    const onRequestEdit = vi.fn<(node: FieldNode) => void>()
    render(
      <ContentFieldInspector
        record={{ legacy_note: 'from the old import' }}
        kind="curation"
        descriptors={[]}
        label="All fields"
        search=""
        onSearchChange={() => {}}
        onRequestEdit={onRequestEdit}
      />,
    )

    fireEvent.click(within(rowFor('legacy_note')).getByRole('button', { name: 'Edit' }))
    expect(onRequestEdit).toHaveBeenCalledTimes(1)
    expect(onRequestEdit.mock.calls[0][0].descriptor).toBeNull()
    expect(onRequestEdit.mock.calls[0][0].path).toBe('legacy_note')
  })

  test('binds the search input to the parent term and names it when nothing matches', () => {
    const onSearchChange = vi.fn<(value: string) => void>()
    render(
      <ContentFieldInspector
        record={deepRecord}
        kind="curation"
        descriptors={[]}
        label="All fields"
        search="zzz-none"
        onSearchChange={onSearchChange}
      />,
    )

    const input = screen.getByLabelText('Search fields')
    expect(input).toHaveAttribute('placeholder', 'Search fields or values...')
    expect(input).toHaveValue('zzz-none')
    expect(document.querySelector('.content-inspector__tree')).toBeNull()
    const empty = document.querySelector<HTMLElement>('.content-inspector__empty')
    expect(empty?.textContent).toContain('zzz-none')

    fireEvent.change(input, { target: { value: 'phone' } })
    expect(onSearchChange).toHaveBeenCalledWith('phone')
  })
})
