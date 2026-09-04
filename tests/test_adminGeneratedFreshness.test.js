import { describe, expect, test, vi } from 'vitest'
import { checkAdminGeneratedTypes } from '../scripts/release/check-admin-generated.mjs'

describe('Admin generated Payload type freshness', () => {
  test('passes when official generator leaves checked-in content unchanged', () => {
    const read = vi.fn().mockReturnValue('same-content')
    const write = vi.fn()
    const spawn = vi.fn().mockReturnValue({ status: 0 })

    expect(checkAdminGeneratedTypes({ read, write, spawn, generatedTypes: '/tmp/payload-types.ts' })).toBe(true)
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(?:\.cmd)?$/),
      ['run', 'generate:types', '--workspace=@concierge/admin'],
      expect.objectContaining({ stdio: 'inherit' }),
    )
    expect(write).not.toHaveBeenCalled()
  })

  test('fails stale generated output and restores the original file', () => {
    const read = vi.fn()
      .mockReturnValueOnce('checked-in')
      .mockReturnValueOnce('new-generated')
      .mockReturnValueOnce('new-generated')
    const write = vi.fn()
    const spawn = vi.fn().mockReturnValue({ status: 0 })

    expect(() => checkAdminGeneratedTypes({ read, write, spawn, generatedTypes: '/tmp/payload-types.ts' }))
      .toThrow(/Generated Payload types are stale/)
    expect(write).toHaveBeenCalledWith('/tmp/payload-types.ts', 'checked-in', 'utf8')
  })

  test('generator failure remains a gate failure and restores any partial rewrite', () => {
    const read = vi.fn()
      .mockReturnValueOnce('checked-in')
      .mockReturnValueOnce('partial')
    const write = vi.fn()
    const spawn = vi.fn().mockReturnValue({ status: 2 })

    expect(() => checkAdminGeneratedTypes({ read, write, spawn, generatedTypes: '/tmp/payload-types.ts' }))
      .toThrow(/generation failed with exit code 2/)
    expect(write).toHaveBeenCalledWith('/tmp/payload-types.ts', 'checked-in', 'utf8')
  })
})