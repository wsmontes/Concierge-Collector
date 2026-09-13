import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ContentRecordHeader } from '../../../src/components/content/ContentRecordHeader'

afterEach(cleanup)

test('shows the record identity and its status badges', () => {
  render(<ContentRecordHeader
    badges={[{ label: 'Published', tone: 'success' }, { label: 'Entity' }]}
    subtitle="Curation · 507f1f77bcf86cd799439011"
    title="Victoria Island"
  />)

  expect(screen.getByRole('heading', { level: 1, name: 'Victoria Island' })).toBeVisible()
  expect(screen.getByText('Curation · 507f1f77bcf86cd799439011')).toBeVisible()
  expect(screen.getByRole('list', { name: 'Record status' })).toBeVisible()
  expect(screen.getByText('Published')).toBeVisible()
  expect(screen.getByText('Entity')).toBeVisible()
})

test('omits the optional parts instead of rendering empty placeholders', () => {
  render(<ContentRecordHeader title="Entity" />)

  expect(screen.getByRole('heading', { level: 1, name: 'Entity' })).toBeVisible()
  expect(screen.queryByRole('list', { name: 'Record status' })).toBeNull()
})

test('renders the actions slot beside the identity', () => {
  render(<ContentRecordHeader
    actions={<button type="button">Reindex</button>}
    title="Entity"
  />)

  expect(screen.getByRole('button', { name: 'Reindex' })).toBeVisible()
})
