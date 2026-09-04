import { describe, expect, test } from 'vitest'
import { AdminHttpError } from '../../../src/http/errors'
import { assertOperationOwnedBy, publicStandaloneOperation } from '../../../src/operations/visibility'

describe('operation visibility', () => {
  const operation = {
    _id: '64f000000000000000000001',
    actorId: 'admin-a',
    collectionId: '64f000000000000000000010',
    mode: 'explicit',
    action: 'add',
    status: 'staging',
    progress: { processed: 1, skipped: 0, failed: 0 },
    checkpoint: 'staging',
    errorCode: null,
    selectedCount: 1,
    targetDraftRevision: 3,
    createdAt: new Date('2026-09-02T12:00:00Z'),
    updatedAt: new Date('2026-09-02T12:01:00Z'),
    idempotencyKey: 'secret-command-key',
    requestHash: 'internal-request-hash',
    leaseOwner: 'worker-private',
    leaseExpiresAt: new Date('2026-09-02T12:02:00Z'),
    fencingToken: 9,
    requestId: 'internal-request-id',
  }

  test('a different admin receives not_found semantics', () => {
    expect(() => assertOperationOwnedBy(operation, 'admin-b')).toThrowError(
      expect.objectContaining<Partial<AdminHttpError>>({ status: 404, code: 'not_found' }),
    )
  })

  test('the owning admin may read the operation', () => {
    expect(() => assertOperationOwnedBy(operation, 'admin-a')).not.toThrow()
  })

  test('standalone DTO excludes operational internals', () => {
    const dto = publicStandaloneOperation(operation)
    expect(dto).toEqual({
      id: '64f000000000000000000001',
      collectionId: '64f000000000000000000010',
      mode: 'explicit',
      action: 'add',
      status: 'staging',
      progress: { processed: 1, skipped: 0, failed: 0 },
      checkpoint: 'staging',
      errorCode: null,
      selectedCount: 1,
      targetDraftRevision: 3,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
    })
    expect(JSON.stringify(dto)).not.toContain('secret-command-key')
    expect(JSON.stringify(dto)).not.toContain('internal-request-hash')
    expect(JSON.stringify(dto)).not.toContain('worker-private')
    expect(JSON.stringify(dto)).not.toContain('internal-request-id')
    expect(dto).not.toHaveProperty('fencingToken')
    expect(dto).not.toHaveProperty('actorId')
  })
})
