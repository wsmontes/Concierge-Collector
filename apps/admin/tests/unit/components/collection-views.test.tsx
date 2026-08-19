import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CollectionViews } from '../../../src/components/collections/CollectionViews'

describe('CollectionViews', () => {
  afterEach(cleanup)

  test('shows counts and review tabs without an editorial ordering control', () => {
    render(<CollectionViews collection={{
      id: 'collection-1', title: 'Vancouver Essentials', lifecycle: 'published', draftState: 'dirty',
      currentPublishedVersion: 4, draftRevision: 12, revision: 28,
      publishedSelectedCount: 11_912, draftSelectedCount: 12_000,
    }} />)

    expect(screen.getByText('12,000 selected')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Draft Changes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Publish new version' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByText(/rank|position|reorder/i)).toBeNull()
  })

  test('makes an archived collection read-only and offers restore', () => {
    render(<CollectionViews collection={{
      id: 'collection-2', title: 'Archived', lifecycle: 'archived', draftState: 'clean',
      currentPublishedVersion: 2, draftRevision: 0, revision: 4,
      publishedSelectedCount: 8, draftSelectedCount: 8,
    }} />)

    expect(screen.getByRole('button', { name: 'Restore collection' }).hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Publish new version' })).toBeNull()
  })
})
