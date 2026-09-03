import { expect, test, vi } from 'vitest'
import { up } from '../../../src/migrations/20260902_009_operational_retention'

test('operational retention creates only the worker heartbeat TTL index', async () => {
  const createIndex = vi.fn().mockResolvedValue('worker_heartbeat_ttl')
  const payload = {
    db: {
      name: 'mongoose',
      collections: {
        'worker-heartbeats': { collection: { createIndex } },
      },
    },
  }

  await up({ payload } as never)

  expect(createIndex).toHaveBeenCalledTimes(1)
  expect(createIndex).toHaveBeenCalledWith(
    { observedAt: 1 },
    { name: 'worker_heartbeat_ttl', expireAfterSeconds: 7 * 24 * 60 * 60 },
  )
})
