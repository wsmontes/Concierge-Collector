import { expect, test, vi } from 'vitest'
import { down, up } from '../../../src/migrations/20260904_014_worker_heartbeat_retention'

function payloadWith(raw: { createIndex: ReturnType<typeof vi.fn>; dropIndex: ReturnType<typeof vi.fn> }) {
  return {
    db: {
      name: 'mongoose',
      collections: {
        'worker-heartbeats': { collection: raw },
      },
    },
  }
}

test('installs a seven-day TTL on worker heartbeat observedAt', async () => {
  const raw = {
    createIndex: vi.fn().mockResolvedValue('worker_heartbeat_ttl'),
    dropIndex: vi.fn().mockResolvedValue(undefined),
  }

  await up({ payload: payloadWith(raw) } as never)

  expect(raw.createIndex).toHaveBeenCalledWith(
    { observedAt: 1 },
    { name: 'worker_heartbeat_ttl', expireAfterSeconds: 7 * 24 * 60 * 60 },
  )
})

test('down only removes the operational TTL and tolerates an already-missing index', async () => {
  const missing = Object.assign(new Error('missing'), { code: 27, codeName: 'IndexNotFound' })
  const raw = {
    createIndex: vi.fn(),
    dropIndex: vi.fn().mockRejectedValue(missing),
  }

  await expect(down({ payload: payloadWith(raw) } as never)).resolves.toBeUndefined()
  expect(raw.dropIndex).toHaveBeenCalledWith('worker_heartbeat_ttl')
  expect(raw.createIndex).not.toHaveBeenCalled()
})
