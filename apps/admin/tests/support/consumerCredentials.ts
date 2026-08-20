import type { CredentialRepository } from '../../src/applications/credentials'
import type { ConsumerCredentialRecord } from '../../src/applications/types'

/**
 * Shared test doubles for the consumer credential command surface.
 *
 * `fakeCredentialRepository` is the in-memory CredentialRepository used by
 * the unit suites; `fixedRandom` makes generated secrets deterministic; and
 * `actor` is the withAdmin identity the guarded endpoints pass to services.
 * Keeping these here (instead of inside each spec file) prevents sketch
 * helpers from becoming undeclared globals.
 */

export interface AdminActor {
  user_id: string
}

export const actor: AdminActor = { user_id: 'admin-1' }

/** Deterministic random source: every draw yields `size` repeated bytes. */
export function fixedRandom(size: number): (n: number) => Buffer {
  return (bytes) => Buffer.alloc(bytes, size)
}

export interface FakeCredentialRepository extends CredentialRepository {
  /** The last credential persisted through issueCredential. */
  created?: ConsumerCredentialRecord
  /** Ordered record of every state transition observed by the double. */
  audit: Array<{ type: string; credentialId: string }>
  /** Simulates losing the repository CAS after the service generated a replacement. */
  forceNextRotationConflict: boolean
}

const DEFAULT_APPLICATION = { id: 'app-1', status: 'active' as const, credentialsRevision: 2 }

function seeded(seed?: Partial<ConsumerCredentialRecord>): ConsumerCredentialRecord {
  return {
    id: seed?.id ?? 'cred-1',
    applicationId: seed?.applicationId ?? 'app-1',
    name: seed?.name ?? 'production',
    prefix: seed?.prefix ?? 'prefix',
    secretHash: seed?.secretHash ?? 'a'.repeat(64),
    issueIdempotencyKey: seed?.issueIdempotencyKey ?? 'key-1',
    scopes: seed?.scopes ?? ['collections:read'],
    status: seed?.status ?? 'active',
    createdAt: seed?.createdAt ?? new Date('2026-08-20T00:00:00Z'),
    createdBy: seed?.createdBy ?? 'admin-1',
    expiresAt: seed?.expiresAt ?? null,
    revokedAt: seed?.revokedAt ?? null,
    revokedBy: seed?.revokedBy ?? null,
    rotatedAt: seed?.rotatedAt ?? null,
    rotatedToCredentialId: seed?.rotatedToCredentialId ?? null,
  }
}

/** In-memory repository honoring the exact CredentialRepository contract. */
export function fakeCredentialRepository(seed?: Partial<ConsumerCredentialRecord>): FakeCredentialRepository {
  const credentials = new Map<string, ConsumerCredentialRecord>()
  const applications = new Map([[DEFAULT_APPLICATION.id, { ...DEFAULT_APPLICATION }]])
  if (seed?.id) credentials.set(seed.id, seeded(seed))
  const audit: Array<{ type: string; credentialId: string }> = []

  function bumpRevision(applicationId: string) {
    const current = applications.get(applicationId)
    if (current) applications.set(applicationId, { ...current, credentialsRevision: current.credentialsRevision + 1 })
  }

  return {
    audit,
    forceNextRotationConflict: false,
    newCredentialId: () => 'credential-new',
    async activeApplication(id) {
      return applications.get(id) ?? null
    },
    async issueCredential(value) {
      credentials.set(value.id, value)
      this.created = value
      audit.push({ type: 'credential.issued', credentialId: value.id })
    },
    async findCredential(id) {
      return credentials.get(id) ?? null
    },
    async revokeCredential(id, actorId, now) {
      const current = credentials.get(id)
      if (!current) return null
      if (current.status === 'revoked') return { credential: current, changed: false }
      const updated = { ...current, status: 'revoked' as const, revokedAt: now, revokedBy: actorId }
      credentials.set(id, updated)
      bumpRevision(current.applicationId)
      audit.push({ type: 'credential.revoked', credentialId: id })
      return { credential: updated, changed: true }
    },
    async rotateCredential(id, clampedExpiry, now, _actorId, replacement) {
      const current = credentials.get(id)
      if (!current) return null
      if (this.forceNextRotationConflict) {
        this.forceNextRotationConflict = false
        return { rotated: current, changed: false }
      }
      if (current.status === 'revoked' || current.rotatedToCredentialId) return { rotated: current, changed: false }
      const rotated = {
        ...current,
        expiresAt: clampedExpiry,
        rotatedAt: now,
        rotatedToCredentialId: replacement.id,
      }
      credentials.set(id, rotated)
      credentials.set(replacement.id, replacement)
      bumpRevision(current.applicationId)
      audit.push({ type: 'credential.rotated', credentialId: id })
      return { rotated, changed: true }
    },
    async applicationRevision(id) {
      return applications.get(id)?.credentialsRevision ?? -1
    },
  }
}