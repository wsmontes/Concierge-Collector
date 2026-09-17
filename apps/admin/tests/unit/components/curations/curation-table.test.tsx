import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { CurationTable } from '../../../../src/components/curations/CurationTable'
import { makeRows } from '../../../support/factories'

describe('CurationTable columns', () => {
  afterEach(cleanup)

  test('renders one header and one cell per configured column', () => {
    const { container } = render(<CurationTable
      columns={['curation', 'city', 'version']}
      height={600}
      rows={makeRows(1, { version: 4 })}
    />)

    expect(screen.queryByRole('columnheader', { name: 'Concepts' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'City' })).toBeInTheDocument()
    expect(container.querySelector('tr[data-row] td[data-label="City"]')).toHaveTextContent('Vancouver')
    expect(container.querySelector('tr[data-row] td[data-label="Version"]')).toHaveTextContent('4')
  })

  test('never invents a value for a field the row does not carry', () => {
    const { container } = render(<CurationTable
      columns={['curation', 'collections', 'created', 'has_transcript', 'audio_count']}
      height={600}
      rows={makeRows(1)}
    />)

    expect(container.querySelector('tr[data-row] td[data-label="Collections"]')).toHaveTextContent('—')
    expect(container.querySelector('tr[data-row] td[data-label="Created"]')).toHaveTextContent('—')
    expect(container.querySelector('tr[data-row] td[data-label="Transcript"]')).toHaveTextContent('—')
    expect(container.querySelector('tr[data-row] td[data-label="Audio"]')).toHaveTextContent('—')
  })

  test('caps visible concept chips and marks the remainder', () => {
    const { container } = render(<CurationTable
      columns={['curation', 'concepts']}
      height={600}
      rows={makeRows(1, { concepts: ['Business', 'Casual', 'Friends', 'Burger', 'Sharing'] })}
    />)

    const cell = container.querySelector('tr[data-row] td[data-label="Concepts"]')
    expect(cell).toHaveTextContent('Business')
    expect(cell).toHaveTextContent('+2')
    expect(cell).not.toHaveTextContent('Burger')
  })

  test('renders editorial projections: curator name, transcript flag and relative date', () => {
    const { container } = render(<CurationTable
      columns={['curation', 'curator', 'has_transcript', 'updated']}
      height={600}
      rows={makeRows(1, {
        curator_name: 'Wagner Montes',
        has_transcript: true,
        updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      })}
    />)

    expect(container.querySelector('tr[data-row] td[data-label="Curation"]')).toHaveTextContent('Restaurant 1')
    expect(container.querySelector('tr[data-row] td[data-label="Curator"]')).toHaveTextContent('Wagner Montes')
    expect(container.querySelector('tr[data-row] td[data-label="Transcript"]')).toHaveTextContent('Yes')
    expect(container.querySelector('tr[data-row] td[data-label="Updated"]')).toHaveTextContent('2 hours ago')
  })
})
