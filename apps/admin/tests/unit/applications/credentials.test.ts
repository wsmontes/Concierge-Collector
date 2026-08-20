import { describe, expect, test } from 'vitest'
import { issueCredential, revokeCredential, rotateCredential } from '../../../src/applications/credentials'
import { actor, fakeCredentialRepository, fixedRandom } from '../../support/consumerCredentials'

describe('consumer credentials', () => {
  test('issue returns a show-once secret while the repository receives only its hash', async () => {
    const repo = fakeCredentialRepository()
    const result = await issueCredential({ applicationId: 'app-1', name: 'production', scopes: ['collections:read'], expiresAt: null, actorId: actor.user_id, idempotencyKey: 'key-1' }, repo, fixedRandom(7))

    expect(result.secretOnce).toMatch(/^cck_[a-f0-9]{12}_[A-Za-z0-9_-]+$/)
    expect(repo.created?.secretHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(repo.created)).not.toContain(result.secretOnce)
    expect(result.credential.prefix).toHaveLength(12)
  })

  test('revoke is idempotent and increments the application revision once', async () => {
    const repo = fakeCredentialRepository({ id: 'cred-1' })
    const before = await repo.applicationRevision('app-1')
    const first = await revokeCredential('cred-1', actor.user_id, repo, new Date('2026-08-20T01:00:00Z'))
    const afterFirst = await repo.applicationRevision('app-1')
    const retry = await revokeCredential('cred-1', actor.user_id, repo, new Date('2026-08-20T02:00:00Z'))

    expect(first.revokedAt).toEqual(retry.revokedAt)
    expect(afterFirst).toBe(before + 1)
    expect(await repo.applicationRevision('app-1')).toBe(afterFirst)
    expect(repo.audit).toEqual([{ type: 'credential.revoked', credentialId: 'cred-1' }])
  })

  test('rotate issues a new show-once secret and keeps the old credential valid until overlapUntil', async () => {
    const repo = fakeCredentialRepository({ id: 'cred-1', expiresAt: new Date('2026-08-25T00:00:00Z') })
    const before = await repo.applicationRevision('app-1')
    const overlapUntil = new Date('2026-08-21T00:00:00Z')
    const result = await rotateCredential('cred-1', { actorId: actor.user_id, idempotencyKey: 'rotate-1', overlapUntil }, repo, fixedRandom(9), new Date('2026-08-20T01:00:00Z'))

    expect(result.secretOnce).toMatch(/^cck_[a-f0-9]{12}_[A-Za-z0-9_-]+$/)
    expect(result.credential.id).toBe('credential-new')
    const old = await repo.findCredential('cred-1')
    expect(old?.status).toBe('active')
    expect(old?.expiresAt).toEqual(overlapUntil)
    // The application revision advances once for the whole rotation.
    expect(await repo.applicationRevision('app-1')).toBe(before + 1)
    expect(repo.audit).toEqual([{ type: 'credential.rotated', credentialId: 'cred-1' }])
  })

  test('rotate clamps the old expiry to the overlap window when it is sooner', async () => {
    const repo = fakeCredentialRepository({ id: 'cred-1', expiresAt: new Date('2026-08-20T12:00:00Z') })
    const overlapUntil = new Date('2026-08-21T00:00:00Z')
    await rotateCredential('cred-1', { actorId: actor.user_id, idempotencyKey: 'rotate-2', overlapUntil }, repo, fixedRandom(9), new Date('2026-08-20T01:00:00Z'))

    const old = await repo.findCredential('cred-1')
    expect(old?.expiresAt).toEqual(new Date('2026-08-20T12:00:00Z'))
  })

  test('rotate rejects an already revoked credential', async () => {
    const repo = fakeCredentialRepository({ id: 'cred-1', status: 'revoked' })
    await expect(rotateCredential('cred-1', { actorId: actor.user_id, idempotencyKey: 'rotate-3', overlapUntil: new Date('2026-08-21T00:00:00Z') }, repo, fixedRandom(9))).rejects.toMatchObject({ status: 409, code: 'conflict' })
    expect(repo.audit).toEqual([])
  })

  test('rotate rejects an overlap window in the past', async () => {
    const repo = fakeCredentialRepository({ id: 'cred-1' })
    await expect(rotateCredential('cred-1', { actorId: actor.user_id, idempotencyKey: 'rotate-4', overlapUntil: new Date('2026-08-19T00:00:00Z') }, repo, fixedRandom(9), new Date('2026-08-20T01:00:00Z'))).rejects.toMatchObject({ status: 400, code: 'invalid_request' })
    expect(repo.audit).toEqual([])
  })
})
