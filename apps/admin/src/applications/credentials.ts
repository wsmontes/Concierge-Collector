import { createHash, randomBytes as secureRandomBytes, randomUUID } from 'node:crypto'
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
  activeApplication(applicationId: string): Promise<ConsumerApplicationRecord | null>
  createCredential(credential: ConsumerCredentialRecord): Promise<void>
  findCredential(id: string): Promise<ConsumerCredentialRecord | null>
  /** Atomically marks an active credential revoked and increments its app revision. */
  revokeCredential(id: string, actorId: string, now: Date): Promise<{ credential: ConsumerCredentialRecord; changed: boolean } | null>
  appendAudit(eventType: 'credential.issued' | 'credential.revoked', credentialId: string): Promise<void>
  applicationRevision(applicationId: string): Promise<number>
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
  const { secretHash: _secretHash, createdBy: _createdBy, revokedBy: _revokedBy, ...safe } = credential
  return safe
}

function validateIssue(command: IssueCredentialCommand, now: Date): IssueCredentialCommand {
  const name = command.name.trim()
  const scopes = [...new Set(command.scopes)]
  if (!command.applicationId || !command.actorId || !name || name.length > 120 || scopes.length === 0 || scopes.some((scope) => !VALID_SCOPE.has(scope))) {
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
    id: randomUUID(), applicationId: input.applicationId, name: input.name, prefix: generated.prefix,
    secretHash: generated.hash, scopes: input.scopes, status: 'active', createdAt: now, createdBy: input.actorId,
    expiresAt: input.expiresAt, revokedAt: null, revokedBy: null,
  }
  await repository.createCredential(credential)
  await repository.appendAudit('credential.issued', credential.id)
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
  if (result.changed) await repository.appendAudit('credential.revoked', result.credential.id)
  return publicCredential(result.credential)
}
