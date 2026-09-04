import { expect, test, vi } from 'vitest'
import { down, up } from '../../../src/migrations/20260904_011_export_cleanup_retention'

function harness() {
  const raw = {
    dropIndex: vi.fn().mockResolvedValue(undefined),
    createIndex: vi.fn().mockResolvedValue('ok'),
  }
  const payload = {
    db: {
      name: 'mongoose',
      collections: {
        'collection-exports': { collection: raw },
      },
    },
  }
  return { raw, payload }
}

test('up removes unsafe Mongo TTL and installs bounded maintenance lookup', async () => {
  const { raw, payload } = harness()

  await up({ payload } as never)

  expect(raw.dropIndex).toHaveBeenCalledWith('export_artifact_ttl')
  expect(raw.createIndex).toHaveBeenCalledWith(
    { expiresAt: 1, status: 1 },
    { name: 'export_expiry_status' },
  )
})

test('down never recreates object-orphaning export TTL', async () => {
  const { raw, payload } = harness()

  await down({ payload } as never)

  expect(raw.dropIndex).toHaveBeenCalledWith('export_expiry_status')
  expect(raw.createIndex).not.toHaveBeenCalled()
})
