import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CollectionViews } from '../../../src/components/collections/CollectionViews'
import { OverviewView } from '../../../src/components/overview/OverviewView'
import { makeRows } from '../../support/factories'

/**
 * Collection management views are presentational: they render only what the
 * cursor-paginated read endpoints already returned. Every fixture below is
 * local and explicit; no global test data is shared between cases.
 */

const publishedDirtyCollection = {
  id: 'collection-3',
  title: 'Portland Picks',
  lifecycle: 'published' as const,
  draftState: 'dirty' as const,
  currentPublishedVersion: 1,
  draftRevision: 12,
  revision: 28,
  publishedSelectedCount: 11_912,
  draftSelectedCount: 12_000,
}

describe('CollectionViews', () => {
  afterEach(cleanup)

  test('Collection view mostra contagens, status operacionais e não oferece reorder', async () => {
    render(<CollectionViews collection={publishedDirtyCollection} />)
    expect(screen.getByText('12,000 selected')).toBeVisible()
    expect(screen.getByText('published').closest('[data-status]')).toHaveAttribute('data-status', 'published')
    expect(screen.getByText('dirty').closest('[data-status]')).toHaveAttribute('data-status', 'dirty')
    expect(screen.getByRole('tab', { name: 'Draft Changes' })).toBeVisible()
    expect(screen.queryByText(/rank|position|reorder/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Publish new version' })).toBeEnabled()
  })

  test('shows counts and review tabs without an editorial ordering control', () => {
    render(<CollectionViews collection={publishedDirtyCollection} />)

    expect(screen.getByText('12,000 selected')).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Draft Changes' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Publish new version' })).toBeEnabled()
    expect(screen.queryByText(/rank|position|reorder/i)).toBeNull()
  })

  test('makes an archived collection read-only and offers restore', () => {
    render(<CollectionViews collection={{
      id: 'collection-2', title: 'Archived', lifecycle: 'archived', draftState: 'clean',
      currentPublishedVersion: 2, draftRevision: 0, revision: 4,
      publishedSelectedCount: 8, draftSelectedCount: 8,
    }} />)

    expect(screen.getByText('archived').closest('[data-status]')).toHaveAttribute('data-status', 'archived')
    expect(screen.getByRole('button', { name: 'Restore collection' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Publish new version' })).toBeNull()
  })

  test('Overview is the default tab and aggregates drafts, publications, jobs and availability', () => {
    render(<CollectionViews
      collection={publishedDirtyCollection}
      preview={{
        versions: [{ version: 2, selectedCount: 11_912, membershipHash: 'a'.repeat(64), publishedAt: '2026-08-18T12:00:00.000Z' }],
        activity: [{ eventType: 'collection.published', actorId: 'admin@example.com', createdAt: '2026-08-18T12:00:00.000Z' }],
        diff: [
          { curationId: 'c-add', desiredState: 'add', operationId: 'op-1', summary: null },
          { curationId: 'c-remove', desiredState: 'remove', operationId: 'op-2', summary: null },
        ],
      }}
    />)

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Draft' })).toBeVisible()
    expect(screen.getByText('12,000 selected in draft · 11,912 selected published')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review draft changes' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Recent publications' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Version 2/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'View all versions' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Jobs and activity' })).toBeVisible()
    expect(screen.getByText(/collection\.published · admin@example\.com/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'View activity' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Availability' })).toBeVisible()
    expect(screen.getByText('1 add · 1 remove pending in the draft.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review members' })).toBeVisible()
  })

  test('Overview navigation links switch to the real tabs', () => {
    render(<CollectionViews
      collection={publishedDirtyCollection}
      preview={{ activity: [{ eventType: 'collection.published', actorId: 'admin@example.com', createdAt: '2026-08-18T12:00:00.000Z' }] }}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'View activity' }))
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Collection activity')).toBeVisible()
  })

  test('Overview flags a failed draft and an active publish job', () => {
    render(<CollectionViews collection={{
      ...publishedDirtyCollection, draftState: 'failed',
    }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Draft failed — review and retry.')

    cleanup()

    render(<CollectionViews collection={{
      ...publishedDirtyCollection, draftState: 'publishing',
    }} />)
    expect(screen.getByText(/Active publish job in progress/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Publish new version' })).toBeDisabled()
  })

  test('OverviewView renders empty aggregates without placeholders', () => {
    render(<OverviewView collection={publishedDirtyCollection} />)
    expect(screen.getByText('No published versions yet.')).toBeVisible()
    expect(screen.getByText('No recent activity.')).toBeVisible()
    expect(screen.getByText('No draft changes pending.')).toBeVisible()
    expect(screen.queryByText(/rank|position|reorder/i)).toBeNull()
  })

  test('summarizes the relationships of the loaded members and says the page is bounded', () => {
    const members = [
      { curationId: 'cur_1', summary: makeRows(1, { curation_id: 'cur_1', restaurant_name: 'Ritz', curator_id: 'admin-1' })[0] },
      { curationId: 'cur_2', summary: makeRows(1, { curation_id: 'cur_2', restaurant_name: 'Ritz', curator_id: 'admin-2' })[0] },
    ]
    render(<CollectionViews
      collection={publishedDirtyCollection}
      pagination={{ members: { hasMore: true } }}
      preview={{ members }}
    />)

    expect(screen.getByRole('heading', { name: 'Relationships' })).toBeVisible()
    expect(screen.getByText('Based on the first 2 members.')).toBeVisible()
    expect(screen.getByText('Entities represented')).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Members' }))
    const memberList = screen.getByRole('list', { name: 'Collection members' })
    expect(within(memberList).getAllByText('Ritz')).toHaveLength(2)
  })
})
