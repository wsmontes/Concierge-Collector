# Collections rollout runbook

## Purpose

Enable Collections gradually without coupling product rollout to deployment. Every production capability is protected by a server-side feature flag. A deploy may contain the code while every Collections flag remains off.

This runbook does not authorize Render Blueprint adoption, service recreation, GitHub Actions, or a domain redesign.

## Non-negotiable gates

Before the first production flag is enabled:

1. Candidate is identified by an immutable 40-character Git SHA.
2. Official Payload/OpenAPI generated artifacts are current.
3. `npm run verify` and `npm run verify:full` have fresh green evidence for that SHA against disposable safe databases/full stack.
4. CMS migrations are applied exactly once under the existing migration lock.
5. `GET /ready` proves Mongo connectivity, migration `20260904_016_operation_retention_quarantine` and exact critical index signatures without running DDL.
6. Backup/restore smoke passes against a separate `*-restore-test` namespace.
7. Maintenance failure/backoff/quarantine/archive behavior has staging evidence.
8. Worker checkpoint harness passes draft, publish, selection and export against the same original domain/Payload jobs.
9. Staging load, concurrency, security, contract and UI evidence is captured.
10. `docs/evidence/collections-staging.json` is real staging output for that SHA and `verify:collections:acceptance` reports 20/20.
11. Worker heartbeat, queue age, error rate, Mongo health, FastAPI health and storage health are observable before traffic is enabled.

The validator fixture under `tests/fixtures` is never release evidence.

## Required Admin/Worker configuration names

Admin Web and private Admin Worker use the same CMS database/storage boundary. Secret values remain only in the environment secret store; evidence records names and non-secret settings, never credentials or connection strings.

Required names/defaults include:

```text
CMS_MONGODB_URL
CMS_MONGODB_DB_NAME
PAYLOAD_SECRET
CMS_SERVICE_KEY
CMS_PUBLIC_SERVER_URL
CMS_COLLECTOR_ORIGINS
FASTAPI_BASE_URL
METRICS_KEY

CMS_JOB_RECOVERY_STALE_SECONDS=180
CMS_JOB_MAX_RECOVERIES=3
CMS_ORPHAN_STAGING_RETENTION_DAYS=30
CMS_ORPHAN_STAGING_BATCH_SIZE=500
CMS_OPERATION_ITEM_RETENTION_DAYS=90
CMS_OPERATION_ITEM_BATCH_SIZE=100
CMS_USED_SELECTION_RETENTION_DAYS=90
EXPORT_ARTIFACT_TTL_SECONDS=604800
CMS_EXPORT_PURGE_BATCH_SIZE=100
CMS_AUDIT_RETENTION_DAYS=365
CMS_AUDIT_ARCHIVE_BATCH_SIZE=1000

S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE
S3_EXPORT_PREFIX
S3_SIGNED_URL_TTL_SECONDS
```

Production must not silently shorten evidence-retention windows. Disposable staging may use shorter values only to exercise maintenance and must record them in evidence.

## Migration tail required by this release

```text
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
20260904_014_staging_retention_scan
20260904_015_export_cleanup_backoff
20260904_016_operation_retention_quarantine
```

Legacy `export_artifact_ttl` must be absent. Critical indexes include `export_expiry_status`, `export_cleanup_due`, `operation_retention_due`, `staging_retention_scan`, `audit_archive_scan` and unique `audit_archive_batch_unique`, plus the existing queue/lease/slug/heartbeat signatures required by `/ready`.

## Retention and archive invariants

Maintenance is conservative and bounded:

- export records do **not** use Mongo TTL. An expired complete/failed export with an object calls DeleteObject first and removes the CMS reference only after confirmed success;
- DeleteObject failure preserves the export reference and records only operational attempt/next-attempt timestamps. Exponential cleanup backoff keeps one permanently bad key from occupying every bounded batch; provider error text is not persisted;
- a backed-off export becomes eligible again only when `cleanupNextAttemptAt` is due;
- terminal `collection_operation_items` older than retention are removed only after the parent stores deterministic status/reason counts plus SHA-256 of the canonical item stream;
- `purgeStartedAt` is durable before deletion, so a retry never rehashes a partial subset; `itemsPurgedAt` is the completion marker;
- retention bookkeeping uses Mongoose `timestamps:false` so maintenance does not renew semantic operation age;
- a permanent intact-evidence contradiction is preserved and marked under `itemArchive.retentionBlocked*`. Quarantined operations leave later batches but remain available for investigation;
- transient cursor/Mongo/delete/CAS failures are not quarantined and remain retryable;
- orphan staged draft rows are removed only when old enough and no nonterminal/resumable operation protects them;
- Admin `audit_events` do **not** use TTL. Old events are deterministic private NDJSON-gzip, manifested with count/SHA/object key, then removed from the hot collection;
- an audit manifest/batch integrity mismatch deliberately blocks forward archival. Do not skip it to improve throughput; investigate the evidence chain;
- Collections, published versions, membership intervals, applications and credentials have no automatic retention TTLs.

The storage principal must have prefix-scoped DeleteObject permission because object-first cleanup is a production invariant. Audit archives are Worker-only and have no public/signed read endpoint.

## Recovery invariant

Payload job recovery is job-first, not domain-history-first. The reconciler scans bounded stuck `payload-jobs`, maps only known Collections worker task slugs and validates the linked domain state before reopening the same job.

- active/reclaimable domain + failed/stale-processing job → same job may reopen under CAS;
- terminal-success domain + stuck internal job → same job may reopen idempotently so Payload can finish/delete it;
- permanently failed/missing-domain job → classified once so it does not starve future recovery batches;
- active domain whose referenced Payload job is absent remains operator-visible corruption and is detected separately;
- recovery never manufactures a replacement domain intent or Payload job.

## Crash/recovery evidence

For remote staging Mongo, require a DB ending in `-test`, `CONCIERGE_ALLOW_REMOTE_CHAOS=1`, and for destructive arm `CONCIERGE_CHAOS_WORKER_STOPPED=1` after the Worker has actually been stopped.

Example:

```bash
npm run chaos:worker-checkpoints -- --scenario publish --id "$PUBLISH_JOB_ID" --phase snapshot \
  --output evidence/publish-before.json

CONCIERGE_ALLOW_REMOTE_CHAOS=1 CONCIERGE_CHAOS_WORKER_STOPPED=1 \
  npm run chaos:worker-checkpoints -- --scenario publish --id "$PUBLISH_JOB_ID" --phase arm \
  --checkpoint validated --output evidence/publish-armed.json

# restart Worker
CONCIERGE_ALLOW_REMOTE_CHAOS=1 \
  npm run chaos:worker-checkpoints -- --scenario publish --id "$PUBLISH_JOB_ID" --phase verify \
  --output evidence/publish-recovered.json
```

Repeat for `draft`, `selection` and `export`. A Payload job may be absent after successful convergence because `deleteJobOnComplete=true`; absence is acceptable only when domain success invariants prove completion.

## Flag order

Enable sequentially, stopping after each step until health/invariants are verified:

1. `CMS_AUTH_ENABLED=true`
2. `CATALOG_SCAN_ENABLED=true`
3. `COLLECTIONS_ADMIN_ENABLED=true`
4. `COLLECTOR_ASSOCIATION_READ_ENABLED=true`
5. `COLLECTOR_DRAFT_MUTATION_ENABLED=true`
6. `CONSUMER_CREDENTIALS_ENABLED=true`
7. `COLLECTIONS_DISTRIBUTION_ENABLED=true`

Never enable a downstream flag while a prerequisite is unhealthy.

## Canary procedure

For each production flag:

1. Record candidate SHA, flag change, operator, timestamp and previous value.
2. Enable the smallest supported canary.
3. Exercise that capability's smoke path.
4. Observe worker heartbeat/queue age, operation/publish failures/retries, Mongo/FastAPI/storage health, expected conflict rates and authorization failures.
5. Observe maintenance/recovery for retry storms or starvation.
6. If unhealthy, revert that flag and follow `docs/runbooks/collections-rollback.md`; do not advance.

## Collection-level kill switch

If one published Collection is bad while the platform is healthy, archive that Collection rather than disabling the platform. Archive is reversible, preserves history and returns `410` on public current/exact/dump reads until restored.

## Data rules during rollout

- Never hard-delete a Collection that has ever been published.
- Never rewrite published membership intervals to repair rollout.
- Historical restore creates a new draft; it does not silently move the published pointer.
- Forward data corrections use explicit migration/command + audit event.
- Consumer credentials remain individually revocable; do not share a platform-wide consumer secret.
- Collections remain online-only in Collector; no Collection data enters Dexie/offline sync.

## Completion boundary

Rollout is complete only from executed evidence for the exact deployed SHA: generated artifacts current, migrations/readiness verified, full gates green, staging acceptance 20/20, four chaos scenarios green, backup/restore green, maintenance/recovery stable, canary flags recorded and observation complete.
