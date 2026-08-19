import { describe, expect, test } from 'vitest'
import { isAuthenticated, isAuthorizedAdmin } from '../../../src/auth/access'
import { CmsUsers } from '../../../src/payload/collections/CmsUsers'

describe('CMS foundation access', () => {
  test('only an authorized admin passes', () => {
    expect(isAuthorizedAdmin({ role: 'admin', authorized: true })).toBe(true)
    expect(isAuthorizedAdmin({ role: 'curator', authorized: true })).toBe(false)
    expect(isAuthorizedAdmin({ role: 'admin', authorized: false })).toBe(false)
    expect(isAuthorizedAdmin(null)).toBe(false)
  })

  test('authentication requires a user value', () => {
    expect(isAuthenticated({ id: 'cms-user-1' })).toBe(true)
    expect(isAuthenticated(null)).toBe(false)
    expect(isAuthenticated(undefined)).toBe(false)
  })

  test('the FastAPI-mirrored users collection has no local write path', () => {
    expect(CmsUsers.auth).toEqual({ disableLocalStrategy: true })
    expect(CmsUsers.access?.create?.({} as never)).toBe(false)
    expect(CmsUsers.access?.update?.({} as never)).toBe(false)
    expect(CmsUsers.access?.delete?.({} as never)).toBe(false)
  })

  test('the FastAPI role mirror preserves the viewer role', () => {
    const role = CmsUsers.fields.find((field) => field.name === 'role')
    expect(role).toMatchObject({
      options: expect.arrayContaining([
        expect.objectContaining({ value: 'viewer' }),
        expect.objectContaining({ value: 'curator' }),
        expect.objectContaining({ value: 'admin' }),
      ]),
    })
  })
})
