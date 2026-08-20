export type ConsumerApplicationStatus = 'active' | 'suspended'
export type ConsumerCredentialStatus = 'active' | 'revoked'
export type ConsumerCredentialScope = 'collections:read'

export interface ConsumerApplicationRecord {
  id: string
  status: ConsumerApplicationStatus
  credentialsRevision: number
}

export interface ConsumerCredentialRecord {
  id: string
  applicationId: string
  name: string
  prefix: string
  secretHash: string
  issueIdempotencyKey: string
  scopes: ConsumerCredentialScope[]
  status: ConsumerCredentialStatus
  createdAt: Date
  createdBy: string
  expiresAt: Date | null
  revokedAt: Date | null
  revokedBy: string | null
  /** Internal lineage marker: one source credential may mint one successor. */
  rotatedAt: Date | null
  rotatedToCredentialId: string | null
}

export interface ConsumerCredentialPublic {
  id: string
  applicationId: string
  name: string
  prefix: string
  scopes: ConsumerCredentialScope[]
  status: ConsumerCredentialStatus
  createdAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
}

export interface IssueCredentialCommand {
  applicationId: string
  name: string
  scopes: ConsumerCredentialScope[]
  expiresAt: Date | null
  actorId: string
  idempotencyKey: string
}

export interface IssueCredentialResult {
  credential: ConsumerCredentialPublic
  /** Returned once to the caller; never placed in persistence or logs. */
  secretOnce: string
}