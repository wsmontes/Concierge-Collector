import { describe, expect, test } from 'vitest'
import { AdminHttpError, adminErrorResponse } from '../../../src/http/errors'

describe('admin error cache policy', () => {
  test('known administrative failures are always private and no-store', () => {
    const response = adminErrorResponse(new AdminHttpError(403, 'authorization_denied'))

    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('unexpected administrative failures are also private and no-store', () => {
    const response = adminErrorResponse(new Error('sensitive internal detail'))

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })
})
