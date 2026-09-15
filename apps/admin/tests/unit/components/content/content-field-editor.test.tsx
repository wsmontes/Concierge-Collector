import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ContentFieldEditor } from '../../../../src/components/content/ContentFieldEditor'
import type { FieldDescriptor, FieldNode, FieldType } from '../../../../src/content/field-types'

afterEach(cleanup)

const LABEL = 'Restaurant name'

function fieldNode(type: FieldType, value: unknown, overrides: Partial<FieldNode> = {}): FieldNode {
  return {
    path: 'curation.restaurant_name',
    label: LABEL,
    type,
    value,
    depth: 1,
    descriptor: null,
    owner: 'curation',
    editable: true,
    system: false,
    children: [],
    ...overrides,
  }
}

function descriptor(overrides: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return { path: 'curation.status', label: LABEL, owner: 'curation', type: 'enum', ...overrides }
}

function renderEditor(node: FieldNode) {
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  render(<ContentFieldEditor node={node} onCommit={onCommit} onCancel={onCancel} />)
  return { onCommit, onCancel }
}

const EDITABLE_CONTROL: ReadonlyArray<{ type: FieldType; value: unknown; tag: string }> = [
  { type: 'text', value: 'Le Petit', tag: 'INPUT' },
  { type: 'longText', value: 'line one\nline two', tag: 'TEXTAREA' },
  { type: 'number', value: 42, tag: 'INPUT' },
  { type: 'dateTime', value: '2026-02-03T18:30:00.000Z', tag: 'INPUT' },
  { type: 'array', value: ['a', 'b'], tag: 'TEXTAREA' },
  { type: 'object', value: { place_id: 'abc' }, tag: 'TEXTAREA' },
  { type: 'json', value: { place_id: 'abc' }, tag: 'TEXTAREA' },
  { type: 'unknown', value: null, tag: 'TEXTAREA' },
]

test.each(EDITABLE_CONTROL)('$type gets its own editor with a labelled $tag control', ({ type, value, tag }) => {
  const { onCommit } = renderEditor(fieldNode(type, value))

  expect(screen.getByText(LABEL).tagName).toBe('LABEL')
  expect(screen.getByLabelText(LABEL).tagName).toBe(tag)
  expect(screen.getByRole('button', { name: 'Save' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible()
  expect(onCommit).not.toHaveBeenCalled()
})

test.each(['binary', 'relationship', 'concept'] as const)('%s has no writer: the value stays visible and read-only', (type) => {
  const { onCommit, onCancel } = renderEditor(fieldNode(type, { id: 'entity-1' }))

  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(screen.queryByLabelText(LABEL)).toBeNull()
  expect(screen.getByText(/read-only in the Admin/)).toBeVisible()

  fireEvent.keyDown(screen.getByText(/read-only in the Admin/), { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})

test('text keeps the draft local until Save commits it', () => {
  const { onCommit, onCancel } = renderEditor(fieldNode('text', 'Le Petit'))
  const control = screen.getByLabelText(LABEL)
  expect(control).toHaveValue('Le Petit')

  fireEvent.change(control, { target: { value: 'Le Grand' } })
  expect(onCommit).not.toHaveBeenCalled()

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onCommit).toHaveBeenCalledWith('Le Grand')
  expect(onCancel).not.toHaveBeenCalled()
})

test('Escape abandons the edit without committing', () => {
  const { onCommit, onCancel } = renderEditor(fieldNode('text', 'Le Petit'))

  fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'Le Grand' } })
  fireEvent.keyDown(screen.getByLabelText(LABEL), { key: 'Escape' })

  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})

test('Cancel abandons the edit without committing', () => {
  const { onCommit, onCancel } = renderEditor(fieldNode('longText', 'original note'))

  fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'rewritten note' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})

test('long text commits on Ctrl+Enter and not on a plain newline', () => {
  const { onCommit } = renderEditor(fieldNode('longText', 'original note'))
  const control = screen.getByLabelText(LABEL)

  fireEvent.change(control, { target: { value: 'public note' } })
  fireEvent.keyDown(control, { key: 'Enter' })
  expect(onCommit).not.toHaveBeenCalled()

  fireEvent.keyDown(control, { key: 'Enter', ctrlKey: true })
  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onCommit).toHaveBeenCalledWith('public note')
})

test('long text commits on Cmd+Enter', () => {
  const { onCommit } = renderEditor(fieldNode('longText', 'original note'))
  const control = screen.getByLabelText(LABEL)

  fireEvent.change(control, { target: { value: 'private note' } })
  fireEvent.keyDown(control, { key: 'Enter', metaKey: true })

  expect(onCommit).toHaveBeenCalledWith('private note')
})

test('number rejects non-numeric input with a visible error and commits nothing', () => {
  const { onCommit } = renderEditor(fieldNode('number', 42))
  const control = screen.getByLabelText(LABEL)
  expect(control).toHaveValue('42')

  fireEvent.change(control, { target: { value: '12,5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a number.')
})

test('number commits a parsed decimal and drops the error once fixed', () => {
  const { onCommit } = renderEditor(fieldNode('number', 42))
  const control = screen.getByLabelText(LABEL)

  fireEvent.change(control, { target: { value: 'abc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('alert')).toBeVisible()

  fireEvent.change(control, { target: { value: '-12.5' } })
  expect(screen.queryByRole('alert')).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onCommit).toHaveBeenCalledWith(-12.5)
})

test('an emptied number commits null', () => {
  const { onCommit } = renderEditor(fieldNode('number', 42))

  fireEvent.change(screen.getByLabelText(LABEL), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith(null)
})

test('boolean commits on toggle and never renders a Save button', () => {
  const { onCommit, onCancel } = renderEditor(fieldNode('boolean', false))
  const control = screen.getByRole('checkbox', { name: LABEL })
  expect(control).not.toBeChecked()

  fireEvent.click(control)

  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onCommit).toHaveBeenCalledWith(true)
  expect(control).toBeChecked()
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})

test('boolean commits false back when untoggled', () => {
  const { onCommit } = renderEditor(fieldNode('boolean', true))

  fireEvent.click(screen.getByRole('checkbox', { name: LABEL }))

  expect(onCommit).toHaveBeenCalledWith(false)
})

test('datetime round-trips the stored instant as ISO 8601', () => {
  const stored = '2026-02-03T18:30:00.000Z'
  const { onCommit } = renderEditor(fieldNode('dateTime', stored))
  const control = screen.getByLabelText(LABEL) as HTMLInputElement
  expect(control.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)

  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  const committed = onCommit.mock.calls[0][0]
  expect(String(committed)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(new Date(String(committed)).getTime()).toBe(new Date(stored).getTime())
})

test('datetime commits an edited wall-clock time as an ISO instant', () => {
  const { onCommit } = renderEditor(fieldNode('dateTime', '2026-02-03T18:30:00.000Z'))

  fireEvent.change(screen.getByLabelText(LABEL), { target: { value: '2026-03-04T09:15' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith(new Date('2026-03-04T09:15').toISOString())
})

test('an emptied datetime commits null', () => {
  const { onCommit } = renderEditor(fieldNode('dateTime', '2026-02-03T18:30:00.000Z'))

  fireEvent.change(screen.getByLabelText(LABEL), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith(null)
})

test('enum renders the declared values as a select and commits one of them', () => {
  const node = fieldNode('enum', 'draft', { descriptor: descriptor({ enumValues: ['draft', 'active'] }) })
  const { onCommit } = renderEditor(node)
  const select = screen.getByLabelText(LABEL)

  expect(select.tagName).toBe('SELECT')
  expect(screen.getByRole('option', { name: 'draft' })).toBeVisible()
  expect(screen.getByRole('option', { name: 'active' })).toBeVisible()

  fireEvent.change(select, { target: { value: 'active' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith('active')
})

test('enum without declared values falls back to a text input', () => {
  const node = fieldNode('enum', 'unknown-status', { descriptor: descriptor({ enumValues: [] }) })
  const { onCommit } = renderEditor(node)
  const control = screen.getByLabelText(LABEL)

  expect(control.tagName).toBe('INPUT')
  expect(control).toHaveValue('unknown-status')

  fireEvent.change(control, { target: { value: 'archived' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith('archived')
})

test('enum with no registry entry at all still edits as text', () => {
  const { onCommit } = renderEditor(fieldNode('enum', 'draft'))
  const control = screen.getByLabelText(LABEL)

  expect(control.tagName).toBe('INPUT')
  fireEvent.change(control, { target: { value: 'published' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith('published')
})

test('structured editor pretty-prints the stored value and commits nested objects', () => {
  const stored = { place_id: 'abc', tags: ['a', 'b'] }
  const { onCommit } = renderEditor(fieldNode('object', stored))
  const control = screen.getByLabelText(LABEL)

  expect(control).toHaveValue(JSON.stringify(stored, null, 2))

  fireEvent.change(control, { target: { value: '{"place_id":"xyz","tags":["c"]}' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith({ place_id: 'xyz', tags: ['c'] })
})

test('structured editor rejects invalid JSON and stays open', () => {
  const { onCommit } = renderEditor(fieldNode('json', { place_id: 'abc' }))
  const control = screen.getByLabelText(LABEL)

  fireEvent.change(control, { target: { value: '{"place_id":' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('not valid JSON')

  fireEvent.change(control, { target: { value: '{"place_id":"xyz"}' } })
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onCommit).toHaveBeenCalledWith({ place_id: 'xyz' })
})

test('structured editor commits arrays on Cmd+Enter', () => {
  const { onCommit } = renderEditor(fieldNode('array', ['a']))
  const control = screen.getByLabelText(LABEL)

  fireEvent.change(control, { target: { value: '["a","b"]' } })
  fireEvent.keyDown(control, { key: 'Enter', metaKey: true })

  expect(onCommit).toHaveBeenCalledTimes(1)
  expect(onCommit).toHaveBeenCalledWith(['a', 'b'])
})

test('structured editor handles a value the registry never described', () => {
  const { onCommit } = renderEditor(fieldNode('unknown', null))

  expect(screen.getByLabelText(LABEL)).toHaveValue('null')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(onCommit).toHaveBeenCalledWith(null)
})

test('read-only field shows the stored value and the system note, never a Save', () => {
  const { onCommit } = renderEditor(fieldNode('binary', new Uint8Array([1, 2, 3]), { system: true }))

  expect(screen.getByText('3 bytes')).toBeVisible()
  expect(screen.getByText(/^System-managed field/)).toBeVisible()
  expect(screen.getByText(LABEL)).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(onCommit).not.toHaveBeenCalled()
})

test('registry help is rendered next to the control', () => {
  const node = fieldNode('text', 'Le Petit', { descriptor: descriptor({ type: 'text', help: 'Working name.' }) })
  renderEditor(node)

  expect(screen.getByText('Working name.')).toBeVisible()
})
