import { createHash, randomBytes as secureRandomBytes } from 'node:crypto'
import { AdminHttpError } from '../http/errors'
import type {
  ConsumerApplicationRecord,
  ConsumerCredentialPublic,
  ConsumerCredentialRecord,
  ConsumerCredentialScope,
  IssueCredentialCommand,
  IssueCredentialResult,
} from './types'

export interface CredentialRepository {
  newCredentialId(): string
  activeApplication(applicationId: string): Promise<ConsumerApplicationRecord | null>
  /** Persists credential, application revision and audit as one transaction. */
  issueCredential(credential: ConsumerCredentialRecord): Promise<void>
  findCredential(id: string): Promise<ConsumerCredentialRecord | null>
  /** Atomically marks an active credential revoked and increments its app revision. */
  revokeCredential(id: string, actorId: string, now: Date): Promise<{ credential: ConsumerCredentialRecord; changed: boolean } | null>
  /**
   * Rotates one credential in a single transaction: the replacement becomes
   * active, the old credential stays active only until `clampedExpiry`
   * (the caller already clamped it to the overlap window) and the
   * application revision advances once.
   */
  rotateCredential(
    id: string,
    clampedExpiry: Date,
    now: Date,
    actorId: string,
    replacement: ConsumerCredentialRecord,
  ): Promise<{ rotated: ConsumerCredentialRecord; changed: boolean } | null>
  applicationRevision(applicationId: string): Promise<number>
}

export interface RotateCredentialCommand {
  credentialId: string
  actorId: string
  idempotencyKey: string
  /** The old credential remains valid until this instant, never beyond. */
  overlapUntil: Date
  name?: string
  scopes?: ConsumerCredentialScope[]
  expiresAt?: Date | null
}

export interface GeneratedCredential {
  raw: string
  prefix: string
  hash: string
}

const VALID_SCOPE: ReadonlySet<string> = new Set(['collections:read'])

export function createOpaqueCredential(randomBytes: (size: number) => Buffer = secureRandomBytes): GeneratedCredential {
  const secret = randomBytes(32).toString('base64url')
  const prefix = createHash('sha256').update(secret).digest('hex').slice(0, 12)
  const raw = `cck_${prefix}_${secret}`
  return { raw, prefix, hash: createHash('sha256').update(raw).digest('hex') }
}

function publicCredential(credential: ConsumerCredentialRecord): ConsumerCredentialPublic {
  const {
    secretHash: _secretHash,
    issueIdempotencyKey: _issueIdempotencyKey,
    createdBy: _createdBy,
    revokedBy: _revokedBy,
    rotatedAt: _rotatedAt,
    rotatedToCredentialId: _rotatedToCredentialId,
    ...safe
  } = credential
  return safe
}

function validateIssue(command: IssueCredentialCommand, now: Date): IssueCredentialCommand {
  const name = command.name.trim()
  const scopes = [...new Set(command.scopes)]
  if (!command.applicationId || !command.actorId || !command.idempotencyKey || !name || name.length > 120 || scopes.length === 0 || scopes.some((scope) => !VALID_SCOPE.has(scope))) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  if (command.expiresAt && (!Number.isFinite(command.expiresAt.getTime()) || command.expiresAt <= now)) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  return { ...command, name, scopes: scopes as ConsumerCredentialScope[] }
}

export async function issueCredential(
  command: IssueCredentialCommand,
  repository: CredentialRepository,
  randomBytes: (size: number) => Buffer = secureRandomBytes,
  now = new Date(),
): Promise<IssueCredentialResult> {
  const input = validateIssue(command, now)
  const application = await repository.activeApplication(input.applicationId)
  if (!application) throw new AdminHttpError(404, 'not_found')
  const generated = createOpaqueCredential(randomBytes)
  const credential: ConsumerCredentialRecord = {
    id: repository.newCredentialId(), applicationId: input.applicationId, name: input.name, prefix: generated.prefix,
    secretHash: generated.hash, issueIdempotencyKey: input.idempotencyKey, scopes: input.scopes, status: 'active', createdAt: now, createdBy: input.actorId,
    expiresAt: input.expiresAt, revokedAt: null, revokedBy: null, rotatedAt: null, rotatedToCredentialId: null,
  }
  await repository.issueCredential(credential)
  return { credential: publicCredential(credential), secretOnce: generated.raw }
}

export async function revokeCredential(
  credentialId: string,
  actorId: string,
  repository: CredentialRepository,
  now = new Date(),
): Promise<ConsumerCredentialPublic> {
  if (!credentialId || !actorId) throw new AdminHttpError(400, 'invalid_request')
  const current = await repository.findCredential(credentialId)
  if (!current) throw new AdminHttpError(404, 'not_found')
  if (current.status === 'revoked') return publicCredential(current)
  const result = await repository.revokeCredential(credentialId, actorId, now)
  if (!result) throw new AdminHttpError(404, 'not_found')
  // A concurrent winner returns changed:false and owns the single audit.
  return publicCredential(result.credential)
}

function validateRotate(command: RotateCredentialCommand, now: Date): RotateCredentialCommand {
  const name = command.name?.trim()
  const scopes = command.scopes ? [...new Set(command.scopes)] : undefined
  if (!command.credentialId || !command.actorId || !command.idempotencyKey) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  if (!command.overlapUntil || !Number.isFinite(command.overlapUntil.getTime()) || command.overlapUntil <= now) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  if (name !== undefined && (!name || name.length > 120)) throw new AdminHttpError(400, 'invalid_request')
  if (scopes !== undefined && (scopes.length === 0 || scopes.some((scope) => !VALID_SCOPE.has(scope)))) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  if (command.expiresAt && (!Number.isFinite(command.expiresAt.getTime()) || command.expiresAt <= now)) {
    throw new AdminHttpError(400, 'invalid_request')
  }
  return { ...command, ...(name === undefined ? {} : { name }), ...(scopes === undefined ? {} : { scopes }) }
}

/**
 * Rotates a credential with an explicit overlap window.
 *
 * A brand-new secret is issued show-once; the old credential keeps status
 * `active` only until `overlapUntil` (clamped to its own expiry), so
 * consumers can switch without a cutover. The single repository transaction
 * persists replacement, clamp and revision bump together.
 */
export async function rotateCredential(
  credentialId: string,
  command: RotateCredentialCommand,
  repository: CredentialRepository,
  randomBytes: (size: number) => Buffer = secureRandomBytes,
  now = new Date(),
): Promise<IssueCredentialResult> {
  const input = validateRotate({ ...command, credentialId }, now)
  const current = await repository.findCredential(credentialId)
  if (!current) throw new AdminHttpError(404, 'not_found')
  if (current.status !== 'active' || current.rotatedToCredentialId) throw new AdminHttpError(409, 'conflict')
  const application = await repository.activeApplication(current.applicationId)
  if (!application) throw new AdminHttpError(404, 'not_found')

  const generated = createOpaqueCredential(randomBytes)
  const replacement: ConsumerCredentialRecord = {
    id: repository.newCredentialId(), applicationId: current.applicationId, name: input.name ?? current.name,
    prefix: generated.prefix, secretHash: generated.hash, issueIdempotencyKey: input.idempotencyKey,
    scopes: input.scopes ?? current.scopes, status: 'active', createdAt: now, createdBy: input.actorId,
    expiresAt: input.expiresAt !== undefined ? input.expiresAt : current.expiresAt, revokedAt: null, revokedBy: null,
    rotatedAt: null, rotatedToCredentialId: null,
  }
  const clampedExpiry = current.expiresAt && current.expiresAt < input.overlapUntil ? current.expiresAt : input.overlapUntil
  const result = await repository.rotateCredential(current.id, clampedExpiry, now, input.actorId, replacement)
  if (!result) throw new AdminHttpError(404, 'not_found')
  // A concurrent caller may have observed the same active source before the
  // first transaction committed. Only the CAS winner owns a persisted secret.
  if (!result.changed) throw new AdminHttpError(409, 'conflict')
  return { credential: publicCredential(replacement), secretOnce: generated.raw }
}