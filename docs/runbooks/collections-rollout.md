# Collections rollout runbook

## Purpose

Enable Collections gradually without coupling product rollout to deployment. Every production capability is protected by a server-side feature flag. A deploy may contain the code while every Collections flag remains off.

This runbook does not authorize a Render Blueprint adoption or service recreation. Deployment topology changes require a separately reviewed inventory of the existing Render services, IDs, domains and runtimes.

## Non-negotiable gates

Before the first production flag is enabled:

1. The candidate commit is immutable and identified by a 40-character Git SHA.
2. `npm run verify:full` passes against disposable `*-test` databases and the full local/staging stack.
3. CMS migrations run once under the existing migration lock and complete successfully.
4. `GET /ready` proves Mongo connectivity, the latest expected CMS migration and critical Collections indexes without running DDL.
5. `scripts/operations/cms-backup-restore-smoke.sh` passes against a `*-restore-test` destination.
6. Staging load, concurrency, crash/recovery, security and contract evidence is recorded.
7. The worker-checkpoint harness is executed for draft, publish, selection and export against the same candidate SHA and disposable CMS database.
8. `docs/evidence/collections-staging.json` is produced from real staging results for that exact commit.
9. `npm run verify:collections:acceptance -- --evidence docs/evidence/collections-staging.json --expected-commit <SHA>` passes all 20 normative criteria.
10. Worker heartbeat, queue age, error rate, Mongo health, FastAPI health and storage health are observable before traffic is enabled.

The evidence file is an output of staging qualification. Do not copy the test fixture into `docs/evidence` and do not mark a criterion as `pass` without an executed evidence reference.

## Required Admin/Worker configuration names

Admin Web and Admin Worker use the same CMS database and the same versioned retention policy. Secret values remain only in the Render/environment secret store; release evidence records names and non-secret numeric/boolean settings, never credentials or connection strings.

Required operational names for the production candidate include:

- `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME`, `PAYLOAD_SECRET`, `CMS_SERVICE_KEY`, `CMS_PUBLIC_SERVER_URL`, `CMS_COLLECTOR_ORIGINS`, `FASTAPI_BASE_URL`, `METRICS_KEY`;
- `CMS_JOB_RECOVERY_STALE_SECONDS=180`, `CMS_JOB_MAX_RECOVERIES=3`;
- `CMS_ORPHAN_STAGING_RETENTION_DAYS=30`, `CMS_ORPHAN_STAGING_BATCH_SIZE=500`;
- `CMS_OPERATION_ITEM_RETENTION_DAYS=90`, `CMS_OPERATION_ITEM_BATCH_SIZE=100`;
- `CMS_USED_SELECTION_RETENTION_DAYS=90`;
- `EXPORT_ARTIFACT_TTL_SECONDS=604800`, `CMS_EXPORT_PURGE_BATCH_SIZE=100`;
- `CMS_AUDIT_RETENTION_DAYS=365`, `CMS_AUDIT_ARCHIVE_BATCH_SIZE=1000`;
- private object storage names `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_EXPORT_PREFIX`, `S3_SIGNED_URL_TTL_SECONDS`.

Production must not silently shorten evidence-retention windows. Disposable staging may use shorter values only to exercise maintenance behavior and must record those values in staging evidence.

## Retention and archive invariants

Maintenance is deliberately conservative:

- export records do **not** use Mongo TTL. For expired completed/failed exports, the maintenance worker deletes the private object first and only then removes the CMS reference. A failed `DeleteObject` preserves the record for retry/operator visibility;
- terminal `collection_operation_items` older than 90 days are removed only after the parent operation stores deterministic status/reason counts plus a SHA-256 digest of the canonical item stream;
- orphan staged draft rows are removed only after 30 days and only when no nonterminal/resumable operation protects them;
- Admin `audit_events` do **not** use TTL. Events older than 365 days are written as deterministic private NDJSON-gzip, manifested with count/SHA/object key and only then removed from the hot collection;
- Collections, published versions, membership intervals, consumer applications and credentials never receive automatic retention TTLs.

The same private storage principal used for exports must have the documented prefix-scoped `DeleteObject` permission because object-first cleanup is now part of the production invariant. Audit archives are worker-only and do not receive a public/signed read endpoint.

## Crash/recovery evidence

The chaos harness never creates a replacement domain intent or a replacement Payload job. It proves recovery of the original pair.

For remote staging Mongo, the harness requires both a database name ending in `-test` and `CONCIERGE_ALLOW_REMOTE_CHAOS=1`. Before the destructive `arm` phase, stop the staging worker and set `CONCIERGE_CHAOS_WORKER_STOPPED=1` for the harness process only. Example flow:

```bash
# Read the real checkpoint first.
npm run chaos:worker-checkpoints -- --scenario publish --id "$PUBLISH_JOB_ID" --phase snapshot \
  --output evidence/publish-before.json

# After the worker is stopped, make that SAME Payload job provably stale/reclaimable.
CONCIERGE_CHAOS_WORKER_STOPPED=1 npm run chaos:worker-checkpoints -- \
  --scenario publish --id "$PUBLISH_JOB_ID" --phase arm --checkpoint validated \
  --output evidence/publish-armed.json

# Restart the worker, then prove the original intent converges exactly once.
npm run chaos:worker-checkpoints -- --scenario publish --id "$PUBLISH_JOB_ID" --phase verify \
  --output evidence/publish-recovered.json
```

Repeat with `draft`, `selection` and `export`. The harness emits machine-readable evidence only; Render service stop/start and real workload creation remain staging/Codex operations.

## Flag order

The versioned flag ownership/removal metadata is in `config/collections-feature-flags.json`. Staging and production fail closed when an override is absent.

Enable in this order, stopping after each step until health and invariants are verified:

1. `CMS_AUTH_ENABLED=true`
   - CMS session handoff and server-side introspection only.
   - Verify login, logout/session expiry and role downgrade.
2. `CATALOG_SCAN_ENABLED=true`
   - Enables the server-side catalog scan used by large Explorer selections.
   - Verify scans remain bounded and manifests are resumable.
3. `COLLECTIONS_ADMIN_ENABLED=true`
   - Enables Collections CRUD commands, Explorer/Bulk, publish and Operations Admin.
   - Keep Collector mutation and external distribution disabled.
4. `COLLECTOR_ASSOCIATION_READ_ENABLED=true`
   - Exposes published association reads in the Collector.
   - Verify this remains read-only for non-admin users.
5. `COLLECTOR_DRAFT_MUTATION_ENABLED=true`
   - Enables the single-Curation admin mutation from Collector cards.
   - Verify it enters the same operation queue/CAS path as Admin bulk actions.
6. `CONSUMER_CREDENTIALS_ENABLED=true`
   - Enables application/credential administration.
   - Issue only canary consumer credentials first.
7. `COLLECTIONS_DISTRIBUTION_ENABLED=true`
   - Enables consumer-facing Collection distribution last.
   - Verify allowlists, 401/404/410/429 behavior and live hydration before widening consumers.

Never enable a downstream flag while a prerequisite is unhealthy.

## Canary procedure

For each production flag:

1. Record candidate SHA, flag change, operator, timestamp and previous value.
2. Enable the flag for the smallest supported canary scope/environment.
3. Exercise the corresponding smoke path.
4. Observe at least:
   - worker heartbeat and queue age;
   - operation/publish failures and retries;
   - Mongo/FastAPI/storage errors;
   - selected/available/unavailable counts where applicable;
   - unexpected `409`, `412`, `423`, `5xx` or authorization failures.
5. If healthy, proceed to the next flag. If not, execute `docs/runbooks/collections-rollback.md` immediately.

## Collection-level kill switch

If one published Collection is bad while the platform is healthy, archive that Collection instead of disabling the whole platform. Archive is reversible and preserves version history. It must produce `410` on public current/exact/dump reads until restored.

## Data rules during rollout

- Never hard-delete a Collection that has ever been published.
- Never rewrite published membership intervals to repair a rollout issue.
- A historical restore produces a new draft for review; it does not silently move the published pointer.
- Forward data corrections use an explicit migration/command and audit event.
- Consumer credentials remain individually revocable; do not share a platform-wide consumer secret.
- Collections remain online-only in the Collector; no Collection data enters Dexie or the existing offline sync queue.

## Completion

Rollout is complete only when all enabled flags are recorded, canary credentials/users have been widened intentionally, maintenance/retention behavior has staging evidence, and the staging acceptance evidence for the deployed commit is retained with the release record.
