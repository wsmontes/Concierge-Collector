import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CredentialRevealDialog } from '../../../src/components/credentials/CredentialRevealDialog'

describe('CredentialRevealDialog', () => {
  afterEach(cleanup)

  test('shows the raw secret only while the dialog is mounted', () => {
    const onClose = vi.fn()
    const view = render(<CredentialRevealDialog credential={{ id: 'credential-1', name: 'Production', prefix: 'cck_abc' }} secretOnce="cck_abc_secret" onClose={onClose} />)
    expect(screen.getByLabelText('Credential secret').textContent).toContain('cck_abc_secret')
    fireEvent.click(screen.getByRole('button', { name: 'I saved it' }))
    expect(onClose).toHaveBeenCalledOnce()
    view.unmount()
    expect(screen.queryByLabelText('Credential secret')).toBeNull()
  })
})
