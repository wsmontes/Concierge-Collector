/**
 * Selection export domain types. The export worker mirrors the manifest
 * materialization lifecycle (claim/CAS/fencing) but writes allowlisted records
 * to private object storage instead of the CMS database.
 */

export type ExportFormat = 'ndjson' | 'csv'
export type ExportStatus = 'queued' | 'running' | 'complete' | 'failed'

export interface ExportRecord {
  id: string
  selectionId: string
  actorId: string
  format: ExportFormat
  status: ExportStatus
  progress: Record<string, number>
  key: string | null
  contentType: string | null
  sha256: string | null
  expiresAt: Date
  idempotencyKey: string
  requestHash: string
  requestId: string
  payloadJobId: string | null
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  fencingToken: number
}

export interface CreateExportCommand {
  selectionId: string
  actorId: string
  format: ExportFormat
  idempotencyKey: string
  requestId: string
}

/**
 * The only Curation/Entity fields permitted across the CMS boundary — the
 * hydration allowlist. The export writer serializes exactly these fields and
 * nothing else (never transcript, private notes, sources, embeddings or
 * credentials).
 */
export interface HydratedRecord {
  curationId: string
  entityId: string
  name: string
  curationNote: string | null
}

export interface UnavailableRecord {
  curationId: string
  reason: string
}

export interface ExportHydrationClient {
  introspectAdmin(actorId: string): Promise<void>
  hydrate(ids: string[]): Promise<{ items: HydratedRecord[]; unavailable: UnavailableRecord[] }>
}

export interface ExportRunResult {
  exportId: string
  status: ExportStatus
  /** Short-lived private URL; only present in the terminal `complete` state. */
  downloadUrl: string | null
  downloadExpiresAt: Date | null
}
