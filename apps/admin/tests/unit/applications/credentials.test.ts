import { describe, expect, test } from 'vitest'
import { issueCredential, revokeCredential, type CredentialRepository } from '../../../src/applications/credentials'
import type { ConsumerCredentialRecord } from '../../../src/applications/types'

function fixedRandom(bytes: number): (size: number) => Buffer {
  return (size) => Buffer.alloc(size, bytes)
}

function repository(seed?: Partial<ConsumerCredentialRecord>): CredentialRepository & { created?: ConsumerCredentialRecord; audit: Array<{ type: string; credentialId: string }> } {
  const credentials = new Map<string, ConsumerCredentialRecord>()
  const apps = new Map([['app-1', { id: 'app-1', status: 'active' as const, credentialsRevision: 2 }]])
  if (seed?.id) credentials.set(seed.id, {
    id: seed.id, applicationId: seed.applicationId ?? 'app-1', name: seed.name ?? 'production', prefix: seed.prefix ?? 'prefix',
    secretHash: seed.secretHash ?? 'a'.repeat(64), scopes: seed.scopes ?? ['collections:read'], status: seed.status ?? 'active',
    createdAt: seed.createdAt ?? new Date('2026-08-20T00:00:00Z'), createdBy: seed.createdBy ?? 'admin-1',
    expiresAt: seed.expiresAt ?? null, revokedAt: seed.revokedAt ?? null, revokedBy: seed.revokedBy ?? null,
  })
  const audit: Array<{ type: string; credentialId: string }> = []
  return {
    audit,
    async activeApplication(id) { return apps.get(id) ?? null },
    async createCredential(value) { credentials.set(value.id, value); this.created = value },
    async findCredential(id) { return credentials.get(id) ?? null },
    async revokeCredential(id, actorId, now) {
      const current = credentials.get(id)
      if (!current) return null
      if (current.status === 'revoked') return { credential: current, changed: false }
      const updated = { ...current, status: 'revoked' as const, revokedAt: now, revokedBy: actorId }
      credentials.set(id, updated)
      apps.set(current.applicationId, { ...apps.get(current.applicationId)!, credentialsRevision: apps.get(current.applicationId)!.credentialsRevision + 1 })
      return { credential: updated, changed: true }
    },
    async appendAudit(type, credentialId) { audit.push({ type, credentialId }) },
    async applicationRevision(id) { return apps.get(id)?.credentialsRevision ?? -1 },
  }
}

describe('consumer credentials', () => {
  test('issues a show-once secret while the repository receives only its hash', async () => {
    const repo = repository()
    const result = await issueCredential({ applicationId: 'app-1', name: 'production', scopes: ['collections:read'], expiresAt: null, actorId: 'admin-1' }, repo, fixedRandom(7))

    expect(result.secretOnce).toMatch(/^cck_[a-f0-9]{12}_[A-Za-z0-9_-]+$/)
    expect(repo.created?.secretHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(repo.created)).not.toContain(result.secretOnce)
    expect(result.credential.prefix).toHaveLength(12)
  })

  test('revoke is idempotent and increments the application revision once', async () => {
    const repo = repository({ id: 'cred-1' })
    const before = await repo.applicationRevision('app-1')
    const first = await revokeCredential('cred-1', 'admin-1', repo, new Date('2026-08-20T01:00:00Z'))
    const afterFirst = await repo.applicationRevision('app-1')
    const retry = await revokeCredential('cred-1', 'admin-1', repo, new Date('2026-08-20T02:00:00Z'))

    expect(first.revokedAt).toEqual(retry.revokedAt)
    expect(afterFirst).toBe(before + 1)
    expect(await repo.applicationRevision('app-1')).toBe(afterFirst)
    expect(repo.audit).toEqual([{ type: 'credential.revoked', credentialId: 'cred-1' }])
  })
})
