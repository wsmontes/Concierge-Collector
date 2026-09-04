#!/usr/bin/env node

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MongoClient, ObjectId } from 'mongodb'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_POLL_MS = 1_000
const DEFAULT_STALE_SECONDS = 300

const SCENARIOS = Object.freeze({
  draft: {
    domainCollection: 'collection_operations',
    jobField: 'jobId',
    successStatuses: ['committed', 'completed', 'completed_with_skips'],
    terminalStatuses: [
      'committed', 'completed', 'completed_with_skips', 'failed', 'cancelled',
      'stale', 'conflicted', 'authorization_revoked',
    ],
    duplicateFields: ['collectionId', 'idempotencyKey'],
  },
  publish: {
    domainCollection: 'collection_publish_jobs',
    jobField: 'payloadJobId',
    successStatuses: ['completed'],
    terminalStatuses: ['completed', 'failed', 'cancelled', 'stale', 'conflicted', 'authorization_revoked'],
    duplicateFields: ['collectionId', 'idempotencyKey'],
  },
  selection: {
    domainCollection: 'selection_manifests',
    jobField: 'payloadJobId',
    successStatuses: ['ready'],
    terminalStatuses: ['ready', 'failed', 'expired'],
    duplicateFields: ['actorId', 'idempotencyKey'],
  },
  export: {
    domainCollection: 'collection_exports',
    jobField: 'payloadJobId',
    successStatuses: ['complete'],
    terminalStatuses: ['complete', 'failed'],
    duplicateFields: ['actorId', 'idempotencyKey'],
  },
})

function hostsFromMongoUrl(mongoUrl) {
  const withoutScheme = mongoUrl.replace(/^mongodb(?:\+srv)?:\/\//i, '')
  const authority = withoutScheme.split('/')[0] ?? ''
  const hostList = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  return hostList.split(',').map((entry) => {
    const value = entry.trim()
    if (value.startsWith('[')) return value.slice(1, value.indexOf(']'))
    return value.split(':')[0]
  }).filter(Boolean)
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

export function assertDisposableChaosTarget({ mongoUrl, databaseName, allowRemote }) {
  if (!mongoUrl) throw new Error('CMS_MONGODB_URL is required')
  if (!databaseName) throw new Error('CMS_MONGODB_DB_NAME is required')
  if (!databaseName.endsWith('-test')) throw new Error('CMS chaos database must end with -test')
  if (/prod(?:uction)?/i.test(databaseName)) throw new Error('Refusing production-like CMS chaos database name')

  const hosts = hostsFromMongoUrl(mongoUrl)
  const remote = mongoUrl.startsWith('mongodb+srv://') || hosts.some((host) => !isLoopbackHost(host))
  if (remote && !allowRemote) {
    throw new Error('Remote chaos requires CONCIERGE_ALLOW_REMOTE_CHAOS=1')
  }
}

export function scenarioDefinition(name) {
  const definition = SCENARIOS[name]
  if (!definition) throw new Error(`Unsupported scenario: ${name}`)
  return definition
}

function safeId(value) {
  return value == null ? null : String(value)
}

function candidateIds(value) {
  const ids = [value]
  if (typeof value === 'string' && ObjectId.isValid(value)) ids.push(new ObjectId(value))
  return ids
}

function observedCheckpoint(domain) {
  if (typeof domain?.checkpoint === 'string' && domain.checkpoint) return domain.checkpoint
  if (domain?.status === 'materializing' && domain?.checkpointCursor) return 'materializing:checkpointed'
  return typeof domain?.status === 'string' ? domain.status : null
}

function payloadJobHealthy(job) {
  if (!job) return false
  if (job.processing === true && !job.completedAt) return false
  return job.hasError !== true
}

function expectedInvariantFor(scenario, domain) {
  if (scenario === 'publish') {
    return `same publish intent completes exactly once and promotes version ${Number(domain?.targetVersion ?? 0)}`
  }
  if (scenario === 'draft') {
    return 'same draft operation resumes without duplicate intent and preserves fenced/CAS draft semantics'
  }
  if (scenario === 'selection') {
    return 'same selection manifest resumes to ready with one manifest identity and a completed scan'
  }
  return 'same export intent resumes to one complete private artifact with persisted key and SHA-256'
}

export function evaluateRecoveredScenario(scenario, snapshot) {
  const definition = scenarioDefinition(scenario)
  const { domain, payloadJob, duplicateCount, related = {} } = snapshot
  const failures = []

  if (!domain) failures.push('domain_record_missing')
  if (domain && !definition.successStatuses.includes(String(domain.status))) failures.push('domain_not_success_terminal')
  if (duplicateCount !== 1) failures.push('duplicate_domain_intent')
  if (!payloadJobHealthy(payloadJob)) failures.push('payload_job_still_stuck_or_failed')

  if (scenario === 'draft' && domain?.status === 'committed' && Number.isFinite(Number(domain.targetDraftRevision))) {
    if (!related.collection || Number(related.collection.draftRevision) < Number(domain.targetDraftRevision)) {
      failures.push('draft_revision_not_advanced')
    }
  }

  if (scenario === 'publish' && domain) {
    if (!related.collection || Number(related.collection.currentPublishedVersion) !== Number(domain.targetVersion)) {
      failures.push('published_pointer_not_promoted')
    }
    if (!related.version || related.version.status !== 'published') failures.push('published_version_missing')
  }

  if (scenario === 'selection' && domain) {
    if (domain.scanComplete !== true) failures.push('selection_scan_incomplete')
    if (typeof domain.manifestHash !== 'string' || !domain.manifestHash) failures.push('selection_manifest_hash_missing')
  }

  if (scenario === 'export' && domain) {
    if (typeof domain.key !== 'string' || !domain.key || typeof domain.sha256 !== 'string' || !domain.sha256) {
      failures.push('export_artifact_missing')
    }
  }

  return {
    pass: failures.length === 0,
    expectedInvariant: expectedInvariantFor(scenario, domain),
    failures,
    observedState: {
      domainId: safeId(domain?._id),
      status: domain?.status ?? null,
      checkpoint: observedCheckpoint(domain),
      fencingToken: Number(domain?.fencingToken ?? 0),
      payloadJobId: safeId(payloadJob?._id),
      payloadProcessing: payloadJob?.processing === true,
      payloadHasError: payloadJob?.hasError === true,
      duplicateCount,
      ...(scenario === 'publish' ? {
        targetVersion: Number(domain?.targetVersion ?? 0),
        currentPublishedVersion: related.collection?.currentPublishedVersion ?? null,
        versionStatus: related.version?.status ?? null,
      } : {}),
      ...(scenario === 'draft' ? {
        targetDraftRevision: domain?.targetDraftRevision ?? null,
        collectionDraftRevision: related.collection?.draftRevision ?? null,
      } : {}),
      ...(scenario === 'selection' ? {
        scanComplete: domain?.scanComplete === true,
        capturedCount: Number(domain?.capturedCount ?? 0),
        skippedCount: Number(domain?.skippedCount ?? 0),
      } : {}),
      ...(scenario === 'export' ? {
        artifactKeyPresent: typeof domain?.key === 'string' && Boolean(domain.key),
        artifactShaPresent: typeof domain?.sha256 === 'string' && Boolean(domain.sha256),
      } : {}),
    },
  }
}

function parseArgs(argv) {
  const result = {
    phase: 'snapshot', scenario: null, id: null, checkpoint: null, output: null,
    timeoutMs: DEFAULT_TIMEOUT_MS, pollMs: DEFAULT_POLL_MS, staleSeconds: DEFAULT_STALE_SECONDS,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    const next = () => {
      index += 1
      if (index >= argv.length) throw new Error(`Missing value for ${value}`)
      return argv[index]
    }
    if (value === '--phase') result.phase = next()
    else if (value === '--scenario') result.scenario = next()
    else if (value === '--id') result.id = next()
    else if (value === '--checkpoint') result.checkpoint = next()
    else if (value === '--output') result.output = next()
    else if (value === '--timeout-ms') result.timeoutMs = Number(next())
    else if (value === '--poll-ms') result.pollMs = Number(next())
    else if (value === '--stale-seconds') result.staleSeconds = Number(next())
    else if (value === '--help' || value === '-h') result.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return result
}

function usage() {
  return `Usage:
  node apps/admin/tests/chaos/worker-checkpoints.mjs --scenario <draft|publish|selection|export> --id <domain-id> [options]

Phases:
  --phase snapshot   Read current domain/job state only (default).
  --phase arm        With the staging worker stopped, expire the domain lease and mark the SAME Payload job as stale-processing.
  --phase verify     Poll after worker restart until the original intent reaches its success invariant or timeout.

Safety environment:
  CMS_MONGODB_URL                 required
  CMS_MONGODB_DB_NAME             required and must end in -test
  CONCIERGE_ALLOW_REMOTE_CHAOS=1  required for Atlas/other remote Mongo
  CONCIERGE_CHAOS_WORKER_STOPPED=1 required for --phase arm

Options:
  --checkpoint <name>  Require the current domain checkpoint/status before arming.
  --output <path>      Write the same machine-readable JSON evidence printed to stdout.
  --timeout-ms <n>     Verify timeout (default ${DEFAULT_TIMEOUT_MS}).
  --poll-ms <n>        Verify poll interval (default ${DEFAULT_POLL_MS}).
  --stale-seconds <n>  Age injected into Payload job (default ${DEFAULT_STALE_SECONDS}).
`
}

async function findById(collection, id) {
  return collection.findOne({ _id: { $in: candidateIds(id) } })
}

async function duplicateCount(db, definition, domain) {
  if (!domain) return 0
  const filter = {}
  for (const field of definition.duplicateFields) {
    if (domain[field] == null) return 0
    filter[field] = domain[field]
  }
  return db.collection(definition.domainCollection).countDocuments(filter)
}

async function relatedState(db, scenario, domain) {
  if (!domain) return {}
  if (scenario === 'draft') {
    return { collection: await findById(db.collection('collections'), String(domain.collectionId)) }
  }
  if (scenario === 'publish') {
    return {
      collection: await findById(db.collection('collections'), String(domain.collectionId)),
      version: await db.collection('collection_versions').findOne({
        collectionId: String(domain.collectionId), version: Number(domain.targetVersion),
      }),
    }
  }
  return {}
}

async function readSnapshot(db, scenario, id) {
  const definition = scenarioDefinition(scenario)
  const domain = await findById(db.collection(definition.domainCollection), id)
  const payloadJobId = domain?.[definition.jobField]
  const payloadJob = payloadJobId == null
    ? null
    : await findById(db.collection('payload_jobs'), String(payloadJobId))
  return {
    domain,
    payloadJob,
    duplicateCount: await duplicateCount(db, definition, domain),
    related: await relatedState(db, scenario, domain),
  }
}

function safeSnapshot(scenario, snapshot) {
  const definition = scenarioDefinition(scenario)
  const { domain, payloadJob } = snapshot
  return {
    domainId: safeId(domain?._id),
    status: domain?.status ?? null,
    checkpoint: observedCheckpoint(domain),
    fencingToken: Number(domain?.fencingToken ?? 0),
    payloadJobId: safeId(payloadJob?._id),
    payloadProcessing: payloadJob?.processing === true,
    payloadHasError: payloadJob?.hasError === true,
    payloadCompleted: Boolean(payloadJob?.completedAt),
    duplicateCount: snapshot.duplicateCount,
    successTerminal: domain ? definition.successStatuses.includes(String(domain.status)) : false,
  }
}

async function armStalePayloadJob(db, scenario, id, checkpoint, staleSeconds) {
  if (process.env.CONCIERGE_CHAOS_WORKER_STOPPED !== '1') {
    throw new Error('--phase arm requires CONCIERGE_CHAOS_WORKER_STOPPED=1 after the staging worker is stopped')
  }
  const definition = scenarioDefinition(scenario)
  const snapshot = await readSnapshot(db, scenario, id)
  const { domain, payloadJob } = snapshot
  if (!domain) throw new Error(`Domain record not found: ${id}`)
  if (!payloadJob) throw new Error(`Payload job missing for ${scenario} ${id}`)
  if (definition.terminalStatuses.includes(String(domain.status))) throw new Error(`Cannot arm terminal ${scenario} status ${domain.status}`)
  const currentCheckpoint = observedCheckpoint(domain)
  if (checkpoint && currentCheckpoint !== checkpoint && domain.status !== checkpoint) {
    throw new Error(`Checkpoint mismatch: expected ${checkpoint}, observed ${currentCheckpoint}`)
  }
  if (payloadJob.completedAt) throw new Error('Cannot arm an already completed Payload job')

  const now = new Date()
  const staleAt = new Date(now.getTime() - staleSeconds * 1_000)
  const leaseExpiredAt = new Date(now.getTime() - 1_000)
  const domainResult = await db.collection(definition.domainCollection).updateOne(
    { _id: domain._id, status: domain.status },
    { $set: { leaseExpiresAt: leaseExpiredAt, updatedAt: staleAt } },
  )
  if (domainResult.matchedCount !== 1) throw new Error('Domain record changed while arming chaos checkpoint')

  const meta = payloadJob.meta && typeof payloadJob.meta === 'object' && !Array.isArray(payloadJob.meta)
    ? payloadJob.meta
    : {}
  const jobResult = await db.collection('payload_jobs').updateOne(
    { _id: payloadJob._id, completedAt: payloadJob.completedAt ?? null },
    {
      $set: {
        processing: true,
        hasError: false,
        error: null,
        completedAt: null,
        waitUntil: staleAt,
        updatedAt: staleAt,
        meta: {
          ...meta,
          chaosScenario: scenario,
          chaosDomainId: safeId(domain._id),
          chaosCheckpoint: currentCheckpoint,
          chaosArmedAt: now.toISOString(),
        },
      },
    },
  )
  if (jobResult.matchedCount !== 1) throw new Error('Payload job changed while arming chaos checkpoint')

  return readSnapshot(db, scenario, id)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function verifyUntil(db, scenario, id, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs
  let latest = await readSnapshot(db, scenario, id)
  let result = evaluateRecoveredScenario(scenario, latest)
  while (!result.pass && Date.now() < deadline) {
    await sleep(pollMs)
    latest = await readSnapshot(db, scenario, id)
    result = evaluateRecoveredScenario(scenario, latest)
    const domainStatus = String(latest.domain?.status ?? '')
    const definition = scenarioDefinition(scenario)
    if (definition.terminalStatuses.includes(domainStatus) && !definition.successStatuses.includes(domainStatus)) break
  }
  return { snapshot: latest, result }
}

async function emitEvidence(value, output) {
  const text = `${JSON.stringify(value, null, 2)}\n`
  if (output) await writeFile(resolve(output), text, { encoding: 'utf8', mode: 0o600 })
  process.stdout.write(text)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    process.stdout.write(usage())
    return
  }
  if (!args.scenario || !args.id) throw new Error('--scenario and --id are required')
  if (!['snapshot', 'arm', 'verify'].includes(args.phase)) throw new Error(`Unsupported phase: ${args.phase}`)
  scenarioDefinition(args.scenario)

  const mongoUrl = process.env.CMS_MONGODB_URL?.trim() ?? ''
  const databaseName = process.env.CMS_MONGODB_DB_NAME?.trim() ?? ''
  assertDisposableChaosTarget({
    mongoUrl,
    databaseName,
    allowRemote: process.env.CONCIERGE_ALLOW_REMOTE_CHAOS === '1',
  })

  const client = new MongoClient(mongoUrl, { appName: 'concierge-worker-chaos-evidence' })
  await client.connect()
  try {
    const db = client.db(databaseName)
    let snapshot
    let result
    if (args.phase === 'arm') {
      snapshot = await armStalePayloadJob(db, args.scenario, args.id, args.checkpoint, args.staleSeconds)
      result = {
        pass: true,
        expectedInvariant: 'the same Payload job is reclaimable after worker restart; no new domain intent is manufactured',
        failures: [],
        observedState: safeSnapshot(args.scenario, snapshot),
      }
    } else if (args.phase === 'verify') {
      const verified = await verifyUntil(db, args.scenario, args.id, args.timeoutMs, args.pollMs)
      snapshot = verified.snapshot
      result = verified.result
    } else {
      snapshot = await readSnapshot(db, args.scenario, args.id)
      result = {
        pass: Boolean(snapshot.domain && snapshot.payloadJob),
        expectedInvariant: expectedInvariantFor(args.scenario, snapshot.domain),
        failures: [
          ...(!snapshot.domain ? ['domain_record_missing'] : []),
          ...(!snapshot.payloadJob ? ['payload_job_missing'] : []),
        ],
        observedState: safeSnapshot(args.scenario, snapshot),
      }
    }

    const evidence = {
      evidenceType: 'collections.worker.checkpoint',
      generatedAt: new Date().toISOString(),
      environment: process.env.CONCIERGE_CHAOS_ENVIRONMENT?.trim() || 'staging',
      databaseName,
      scenario: args.scenario,
      phase: args.phase,
      requestedCheckpoint: args.checkpoint,
      domainId: args.id,
      pass: result.pass,
      expectedInvariant: result.expectedInvariant,
      failures: result.failures,
      observedState: result.observedState,
    }
    await emitEvidence(evidence, args.output)
    if (!evidence.pass) process.exitCode = 1
  } finally {
    await client.close()
  }
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  main().catch((error) => {
    process.stderr.write(`worker-checkpoints: ${error instanceof Error ? error.message : 'failed'}\n`)
    process.exitCode = 1
  })
}
