import { expect, test, vi } from 'vitest'
import { down, up } from '../../../src/migrations/20260904_014_staging_retention_scan'

function payloadWith(raw: { createIndex: ReturnType<typeof vi.fn>; dropIndex: ReturnType<typeof vi.fn> }) {
  return {
    db: {
      name: 'mongoose',
      collections: {
        'collection-draft-changes': { collection: raw },
      },
    },
  }
}

test('installs the index used by bounded old-staging retention scans', async () => {
  const raw = {
    createIndex: vi.fn().mockResolvedValue('staging_retention_scan'),
    dropIndex: vi.fn().mockResolvedValue(undefined),
  }

  await up({ payload: payloadWith(raw) } as never)

  expect(raw.createIndex).toHaveBeenCalledWith(
    { stageState: 1, updatedAt: 1, _id: 1 },
    { name: 'staging_retention_scan' },
  )
})

test('down is conservative and tolerates an already-missing scan index', async () => {
  const missing = Object.assign(new Error('missing'), { code: 27, codeName: 'IndexNotFound' })
  const raw = {
    createIndex: vi.fn(),
    dropIndex: vi.fn().mockRejectedValue(missing),
  }

  await expect(down({ payload: payloadWith(raw) } as never)).resolves.toBeUndefined()
  expect(raw.dropIndex).toHaveBeenCalledWith('staging_retention_scan')
  expect(raw.createIndex).not.toHaveBeenCalled()
})
