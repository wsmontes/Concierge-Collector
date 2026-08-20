import { createHash } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import { consumeLoginState, consumePersistedLoginState, createSessionToken } from '../../../src/auth/cms-session'

describe('CMS session', () => {
  test('state só é consumido quando cookie e hash persistido coincidem', async () => {
    const repo = {
      consumeStateHash: vi.fn().mockResolvedValue({ returnTo: '/admin/collections' }),
    }

    await expect(consumeLoginState(repo, 'raw-state', 'raw-state')).resolves.toEqual({
      returnTo: '/admin/collections',
    })
    expect(repo.consumeStateHash).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/))
  })

  test('cookie trocado é rejeitado antes do exchange', async () => {
    const repo = { consumeStateHash: vi.fn() }

    await expect(consumeLoginState(repo, 'a', 'b')).rejects.toThrow('Invalid login state')
    expect(repo.consumeStateHash).not.toHaveBeenCalled()
  })

  test('session persiste apenas hash', () => {
    const value = createSessionToken()

    expect(value.raw).not.toBe(value.hash)
    expect(value.hash).toMatch(/^[a-f0-9]{64}$/)
  })

  test('consumo concorrente do estado persistido tem exatamente um vencedor no CAS do banco', async () => {
    const rawState = 'state-for-concurrent-consumption'
    const stateHash = createHash('sha256').update(rawState).digest('hex')
    const persisted = { consumedAt: null as string | null }
    const updateOne = vi.fn(async ({ data, where }: {
      data: { consumedAt: string }
      where: { and: Array<Record<string, unknown>> }
    }) => {
      await Promise.resolve()
      const hashFilter = where.and.find((filter) => 'stateHash' in filter)
      const unconsumedFilter = where.and.find((filter) => 'consumedAt' in filter)
      const unexpiredFilter = where.and.find((filter) => 'expiresAt' in filter)

      if (
        persisted.consumedAt ||
        hashFilter?.stateHash?.equals !== stateHash ||
        unconsumedFilter?.consumedAt?.exists !== false ||
        typeof unexpiredFilter?.expiresAt?.greater_than !== 'string'
      ) return null

      persisted.consumedAt = data.consumedAt
      return { returnTo: '/admin/collections' }
    })
    const payload = { db: { updateOne } }

    const results = await Promise.allSettled([
      consumePersistedLoginState(payload as never, rawState, rawState),
      consumePersistedLoginState(payload as never, rawState, rawState),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(updateOne).toHaveBeenCalledTimes(2)
  })
})
