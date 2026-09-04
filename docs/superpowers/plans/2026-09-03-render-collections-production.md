# Render Collections Production Implementation Plan

> **Execution rule:** production deployment remains deferred until Codex has produced fresh 20/20 staging evidence for the exact candidate SHA. This plan is the deployment handoff, not authorization to deploy from ChatGPT.

**Goal:** Provision/qualify production Admin and Worker services in Render, then release Collections through observable canaries.

**Architecture:** A public Admin Web service and private background Worker share the production CMS database/storage boundary. FastAPI remains the operational Entity/Curation/auth authority. Server-side flags keep every Collections capability fail-closed until its canary is healthy. Private S3-compatible storage is used for export artifacts and worker-only Admin audit archives.

## Global constraints

- Start only after staging evidence reports 20/20 for the exact candidate SHA.
- Use exact origins; never add a CORS wildcard or arbitrary origin reflection.
- Never print or commit secret/Mongo/service-key/S3/DNS credentials.
- Keep consumer credentials and public distribution disabled until their final canaries.
- On an unhealthy canary, revert that flag first and follow `docs/runbooks/collections-rollback.md`.
- Do not introduce Render Blueprint adoption or GitHub Actions during this rollout.
- Web/worker never run migrations at boot. Migrations run once through the locked release command.
- Production evidence-retention windows must not be silently shortened below the versioned defaults.
- Recovery never creates replacement domain intents/jobs.

## Task 1 — Verify exact qualified SHA and generated artifacts

Before touching production, validate the release evidence against the candidate commit:

```bash
QUALIFIED_SHA=$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('docs/evidence/collections-staging.json', 'utf8')).commitSha)")
npm run verify:collections:acceptance -- --evidence docs/evidence/collections-staging.json --expected-commit "$QUALIFIED_SHA"
npm run check:admin-generated
npm run check:contracts
```

Only the exact staging-qualified SHA may continue.

## Task 2 — Create/verify Admin Web and private Worker

Use the existing Git-backed deployment approach and `Dockerfile.admin`. Do not create a Blueprint.

Configure protected values for:

```text
CMS_MONGODB_URL
CMS_MONGODB_DB_NAME
PAYLOAD_SECRET
CMS_SERVICE_KEY
CMS_PUBLIC_SERVER_URL=https://admin.concierge-collector.com
CMS_COLLECTOR_ORIGINS=https://concierge-collector.com
FASTAPI_BASE_URL=https://api.concierge-collector.com
METRICS_KEY
S3_ENDPOINT
S3_REGION
S3_BUCKET
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE
S3_EXPORT_PREFIX
S3_SIGNED_URL_TTL_SECONDS
```

The Worker uses the same production CMS/storage settings and command `npm run start:admin-worker`; it has no public domain.

Versioned operational defaults:

```text
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
```

Set every Collections feature flag explicitly `false` before the initial production deploy.

`/health` should be available; `/ready` may legitimately remain 503 before schema migration and must not be bypassed.

Record only non-secret service/deploy IDs, SHA, hostname, flag values, timestamps and non-secret retention settings.

## Task 3 — Configure DNS and authentication boundaries

- Attach `admin.concierge-collector.com` only to Admin Web and wait for verified TLS.
- Configure FastAPI with exact `CMS_ADMIN_ORIGIN=https://admin.concierge-collector.com` and `CMS_ADMIN_CALLBACK_URL=https://admin.concierge-collector.com/auth/callback`, preserving existing allowed origins.
- Verify health, one-shot CMS handoff, callback, logout/session expiry and immediate role downgrade.
- Verify no arbitrary callback origin, token query parameter, public Worker domain or widened cookie scope.
- Smoke manual/OAuth authorization changes and verify the append-only `user_authz_audit_events` path before enabling Admin traffic.

## Task 4 — Backup, migrate once, and require schema-aware readiness

Create a dated production backup and acquire the existing migration lock. Run:

```bash
npm run migrate:cms:locked
```

Verify the complete closeout migration tail:

```text
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
20260904_014_staging_retention_scan
20260904_015_export_cleanup_backoff
20260904_016_operation_retention_quarantine
```

Verify post-migration index state includes:

- `export_artifact_ttl` absent;
- `export_expiry_status`;
- `export_cleanup_due` with exact key order expected by source;
- `operation_retention_due` with quarantine-aware key order;
- `staging_retention_scan`;
- `audit_archive_scan`;
- unique `audit_archive_batch_unique`;
- seven-day heartbeat TTL signature unchanged;
- no product-domain TTLs.

`GET /ready` is a release blocker unless it returns 200 after migration 016 and every required critical index signature is present. Never repair schema from readiness.

## Task 5 — Production restore/maintenance smoke with flags still off

Run `scripts/operations/cms-backup-restore-smoke.sh` against a separate `*-restore-test` destination.

Then use controlled production-safe/canary data to verify maintenance boundaries without destructive broad tests:

- export DeleteObject precedes CMS reference deletion;
- storage failure preserves export reference and schedules cleanup backoff;
- operation summary exists before detail purge;
- retention metadata does not renew semantic operation age;
- quarantined inconsistent operation detail remains preserved;
- audit object + manifest exist before hot source deletion;
- audit manifest integrity mismatch does not skip forward;
- Collections/versions/memberships/applications/credentials remain free of automatic TTL.

Record Mongo/API/storage health, Admin readiness, worker heartbeat age, queue age, operation failure/recovery counts and maintenance summaries.

## Task 6 — Release feature flags sequentially by canary

Use `config/collections-feature-flags.json`, `docs/runbooks/collections-rollout.md` and `docs/runbooks/collections-rollback.md`.

Enable one at a time:

1. `CMS_AUTH_ENABLED=true`
   - handoff, logout/session expiry, role downgrade, authz mutation-audit smoke.
2. `CATALOG_SCAN_ENABLED=true`
   - bounded/resumable Explorer scan.
3. `COLLECTIONS_ADMIN_ENABLED=true`
   - create/edit/bulk/publish/history/operations canary.
4. `COLLECTOR_ASSOCIATION_READ_ENABLED=true`
   - published reverse-association reads only.
5. `COLLECTOR_DRAFT_MUTATION_ENABLED=true`
   - single-Curation mutation through the same operation/CAS path.
6. `CONSUMER_CREDENTIALS_ENABLED=true`
   - one narrow revocable credential, show-once/hash-only.
7. `COLLECTIONS_DISTRIBUTION_ENABLED=true`
   - allowlist + `401/404/410/429` + live hydration.

After every flag, observe worker heartbeat/queue age, Mongo/FastAPI/storage health, operation/publish retries, expected conflict rates and authorization failures. Revert that flag immediately on invariant/health failure and do not advance until the incident is closed.

## Task 7 — Recovery/maintenance observation after canary traffic

Confirm production traffic does not reveal new starvation or retry loops:

- stuck Payload recovery starts from actual stuck jobs, not old healthy domain history;
- no recovery manufactures a new domain intent/job;
- post-domain-success stuck Payload jobs converge idempotently;
- permanently failed/missing-domain jobs do not occupy recovery batches forever;
- bad export cleanup keys respect bounded backoff and do not block other due exports;
- operation retention contradictions remain preserved/quarantined and do not block safe candidates;
- audit archive integrity incidents remain visible and block forward archival until investigated.

Any violation is a rollout stop condition.

## Task 8 — Finalize production evidence and merge eligibility

Record:

- exact qualified SHA;
- production deploy/service IDs;
- migration 011–016 evidence;
- `/ready` result and index inspection;
- enabled flags and canary timestamps/operators;
- authz audit smoke evidence;
- maintenance/recovery observations;
- backup/restore reference;
- rollback references if any.

Production success is not inferred from compile or staging alone. Only after canaries remain healthy and release evidence is complete is the exact SHA eligible for eventual merge to `main` under the repository's normal branch discipline.
