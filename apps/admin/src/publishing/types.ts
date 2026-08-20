export type PublishStatus = 'queued' | 'running' | 'committing' | 'completed' | 'failed' | 'cancelled' | 'stale' | 'conflicted' | 'authorization_revoked'

export interface PublishAvailability {
  selectedCount: number
  availableCount: number
  unavailableCount: number
}

export interface PublishAvailabilityClient {
  hydrateCurations(ids: string[]): Promise<{
    availableCount: number
    unavailableCount: number
  }>
  introspectAdmin(actorId: string): Promise<void>
}

export interface EnqueuePublishCommand {
  collectionId: string
  ifMatch: number
  idempotencyKey: string
  requestId: string
  actorId: string
  confirmUnavailable: boolean
  expectedUnavailableCount?: number
}

export interface PublishJobRecord {
  id: string
  collectionId: string
  fixedCollectionRevision: number
  fixedDraftEpoch: string
  fixedDraftRevision: number
  baseVersion: number | null
  targetVersion: number
  status: PublishStatus
  checkpoint?: string | null
  selectedCount?: number | null
  membershipHash?: string | null
  leaseOwner?: string | null
  leaseExpiresAt?: Date | null
  fencingToken: number
  actorId: string
  requestId: string
  idempotencyKey: string
  requestHash: string
  payloadJobId: string
  confirmedUnavailableCount: number
}

export interface PublishLease {
  owner: string
  fencingToken: number
}

export interface RestoreVersionAsDraftCommand {
  collectionId: string
  version: number
  actorId: string
  requestId: string
}

export interface RestoreVersionAsDraftResult {
  collectionId: string
  restoredVersion: number
  baseVersion: number
  addedCount: number
  removedCount: number
  operationIds: string[]
}
