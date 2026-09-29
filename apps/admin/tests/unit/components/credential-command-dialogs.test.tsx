import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CredentialActionDialog, IssueCredentialDialog } from '../../../src/components/applications/CredentialCommandDialogs'

afterEach(() => cleanup())

test('issue dialog collects a non-empty credential name and disables controls while pending', async () => {
  const onIssue = vi.fn().mockResolvedValue(undefined)
  render(<IssueCredentialDialog applicationName="Guide API" pending={false} onClose={vi.fn()} onIssue={onIssue} />)

  const dialog = screen.getByRole('dialog', { name: 'Issue credential' })
  fireEvent.change(screen.getByLabelText('Credential name'), { target: { value: ' production reader ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Issue credential now' }))

  expect(onIssue).toHaveBeenCalledWith('production reader')
  expect(dialog).toHaveTextContent('Guide API')
})

test('rotate confirmation explains the overlap window before running the action', () => {
  const onConfirm = vi.fn()
  render(<CredentialActionDialog
    action="rotate"
    credentialName="reader-1"
    overlapHours={24}
    pending={false}
    onClose={vi.fn()}
    onConfirm={onConfirm}
  />)

  expect(screen.getByRole('dialog', { name: 'Rotate credential' })).toHaveTextContent('24 hours')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm rotate' }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
})

test('revoke confirmation states that revocation affects the next request', () => {
  const onConfirm = vi.fn()
  render(<CredentialActionDialog
    action="revoke"
    credentialName="reader-1"
    overlapHours={24}
    pending={false}
    onClose={vi.fn()}
    onConfirm={onConfirm}
  />)

  expect(screen.getByRole('dialog', { name: 'Revoke credential' })).toHaveTextContent('next API request')
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
})
