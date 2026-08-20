#!/usr/bin/env node
/**
 * Explorer selection benchmark — Task 6 / plan 04 ("exportar seleção para
 * object storage e medir escala").
 *
 * Seeds `--items` curations into a COLLECTOR TEST database (the database name
 * must end in `-test`; production databases are refused), then measures, in
 * order:
 *   1. search      — GET  /api/v3/catalog/curations (first pages + one full walk)
 *   2. scan        — POST /catalog/curations/scan/start + scan/page until exhausted
 *   3. resolve     — POST /catalog/curations/resolve (the FastAPI half of materialize)
 *   4. materialize — CMS admin POST /admin/v1/selections + poll until ready
 *   5. apply       — CMS admin POST /admin/v1/selections/:id/operations + poll
 *   6. worker_rss  — RSS of the process listening on the FastAPI port
 *   7. dom_rows    — headless Chromium DOM row count + JS heap against --ui-url
 *
 * Every phase degrades gracefully (recorded in `skips`) and the process exits
 * 0 as long as search/scan were attempted, so the script is safe on machines
 * without the full stack (no Payload CMS, no UI, no Playwright). The browser
 * never materializes the dataset: it measures DOM rows and heap, it never
 * renders 50k rows at once.
 *
 * The FastAPI instance under test MUST point at a -test database:
 *   MONGODB_DB_NAME=concierge-collector-test venv/bin/python -m uvicorn main:app --port 8100
 *
 * Usage:
 *   node apps/admin/tests/load/explorer-selection.mjs \
 *     --items 50000 --output /tmp/collections-benchmark.json \
 *     --service-key "$CMS_SERVICE_KEY" \
 *     --fastapi-base-url http://localhost:8100 \
 *     [--mongo-url "$MONGODB_URL"] [--mongo-db concierge-collector-test] \
 *     [--cms-url http://localhost:3000] [--ui-url http://localhost:8080] \
 *     [--no-seed] [--keep-data] [--quiet]
 *
 * Exit codes: 0 ok (even with skips), 2 CLI/database-guard error,
 * 1 no core phase could run.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { MongoClient, ObjectId } from 'mongodb'

const execFileAsync = promisify(execFile)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    items: 50_000,
    output: null,
    mongoUrl: process.env.MONGODB_URL ?? 'mongodb://127.0.0.1:27017',
    mongoDb: process.env.MONGODB_DB_NAME ?? 'concierge-collector-test',
    cmsMongoDb: process.env.CMS_MONGODB_DB_NAME ?? 'concierge-cms-test',
    serviceKey: process.env.CMS_SERVICE_KEY ?? '',
    fastapiBaseUrl: 'http://localhost:8100',
    cmsUrl: process.env.CMS_PUBLIC_SERVER_URL ?? 'http://localhost:3000',
    uiUrl: 'http://localhost:8080',
    seed: true,
    keepData: false,
    quiet: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--no-seed') options.seed = false
    else if (arg === '--keep-data') options.keepData = true
    else if (arg === '--quiet') options.quiet = true
    else if (arg.startsWith('--') && i + 1 < argv.length) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())
      const value = argv[i + 1]
      if (key === 'items') options.items = Number(value)
      else if (key in options) options[key] = value
      else throw new Error(`Unknown option --${arg.slice(2)}`)
      i += 1
    } else throw new Error(`Unknown argument "${arg}"`)
  }
  if (!options.output) throw new Error('--output is required')
  if (!Number.isInteger(options.items) || options.items < 1) throw new Error('--items must be a positive integer')
  return options
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentile(sorted, pct) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))
  return Math.round(sorted[index] * 10) / 10
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  return {
    count: values.length,
    minMs: sorted.length ? Math.round(sorted[0] * 10) / 10 : null,
    maxMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : null,
    meanMs: mean === null ? null : Math.round(mean * 10) / 10,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  }
}

/** fetch() with bounded retries on network errors and 5xx; counts retry events. */
async function requestWithRetry(phase, url, init, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = performance.now()
    try {
      const response = await fetch(url, init)
      if (response.status >= 500 && attempt < attempts) {
        retries[phase] = (retries[phase] ?? 0) + 1
        await sleep(250 * attempt)
        continue
      }
      return { response, ms: performance.now() - started }
    } catch (error) {
      lastError = error
      retries[phase] = (retries[phase] ?? 0) + 1
      if (attempt < attempts) await sleep(250 * attempt)
    }
  }
  throw lastError ?? new Error(`request failed after ${attempts} attempts`)
}

function report(message) {
  if (!options.quiet) console.log(message)
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

async function seedPhase(db, items) {
  const highest = await db.collection('curations').findOne(
    { catalog_sequence: { $type: 'number' } },
    { sort: { catalog_sequence: -1 }, projection: { catalog_sequence: 1 } },
  )
  const base = Number(highest?.catalog_sequence ?? 0)
  const docs = []
  for (let i = 1; i <= items; i += 1) {
    docs.push({
      _id: new ObjectId(),
      curation_id: `bench-${String(i).padStart(8, '0')}`,
      catalog_sequence: base + i,
      status: 'active',
      restaurant_name: `Benchmark Restaurant ${i}`,
      city: 'Benchmark City',
      type: 'restaurant',
      curator_id: 'benchmark-curator',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
  const batchMs = []
  const BATCH = 1000
  for (let i = 0; i < docs.length; i += BATCH) {
    const started = performance.now()
    await db.collection('curations').insertMany(docs.slice(i, i + BATCH), { ordered: false })
    batchMs.push(performance.now() - started)
  }
  seededIds.push(...docs.map((doc) => doc._id))

  const user = await db.collection('users').findOneAndUpdate(
    { email: 'benchmark@collector.test' },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        authorized: true,
        role: 'admin',
        name: 'Benchmark',
        email: 'benchmark@collector.test',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  seededUserIds.push(user._id)
  benchmarkSubject = user.email

  const totalMs = batchMs.reduce((sum, ms) => sum + ms, 0)
  return {
    docs: docs.length,
    batches: Math.ceil(docs.length / BATCH),
    batchMs: stats(batchMs),
    throughputDocsPerS: Math.round((docs.length / (totalMs / 1000)) * 10) / 10,
    actorSubject: benchmarkSubject,
  }
}

async function searchPhase(baseUrl) {
  const latencies = []
  let rows = 0
  const queries = ['', 'Benchmark', 'Restaurant 5', 'no-such-term-benchmark', 'Benchmark City']
  for (const q of queries) {
    const url = `${baseUrl}/api/v3/catalog/curations?limit=500&q=${encodeURIComponent(q)}`
    const { response, ms } = await requestWithRetry('search', url, catalogHeaders())
    latencies.push(ms)
    if (!response.ok) throw new Error(`search ${q} -> HTTP ${response.status}`)
    const body = await response.json()
    rows += body.items.length
  }
  // One full cursor walk over q=Benchmark to exercise the paginated path.
  let cursor = null
  do {
    const url = `${baseUrl}/api/v3/catalog/curations?limit=500&q=Benchmark${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const { response, ms } = await requestWithRetry('search', url, catalogHeaders())
    latencies.push(ms)
    if (!response.ok) throw new Error(`search walk -> HTTP ${response.status}`)
    const body = await response.json()
    rows += body.items.length
    cursor = body.next_cursor
  } while (cursor)
  return { ...stats(latencies), rows, retries: retries.search ?? 0 }
}

async function scanPhase(baseUrl) {
  const start = await requestWithRetry(
    'scan',
    `${baseUrl}/api/v3/catalog/curations/scan/start`,
    catalogHeaders({ 'content-type': 'application/json' }, JSON.stringify({ filters: {} })),
  )
  if (!start.response.ok) throw new Error(`scan/start -> HTTP ${start.response.status}`)
  const { scan_token: scanToken } = await start.response.json()

  const latencies = [start.ms]
  let cursor = null
  let rows = 0
  let pages = 0
  do {
    const { response, ms } = await requestWithRetry(
      'scan',
      `${baseUrl}/api/v3/catalog/curations/scan/page`,
      catalogHeaders({ 'content-type': 'application/json' }, JSON.stringify({ scan_token: scanToken, cursor, limit: 500 })),
    )
    latencies.push(ms)
    if (!response.ok) throw new Error(`scan/page -> HTTP ${response.status}`)
    const body = await response.json()
    rows += body.items.length
    cursor = body.next_cursor
    pages += 1
  } while (cursor)
  return { ...stats(latencies), pages, rows, retries: retries.scan ?? 0 }
}

async function resolvePhase(baseUrl, db) {
  const cursor = db.collection('curations').find({ curation_id: /^bench-/ })
    .sort({ catalog_sequence: 1 })
    .project({ curation_id: 1 })
    .limit(Math.min(500, options.items))
  const ids = (await cursor.toArray()).map((doc) => String(doc.curation_id))
  const { response, ms } = await requestWithRetry(
    'resolve',
    `${baseUrl}/api/v3/catalog/curations/resolve`,
    catalogHeaders({ 'content-type': 'application/json' }, JSON.stringify({ curation_ids: ids })),
  )
  if (!response.ok) throw new Error(`resolve -> HTTP ${response.status}`)
  const body = await response.json()
  return { requested: ids.length, resolved: body.eligible_ids?.length ?? ids.length, ms: Math.round(ms * 10) / 10, retries: retries.resolve ?? 0 }
}

/**
 * CMS admin materialize + apply. Only meaningful when a Payload CMS is
 * reachable; the session is minted directly in the CMS test database
 * (sha256 of the cookie + subject that FastAPI accepts as a current admin).
 */
async function mintCmsSession(client) {
  const cmsDb = client.db(options.cmsMongoDb)
  const users = cmsDb.collection('cms_users')
  const sessions = cmsDb.collection('cms_sessions')
  const cookie = randomBytes(24).toString('hex')
  const sessionHash = createHash('sha256').update(cookie).digest('hex')
  const user = await users.findOne({ email: 'benchmark@collector.test' })
  let userId
  if (user) userId = new ObjectId(String(user._id))
  else {
    const inserted = await users.insertOne({
      fastapiUserId: benchmarkSubject,
      email: 'benchmark@collector.test',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    userId = inserted.insertedId
    mintedUserIds.push(userId)
  }
  const insertedSession = await sessions.insertOne({
    sessionHash,
    user: userId,
    subject: benchmarkSubject,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  mintedSessionIds.push(insertedSession.insertedId)
  return { cookie, cmsDb, userId }
}

function cmsHeaders(cookie, extra = {}) {
  return {
    'content-type': 'application/json',
    cookie: `cms_session=${cookie}`,
    'x-request-id': `bench-${randomBytes(4).toString('hex')}`,
    ...extra,
  }
}

async function materializePhase(cmsUrl, client) {
  let session
  try {
    session = await mintCmsSession(client)
  } catch (error) {
    return skip('materialize', `cms_db_unavailable: ${error.message}`)
  }
  try {
    const started = performance.now()
    const created = await requestWithRetry(
      'materialize',
      `${cmsUrl}/api/admin/v1/selections`,
      {
        ...cmsHeaders(session.cookie, { 'idempotency-key': 'bench-materialize' }),
        method: 'POST',
        body: JSON.stringify({ mode: 'all_matching', filters: { q: 'Benchmark' } }),
      },
    )
    if (!created.response.ok) return skip('materialize', `cms_selection_http_${created.response.status}`)
    const { id: selectionId } = await created.response.json()
    // Poll until the materialize worker marks the selection ready.
    let ready = false
    for (let i = 0; i < 60; i += 1) {
      const polled = await fetch(`${cmsUrl}/api/admin/v1/selections/${selectionId}`, { headers: cmsHeaders(session.cookie) })
      if (!polled.ok) return skip('materialize', `cms_poll_http_${polled.status}`)
      const body = await polled.json()
      if (body.status === 'ready') { ready = true; break }
      await sleep(1000)
    }
    const elapsed = Math.round((performance.now() - started) * 10) / 10
    return ready ? { selectionId, readyMs: elapsed } : skip('materialize', 'selection_not_ready_in_60s')
  } catch (error) {
    return skip('materialize', `cms_admin_unreachable: ${error.message}`)
  }
}

async function applyPhase(cmsUrl, client, selectionId) {
  if (!selectionId) return skip('apply', 'no_materialized_selection')
  let session
  try {
    session = await mintCmsSession(client)
  } catch (error) {
    return skip('apply', `cms_db_unavailable: ${error.message}`)
  }
  try {
    const collections = session.cmsDb.collection('collections')
    let collection = await collections.findOne({ slug: 'benchmark' })
    if (!collection) {
      const inserted = await collections.insertOne({
        slug: 'benchmark',
        title: 'Benchmark Collection',
        lifecycle: 'draft',
        draftEpoch: `bench-${Date.now()}`,
        draftRevision: 0,
        publishFencingToken: 0,
        operationSequenceCounter: 0,
        draftState: 'clean',
        publishedSelectedCount: 0,
        draftSelectedCount: 0,
        revision: 1,
        everPublished: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      collection = { _id: inserted.insertedId }
      mintedCollectionIds.push(collection._id)
    }
    const started = performance.now()
    const enqueued = await requestWithRetry(
      'apply',
      `${cmsUrl}/api/admin/v1/selections/${selectionId}/operations`,
      {
        ...cmsHeaders(session.cookie, { 'idempotency-key': 'bench-apply' }),
        method: 'POST',
        body: JSON.stringify({ collectionIds: [String(collection._id)], action: 'add' }),
      },
    )
    if (!enqueued.response.ok) return skip('apply', `cms_apply_http_${enqueued.response.status}`)
    const { operationId } = await enqueued.response.json()
    let terminal = false
    for (let i = 0; i < 60; i += 1) {
      const polled = await fetch(`${cmsUrl}/api/admin/v1/operations/${operationId}`, { headers: cmsHeaders(session.cookie) })
      if (!polled.ok) return skip('apply', `cms_apply_poll_http_${polled.status}`)
      const body = await polled.json()
      if (body.status === 'completed' || body.status === 'failed') { terminal = body.status; break }
      await sleep(1000)
    }
    return {
      operationId,
      terminalStatus: terminal ?? 'timeout',
      ms: Math.round((performance.now() - started) * 10) / 10,
    }
  } catch (error) {
    return skip('apply', `cms_admin_unreachable: ${error.message}`)
  }
}

async function workerRssPhase(baseUrl) {
  let port
  try { port = new URL(baseUrl).port } catch { return skip('worker_rss', 'invalid_base_url') }
  const pid = await pidForPort(port)
  if (!pid) return skip('worker_rss', 'no_process_listening')
  const rss = await rssKb(pid)
  if (rss === null) return skip('worker_rss', 'rss_unavailable')
  return { pid, rssKb: rss }
}

async function domRowsPhase(uiUrl) {
  let chromium
  try {
    ({ chromium } = await import('@playwright/test'))
  } catch {
    return skip('dom_rows', 'playwright_unavailable')
  }
  let browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch {
    return skip('dom_rows', 'playwright_unavailable')
  }
  try {
    const page = await browser.newPage()
    await page.goto(uiUrl, { timeout: 15_000, waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000) // offline-first clients hydrate progressively
    const measured = await page.evaluate(() => {
      const memory = window.performance && window.performance.memory
        ? {
            jsHeapMB: Math.round(window.performance.memory.usedJSHeapSize / 1_048_576),
            totalHeapMB: Math.round(window.performance.memory.totalJSHeapSize / 1_048_576),
          }
        : null
      return {
        rows: document.querySelectorAll('[data-row], tbody tr, .entity-row, [data-entity-row]').length,
        bodyChars: document.body.innerText.length,
        heap: memory,
      }
    })
    // The browser must never hold the whole dataset at once.
    return { ...measured, domRowsBounded: measured.rows < options.items }
  } catch {
    return skip('dom_rows', 'ui_unreachable')
  } finally {
    await browser?.close()
  }
}

async function queueAgePhase(client) {
  try {
    const oldest = await client.db(options.cmsMongoDb).collection('payload-jobs').findOne({}, { sort: { createdAt: 1 } })
    return oldest ? { maxAgeMs: Math.max(0, Date.now() - new Date(oldest.createdAt).getTime()) } : { maxAgeMs: null }
  } catch {
    return { maxAgeMs: null }
  }
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

/** Builds a fetch() init: catalog headers under `headers`, JSON under `body`. */
function catalogHeaders(extra = {}, body) {
  return {
    headers: {
      'X-CMS-Service-Key': options.serviceKey,
      'X-CMS-Actor-Id': benchmarkSubject,
      ...extra,
    },
    ...(body ? { method: 'POST', body } : {}),
  }
}

function skip(phase, reason) {
  skips.push({ phase, reason })
  return { skipped: true, reason }
}

async function pidForPort(port) {
  try {
    const { stdout } = await execFileAsync('lsof', [`-iTCP:${port}`, '-sTCP:LISTEN', '-t', '-P', '-n'])
    return stdout.trim().split('\n')[0] || null
  } catch {
    return null
  }
}

async function rssKb(pid) {
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'rss=', '-p', String(pid)])
    const kb = Number(stdout.trim())
    return Number.isFinite(kb) ? kb : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const options = parseArgs(process.argv.slice(2))
const retries = {}
const skips = []
const seededIds = []
const seededUserIds = []
const mintedSessionIds = []
const mintedUserIds = []
const mintedCollectionIds = []
let benchmarkSubject = 'benchmark@collector.test'

const startedAt = new Date()
const main = async () => {
  if (!options.mongoDb.endsWith('-test')) {
    report(`Refusing to seed benchmark data into non-test database "${options.mongoDb}". Use a -test database.`)
    process.exitCode = 2
    return
  }
  if (!options.serviceKey) {
    report('--service-key (or CMS_SERVICE_KEY) is required to call the catalog API.')
    process.exitCode = 2
    return
  }

  const client = new MongoClient(options.mongoUrl)
  await client.connect()
  const db = client.db(options.mongoDb)
  const result = {
    dataset: { items: options.items, db: options.mongoDb, mongoUrl: options.mongoUrl },
    indexes: [],
    phases: {},
    worker_rss_kb: null,
    dom_rows: null,
    queue_max_age_ms: null,
    skips: [],
    failures: [],
    started_at: startedAt.toISOString(),
  }

  try {
    result.indexes = (await db.collection('curations').indexes()).map(({ name, key, expireAfterSeconds }) => ({ name, key, ttl: expireAfterSeconds ?? null }))

    if (options.seed) {
      const seeded = await seedPhase(db, options.items)
      result.phases.seed = seeded
      report(`seeded ${seeded.docs} curations in ${seeded.batches} batches (${seeded.throughputDocsPerS} docs/s, actor ${seeded.actorSubject})`)
    } else {
      const actor = await db.collection('users').findOne({ email: 'benchmark@collector.test' })
      if (!actor) return skip('seed', 'no_benchmark_actor_with_no_seed')
      benchmarkSubject = actor.email
      report(`reusing existing dataset of ${options.items} items (--no-seed)`)
    }

    // RSS baseline before any traffic.
    const rssBefore = await workerRssPhase(options.fastapiBaseUrl)
    result.worker_rss_kb = rssBefore.skipped ? { skipped: true, reason: rssBefore.reason } : { baselineKb: rssBefore.rssKb, pid: rssBefore.pid }

    const coreAttempted = { search: false, scan: false }
    try {
      result.phases.search = await searchPhase(options.fastapiBaseUrl)
      coreAttempted.search = true
      report(`search: ${result.phases.search.count} requests, p50 ${result.phases.search.p50Ms}ms, p95 ${result.phases.search.p95Ms}ms, p99 ${result.phases.search.p99Ms}ms, ${result.phases.search.rows} rows`)
    } catch (error) {
      result.failures.push({ phase: 'search', error: error.message })
    }
    try {
      result.phases.scan = await scanPhase(options.fastapiBaseUrl)
      coreAttempted.scan = true
      const throughput = Math.round((result.phases.scan.rows / (result.phases.scan.meanMs * result.phases.scan.count / 1000)) * 10) / 10
      result.phases.scan.throughputRowsPerS = throughput
      report(`scan: ${result.phases.scan.pages} pages, ${result.phases.scan.rows} rows, p50 ${result.phases.scan.p50Ms}ms, p95 ${result.phases.scan.p95Ms}ms, p99 ${result.phases.scan.p99Ms}ms (${throughput} rows/s)`)
    } catch (error) {
      result.failures.push({ phase: 'scan', error: error.message })
    }
    try {
      result.phases.resolve = await resolvePhase(options.fastapiBaseUrl, db)
      report(`resolve: ${result.phases.resolve.requested} ids in ${result.phases.resolve.ms}ms`)
    } catch (error) {
      result.failures.push({ phase: 'resolve', error: error.message })
    }

    const rssAfterCore = await workerRssPhase(options.fastapiBaseUrl)
    if (!rssAfterCore.skipped) result.worker_rss_kb.afterCoreKb = rssAfterCore.rssKb

    let materializedSelectionId = null
    try {
      result.phases.materialize = await materializePhase(options.cmsUrl, client)
      if (!result.phases.materialize.skipped) {
        materializedSelectionId = result.phases.materialize.selectionId
        report(`materialize: selection ${materializedSelectionId} ready in ${result.phases.materialize.readyMs}ms`)
      } else {
        report(`materialize skipped: ${result.phases.materialize.reason}`)
      }
    } catch (error) {
      result.failures.push({ phase: 'materialize', error: error.message })
    }
    try {
      result.phases.apply = await applyPhase(options.cmsUrl, client, materializedSelectionId)
      if (!result.phases.apply.skipped) report(`apply: operation ${result.phases.apply.operationId} ${result.phases.apply.terminalStatus} in ${result.phases.apply.ms}ms`)
      else report(`apply skipped: ${result.phases.apply.reason}`)
    } catch (error) {
      result.failures.push({ phase: 'apply', error: error.message })
    }

    const rssAfterCms = await workerRssPhase(options.fastapiBaseUrl)
    if (!rssAfterCms.skipped) result.worker_rss_kb.afterCmsKb = rssAfterCms.rssKb

    result.dom_rows = await domRowsPhase(options.uiUrl)
    if (result.dom_rows.skipped) report(`dom_rows skipped: ${result.dom_rows.reason}`)
    else report(`dom_rows: ${result.dom_rows.rows} rows, bounded=${result.dom_rows.domRowsBounded}, heap ${result.dom_rows.heap?.jsHeapMB ?? 'n/a'}MB`)

    result.queue_max_age_ms = (await queueAgePhase(client)).maxAgeMs

    if (!result.worker_rss_kb.skipped && result.worker_rss_kb.afterCmsKb) {
      result.worker_rss_kb.peakKb = Math.max(result.worker_rss_kb.baselineKb, result.worker_rss_kb.afterCoreKb ?? 0, result.worker_rss_kb.afterCmsKb)
      result.worker_rss_kb.maxDeltaKb = result.worker_rss_kb.peakKb - result.worker_rss_kb.baselineKb
    }

    result.skips = skips
    result.retries = retries
    result.ended_at = new Date().toISOString()
    result.elapsed_s = Math.round(((Date.now() - startedAt.getTime()) / 1000) * 10) / 10

    await writeFile(options.output, JSON.stringify(result, null, 2))
    report(`benchmark written to ${options.output}`)

    if (!coreAttempted.search && !coreAttempted.scan) {
      report('No core phase (search/scan) could run against the FastAPI; nothing meaningful measured.')
      process.exitCode = 1
    }
  } finally {
    if (!options.keepData) {
      try {
        const cleanupDb = client.db(options.mongoDb)
        if (seededIds.length) await cleanupDb.collection('curations').deleteMany({ _id: { $in: seededIds } })
        if (seededUserIds.length) await cleanupDb.collection('users').deleteMany({ _id: { $in: seededUserIds } })
        // The CMS session/user/collection docs live in the CMS database.
        const cleanupCmsDb = client.db(options.cmsMongoDb)
        if (mintedSessionIds.length) await cleanupCmsDb.collection('cms_sessions').deleteMany({ _id: { $in: mintedSessionIds } })
        if (mintedUserIds.length) await cleanupCmsDb.collection('cms_users').deleteMany({ _id: { $in: mintedUserIds } })
        if (mintedCollectionIds.length) await cleanupCmsDb.collection('collections').deleteMany({ _id: { $in: mintedCollectionIds } })
      } catch (error) {
        report(`cleanup failed: ${error.message}`)
      }
    }
    await client.close()
  }
}

main().catch((error) => {
  report(`fatal: ${error.message}`)
  process.exitCode = 1
})
