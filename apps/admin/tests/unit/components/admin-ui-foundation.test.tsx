import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { AdminPage, AdminSection } from '../../../src/components/ui/AdminPage'
import { EmptyState } from '../../../src/components/ui/EmptyState'
import { InlineNotice } from '../../../src/components/ui/InlineNotice'
import { StatusPill } from '../../../src/components/ui/StatusPill'

afterEach(cleanup)

test('AdminPage establishes one consistent page hierarchy', () => {
  render(
    <AdminPage
      eyebrow="Content"
      title="Collections"
      description="Version and publish curated knowledge."
      actions={<button type="button">New Collection</button>}
    >
      <AdminSection title="Published" description="Current published state.">
        <p>Section content</p>
      </AdminSection>
    </AdminPage>,
  )

  expect(screen.getByRole('heading', { level: 1, name: 'Collections' })).toBeVisible()
  expect(screen.getByText('Content')).toBeVisible()
  expect(screen.getByText('Version and publish curated knowledge.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'New Collection' })).toBeVisible()
  expect(screen.getByRole('heading', { level: 2, name: 'Published' })).toBeVisible()
})

test.each([
  ['published', 'published'],
  ['dirty', 'dirty'],
  ['failed', 'failed'],
  ['active', 'active'],
  ['completed', 'completed'],
  ['archived', 'archived'],
] as const)('StatusPill exposes stable status semantics for %s', (status, label) => {
  render(<StatusPill status={status} label={label} />)
  const pill = screen.getByText(label).closest('[data-status]')
  expect(pill).toHaveAttribute('data-status', status)
})

test('InlineNotice reserves alert semantics for errors', () => {
  const { rerender } = render(<InlineNotice tone="info">Saved view updated.</InlineNotice>)
  expect(screen.getByRole('status')).toHaveTextContent('Saved view updated.')

  rerender(<InlineNotice tone="error">Unable to save.</InlineNotice>)
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to save.')
})

test('EmptyState gives empty data a visible title and optional action', () => {
  render(
    <EmptyState
      title="No Collections found"
      description="Change the filters or create a Collection."
      action={<button type="button">Create Collection</button>}
    />,
  )

  expect(screen.getByRole('heading', { level: 2, name: 'No Collections found' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Create Collection' })).toBeVisible()
})
