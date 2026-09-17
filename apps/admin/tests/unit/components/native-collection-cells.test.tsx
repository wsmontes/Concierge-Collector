import { cleanup, render, screen } from '@testing-library/react'
import type { DefaultCellComponentProps } from 'payload'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BooleanCell } from '../../../src/components/content/cells/BooleanCell'
import { CollectionAccessCell } from '../../../src/components/content/cells/CollectionAccessCell'
import { MonoCell } from '../../../src/components/content/cells/MonoCell'
import { RelativeDateCell } from '../../../src/components/content/cells/RelativeDateCell'
import {
  ApplicationStatusCell,
  CredentialStatusCell,
} from '../../../src/components/content/cells/StatusCell'

/**
 * Props que o Payload entrega a uma célula client: só `cellData`, `rowData` e
 * `customCellProps` (o resto — `field`, `collectionSlug` — é contexto da coluna).
 */
const cellProps = (overrides: Record<string, unknown> = {}): DefaultCellComponentProps =>
  ({
    cellData: undefined,
    collectionSlug: 'consumer-credentials',
    customCellProps: undefined,
    field: { name: 'value', type: 'text' },
    rowData: {},
    ...overrides,
  }) as unknown as DefaultCellComponentProps

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RelativeDateCell', () => {
  test('shows the relative age and keeps the exact instant in the title', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'))
    const value = '2026-09-15T12:00:00.000Z'

    render(<RelativeDateCell {...cellProps({ cellData: value })} />)

    const rendered = screen.getByText('2 days ago')
    expect(rendered.tagName).toBe('TIME')
    expect(rendered).toHaveAttribute('datetime', value)
    expect(rendered).toHaveAttribute('title', new Date(value).toLocaleString())
  })

  test('names the missing value with the label the field configures', () => {
    render(<RelativeDateCell {...cellProps({ cellData: null, customCellProps: { emptyLabel: 'No expiry' } })} />)

    expect(screen.getByText('No expiry')).toBeVisible()
  })

  test('never leaves the cell blank when no label is configured', () => {
    render(<RelativeDateCell {...cellProps({ cellData: undefined })} />)

    expect(screen.getByText('Never')).toBeVisible()
  })
})

describe('MonoCell', () => {
  test('renders the identifier in the monospace vocabulary with the full value available', () => {
    const identifier = '65f000000000000000000001'

    render(<MonoCell {...cellProps({ cellData: identifier })} />)

    const rendered = screen.getByText(identifier)
    expect(rendered).toHaveClass('ui-table__mono')
    expect(rendered).toHaveAttribute('title', identifier)
  })

  test('shows an empty identifier as a placeholder, not as an empty cell', () => {
    render(<MonoCell {...cellProps({ cellData: '' })} />)

    expect(screen.getByText('—')).toBeVisible()
  })
})

describe('BooleanCell', () => {
  test('renders a checked boolean as a success chip', () => {
    render(<BooleanCell {...cellProps({ cellData: true })} />)

    expect(screen.getByText('Yes').closest('.ui-chip')).toHaveAttribute('data-tone', 'success')
  })

  test('renders an unchecked boolean as a muted chip', () => {
    render(<BooleanCell {...cellProps({ cellData: false })} />)

    expect(screen.getByText('No').closest('.ui-chip')).toHaveAttribute('data-tone', 'muted')
  })

  test('honours field-specific labels', () => {
    render(
      <BooleanCell
        {...cellProps({ cellData: true, customCellProps: { trueLabel: 'Authorized', falseLabel: 'Not authorized' } })}
      />,
    )

    expect(screen.getByText('Authorized')).toBeVisible()
  })
})

describe('StatusCell', () => {
  test('an active credential past its expiry is shown as expired', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'))

    render(<CredentialStatusCell {...cellProps({ rowData: { status: 'active', expiresAt: '2026-09-16T12:00:00.000Z' } })} />)

    expect(screen.getByText('Expired').closest('[data-status]')).toHaveAttribute('data-status', 'expired')
  })

  test('revocation wins over expiry', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'))

    render(<CredentialStatusCell {...cellProps({ rowData: { status: 'revoked', expiresAt: '2026-09-16T12:00:00.000Z' } })} />)

    expect(screen.getByText('Revoked').closest('[data-status]')).toHaveAttribute('data-status', 'revoked')
  })

  test('an active credential inside its validity window stays active', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'))

    render(<CredentialStatusCell {...cellProps({ rowData: { status: 'active', expiresAt: '2026-10-17T12:00:00.000Z' } })} />)

    expect(screen.getByText('Active').closest('[data-status]')).toHaveAttribute('data-status', 'active')
  })

  test('a credential without an expiry keeps the stored state', () => {
    render(<CredentialStatusCell {...cellProps({ rowData: { status: 'active', expiresAt: null } })} />)

    expect(screen.getByText('Active').closest('[data-status]')).toHaveAttribute('data-status', 'active')
  })

  test('an application state is a status pill, not raw select text', () => {
    render(<ApplicationStatusCell {...cellProps({ rowData: { status: 'suspended' } })} />)

    const pill = screen.getByText('Suspended').closest('[data-status]')
    expect(pill).toHaveAttribute('data-status', 'suspended')
    expect(pill?.querySelector('.ui-chip')).toHaveAttribute('data-tone', 'muted')
  })
})

describe('CollectionAccessCell', () => {
  test('counts the granted Collections', () => {
    render(<CollectionAccessCell {...cellProps({ cellData: [{ collectionId: 'a' }, { collectionId: 'b' }] })} />)

    expect(screen.getByText('2 Collections')).toBeVisible()
  })

  test('uses the singular for a single grant', () => {
    render(<CollectionAccessCell {...cellProps({ cellData: [{ collectionId: 'a' }] })} />)

    expect(screen.getByText('1 Collection')).toBeVisible()
  })

  test('says so when the application has no access', () => {
    render(<CollectionAccessCell {...cellProps({ cellData: [] })} />)

    expect(screen.getByText('No Collection access')).toBeVisible()
  })
})
