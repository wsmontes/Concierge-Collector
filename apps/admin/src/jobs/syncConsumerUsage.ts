import type { Collection, Db } from 'mongodb'
import type { Model } from 'mongoose'
import type { Payload, TaskConfig } from 'payload'
import { readEnv } from '../env'
import { AdminHttpError } from '../http/errors'

/**
 * Scheduled Payload job that syncs aggregated consumer usage back to the CMS.
 *
 * FastAPI aggregates ``lastUsedAt`` per consumer credential in the operational
 * ``consumer_credential_usage`` collection; this job pages that aggregation
 * through the internal service-key endpoint and mirrors the maximum per
 * credential onto the CMS ``consumer_credentials`` documents (``$max``), which
 * the admin UI displays as last use.
 *
 * Responsibilities:
 * - read the ``consumer_usage_sync_state`` checkpoint (opaque FastAPI cursor)
 * - call ``GET {FASTAPI_BASE_URL}/api/v3/internal/consumer-usage?after=<cursor>&limit=500``
 *   with ``X-CMS-Service-Key: CMS_SERVICE_KEY``
 * - apply ``$max: {lastUsedAt}`` per credential BEFORE advancing the checkpoint
 * - 401 / network failure aborts without advancing the checkpoint and without
 *   touching any credential (revocation is never performed by this job)
 *
 * Replaying a page is always safe: ``$max`` only ever raises the stored value,
 * so a crash between the ``$max`` writes and the checkpoint write converges on
 * retry. A 409 (internal cursor expired after its 15-minute TTL) resets the
 * checkpoint to null so the next attempt restarts the scan from scratch.
 */

export interface ConsumerUsageRecord {
  credentialId: string
  lastUsedAt: string
}

export interface ConsumerUsagePage {
  items: ConsumerUsageRecord[]
  next_cursor: string | null
}

/** HTTP boundary to FastAPI, injectable for unit tests. */
export interface UsageFetchClient {
  fetchPage(after: string | null): Promise<ConsumerUsagePage>
}

/** Checkpoint boundary (CMS ``consumer_usage_sync_state``), injectable. */
export interface UsageSyncStore {
  readCursor(): Promise<string | null>
  writeCursor(cursor: string | null): Promise<void>
}

/** Credential write boundary (``$max`` on ``consumer_credentials``), injectable. */
export interface UsageSyncDb {
  applyLastUsed(updates: Array<{ credentialId: string; lastUsedAt: Date }>): Promise<void>
}

export interface SyncConsumerUsageDependencies {
  payload?: Payload
  fetchClient?: UsageFetchClient
  store?: UsageSyncStore
  db?: UsageSyncDb
}

export interface SyncConsumerUsageResult {
  pages: number
  items: number
}

const USAGE_PAGE_LIMIT = 500
const USAGE_ENDPOINT = '/api/v3/internal/consumer-usage'
const CHECKPOINT_COLLECTION = 'consumer_usage_sync_state'
const CHECKPOINT_ID = 'consumer-usage'

/** Lazily loads the Payload instance (test convenience; never a boot import cycle). */
async function currentPayload(): Promise<Payload> {
  const [{ default: config }, { getPayload }] = await Promise.all([
    import('../../payload.config'),
    import('payload'),
  ])
  return getPayload({ config })
}

/** Builds the real FastAPI client; called only when no client was injected. */
function defaultFetchClient(): UsageFetchClient {
  const env = readEnv()
  return new FastApiUsageClient(env.fastApiBaseUrl, env.cmsServiceKey)
}

/**
 * Real HTTP boundary: GETs one usage page from FastAPI with the rotating
 * service key. 401 means the service key is invalid (never advances the
 * checkpoint); 409 means the opaque cursor expired (caller resets the
 * checkpoint); any transport error surfaces as a transient 503.
 */
export class FastApiUsageClient implements UsageFetchClient {
  constructor(private readonly baseUrl: string, private readonly serviceKey: string) {}

  async fetchPage(after: string | null): Promise<ConsumerUsagePage> {
    const url = new URL(`${this.baseUrl}${USAGE_ENDPOINT}`)
    if (after !== null) url.searchParams.set('after', after)
    url.searchParams.set('limit', String(USAGE_PAGE_LIMIT))

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'X-CMS-Service-Key': this.serviceKey },
      })
    } catch {
      throw new AdminHttpError(503, 'service_unavailable')
    }
    if (response.status === 401) throw new AdminHttpError(401, 'authentication_required')
    if (response.status === 409) throw new AdminHttpError(409, 'conflict')
    if (!response.ok) throw new AdminHttpError(503, 'service_unavailable')

    const payload = (await response.json()) as { items?: unknown; next_cursor?: unknown }
    if (!Array.isArray(payload.items)) throw new AdminHttpError(503, 'service_unavailable')
    const items = payload.items.map((row): ConsumerUsageRecord => {
      const value = row as { credentialId?: unknown; lastUsedAt?: unknown }
      if (typeof value.credentialId !== 'string' || typeof value.lastUsedAt !== 'string') {
        throw new AdminHttpError(503, 'service_unavailable')
      }
      return { credentialId: value.credentialId, lastUsedAt: value.lastUsedAt }
    })
    return { items, next_cursor: typeof payload.next_cursor === 'string' ? payload.next_cursor : null }
  }
}

interface SyncStateDocument {
  _id: string
  cursor: string | null
  updatedAt: Date
}

/** Real checkpoint boundary: a single document in the raw CMS database. */
class PayloadUsageSyncStore implements UsageSyncStore {
  private readonly collection: Collection<SyncStateDocument>

  constructor(payload: Payload) {
    const db = payload.db.connection.db as Db | undefined
    if (!db) throw new AdminHttpError(503, 'service_unavailable')
    this.collection = db.collection<SyncStateDocument>(CHECKPOINT_COLLECTION)
  }

  async readCursor(): Promise<string | null> {
    const document = await this.collection.findOne({ _id: CHECKPOINT_ID })
    return typeof document?.cursor === 'string' ? document.cursor : null
  }

  async writeCursor(cursor: string | null): Promise<void> {
    await this.collection.updateOne(
      { _id: CHECKPOINT_ID },
      { $set: { cursor, updatedAt: new Date() } },
      { upsert: true },
    )
  }
}

type DocumentModel = Model<Record<string, unknown>>

/** Real credential boundary: one ``$max`` update per credential. */
class PayloadUsageSyncDb implements UsageSyncDb {
  private readonly credentials: DocumentModel

  constructor(payload: Payload) {
    const model = payload.db.collections['consumer-credentials']
    if (!model) throw new Error('Missing CMS collection model: consumer-credentials')
    this.credentials = model as unknown as DocumentModel
  }

  async applyLastUsed(updates: Array<{ credentialId: string; lastUsedAt: Date }>): Promise<void> {
    if (updates.length === 0) return
    await this.credentials.bulkWrite(
      updates.map((update) => ({
        updateOne: {
          filter: { _id: update.credentialId },
          update: { $max: { lastUsedAt: update.lastUsedAt } },
        },
      })),
      { ordered: false },
    )
  }
}

/**
 * Pages the full usage aggregation: for every page the ``$max`` updates land
 * BEFORE the checkpoint advances, so an interrupted run never loses data and
 * a replayed page is a no-op under ``$max`` semantics.
 */
export async function syncConsumerUsage(dependencies: SyncConsumerUsageDependencies = {}): Promise<SyncConsumerUsageResult> {
  // Defaults are built lazily so unit tests injecting all boundaries never
  // touch env vars or boot a Payload instance.
  let payloadPromise: Promise<Payload> | null = null
  const resolvePayload = (): Promise<Payload> => {
    if (dependencies.payload) return Promise.resolve(dependencies.payload)
    payloadPromise ??= currentPayload()
    return payloadPromise
  }
  const fetchClient = dependencies.fetchClient ?? defaultFetchClient()
  const store = dependencies.store ?? new PayloadUsageSyncStore(await resolvePayload())
  const db = dependencies.db ?? new PayloadUsageSyncDb(await resolvePayload())

  let cursor = await store.readCursor()
  let pages = 0
  let items = 0
  for (;;) {
    let page: ConsumerUsagePage
    try {
      page = await fetchClient.fetchPage(cursor)
    } catch (error) {
      // An expired internal cursor (15-minute TTL) must not poison the job
      // forever: reset the checkpoint so the next attempt restarts cleanly.
      if (error instanceof AdminHttpError && error.status === 409) {
        await store.writeCursor(null)
      }
      throw error
    }

    if (page.items.length > 0) {
      const updates = page.items.map((item): { credentialId: string; lastUsedAt: Date } => {
        const lastUsedAt = new Date(item.lastUsedAt)
        if (Number.isNaN(lastUsedAt.getTime())) throw new AdminHttpError(503, 'service_unavailable')
        return { credentialId: item.credentialId, lastUsedAt }
      })
      await db.applyLastUsed(updates)
    }

    cursor = page.next_cursor
    await store.writeCursor(cursor)
    pages += 1
    items += page.items.length
    if (cursor === null) break
  }
  return { pages, items }
}

type SyncConsumerUsageTask = {
  input: Record<string, never>
  output: { status: string }
}

export const syncConsumerUsageTask: TaskConfig<SyncConsumerUsageTask> & {
  /** Direct invocation used by unit tests; production only uses `handler`. */
  run(dependencies?: SyncConsumerUsageDependencies): Promise<SyncConsumerUsageResult>
} = {
  slug: 'sync-consumer-usage',
  schedule: [{ cron: '*/5 * * * *', queue: 'consumer-sync' }],
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
  inputSchema: [],
  outputSchema: [{ name: 'status', type: 'text', required: true }],
  handler: async ({ req }) => {
    await syncConsumerUsage({ payload: req.payload })
    return { output: { status: 'synced' } }
  },
  run: async (dependencies = {}) => syncConsumerUsage(dependencies),
}
