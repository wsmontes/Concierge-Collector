# Collections production closeout — Codex integration and deployment gate

## Objective

This branch intentionally accumulates source changes, regression tests, migrations, specs and runbooks while deferring full local/runtime execution to Codex. Treat it as an integration candidate, **not** as a new design exercise.

Branch: `feat/collections-production-closeout-20260904`  
Baseline: `main` at `b545626a9829e8f449eab783df541a7ca61e4bce`

Do not merge or deploy to production until the exact candidate SHA has fresh local/full-stack/staging evidence for every required gate below.

## Architecture invariants to preserve while fixing runtime defects

- `Collection` remains a separate N:N aggregate. Never add Collection/rank/order ownership fields to Curation.
- Payload custom command endpoints remain the lifecycle/membership/publish writers; do not reopen generic Payload CRUD for Collections.
- FastAPI remains Entity/Curation/auth authority; Payload revalidates live admin authorization.
- Collector Collections remain online-only: no Dexie schema and no existing offline sync queue fallback.
- Published membership is interval/version based and historical versions remain immutable.
- Historical restore creates a draft; it never rewrites the current published pointer.
- Publish remains asynchronous, leased, fenced, idempotent and atomic at promotion.
- Bulk selections remain server-side manifests; the browser never expands all-matching into every Curation ID.
- Consumer secrets remain hash-only/show-once.
- Recovery must never manufacture a duplicate domain intent or replacement Payload job.
- Retention must never delete resumable staging or product-domain records.
- Export cleanup is object-first; Admin audit archival is artifact+manifest-first; operation-item purge is summary-first.
- Permanent export cleanup failures use bounded retry backoff instead of starving the batch.
- Permanent operation-retention evidence contradictions are quarantined but preserved, never silently deleted.
- Audit archive integrity mismatches deliberately block forward archival for operator investigation.
- No GitHub Actions or Render Blueprint adoption are required for this release.

## 1. Toolchain and clean install

```bash
node --version
npm --version
npm ci
```

Expected Node: `>=22.12 <23`; npm major 10.

Create/activate the existing Python venv and install the pinned API requirements before Python gates.

## 2. Generate official artifacts first

The branch changes Payload collections/fields/jobs and FastAPI contracts. Do not hand-edit generated outputs as the permanent fix.

Run:

```bash
npm run generate:types --workspace=@concierge/admin
npm run generate:importmap --workspace=@concierge/admin
npm run generate:contracts
npm run check:admin-generated
npm run check:contracts
```

Review and commit deterministic generated diffs before broader gates. `check:admin-generated` intentionally regenerates and compares Payload types while restoring the checkout before it exits; a stale result is a release-gate failure.

## 3. Targeted closeout tests before broad suites

### Root release/generated-artifact contracts

```bash
npm test -- --run \
  tests/test_adminGeneratedFreshness.test.js \
  tests/test_releaseGate.test.js
```

### FastAPI authorization audit

```bash
cd concierge-api-v3
venv/bin/pytest \
  tests/test_cms_authz_audit.py \
  tests/test_oauth_authz_boundary.py \
  -v
cd ..
```

Prove:

- manual grant/revoke/role changes append one idempotent event;
- OAuth allowlist promotion and first-login admin bootstrap append audit;
- no-op mutations append nothing;
- read-only CMS introspection appends nothing and valid admin + service key returns the expected success contract;
- no token/cookie/credential material is stored;
- audit failure compensates privilege mutation fail-closed;
- if audit commit succeeded but the response was lost, rereading `eventKey` prevents an incorrect rollback.

### Admin readiness, retention, recovery, archive and chaos contracts

```bash
npm run test --workspace=@concierge/admin -- \
  tests/unit/operations/schema-readiness.test.ts \
  tests/unit/observability/ready-route.test.ts \
  tests/unit/jobs/purge-expired-exports.test.ts \
  tests/unit/jobs/compact-operation-items.test.ts \
  tests/unit/jobs/operation-item-retention-age.test.ts \
  tests/unit/jobs/operation-item-retention-bounded.test.ts \
  tests/unit/jobs/operation-item-retention-integrity.test.ts \
  tests/unit/jobs/operation-item-retention-resilience.test.ts \
  tests/unit/jobs/archive-audit-events.test.ts \
  tests/unit/jobs/audit-archive-manifest-consistency.test.ts \
  tests/unit/jobs/reconcile-recovery.test.ts \
  tests/unit/jobs/reconcile-terminal-jobs.test.ts \
  tests/unit/jobs/reconcile-job-first-starvation.test.ts \
  tests/unit/jobs/purge-orphan-staging.test.ts \
  tests/unit/jobs/purge-orphan-staging-starvation.test.ts \
  tests/unit/jobs/export-task-terminal-expiry.test.ts \
  tests/unit/chaos/worker-checkpoints.test.ts \
  tests/unit/migrations/export-cleanup-retention.test.ts \
  tests/unit/migrations/staging-retention-scan.test.ts \
  tests/unit/migrations/export-cleanup-backoff.test.ts \
  tests/unit/migrations/operation-retention-quarantine.test.ts
```

If any listed path was renamed by an official generator/tooling step, update this runbook to the actual committed name rather than silently skipping the test.

Important expected behavior:

- `/ready` expects migration `20260904_016_operation_retention_quarantine` and exact critical index signatures; it performs no DDL.
- `export_artifact_ttl` is absent.
- expired export cleanup deletes private storage before the CMS record.
- DeleteObject failure preserves the reference and schedules bounded retry backoff via `cleanupNextAttemptAt`.
- `export_expired` returns terminal domain `failed` output to Payload; transient/unknown failures still throw for retry.
- operation detail is streamed in canonical order and summary/SHA persists before deletion.
- purge retries after `purgeStartedAt` never hash a partial subset.
- post-delete/pre-marker crash can finish `itemsPurgedAt` without changing the original digest.
- permanent evidence contradiction preserves detail and marks `retentionBlocked*` so later candidates are not starved.
- retention bookkeeping uses `{ timestamps: false }`.
- audit archival writes deterministic private gzip + manifest before source deletion.
- audit manifest mismatch is fail-safe and does not skip ahead.
- job recovery starts from stuck `payload-jobs`, validates the linked domain and reopens only the same original job.
- terminal-success domain + stuck Payload job converges idempotently; failed/missing-domain job is classified and removed from later recovery batches.
- missing active-domain job detection filters through lookup before limit.
- chaos guard refuses unsafe databases/remotes and never creates replacement intent/job.

## 4. Migration/index integration

Run Admin Mongo integration against a disposable CMS database ending in `-test`:

```bash
npm run test:integration --workspace=@concierge/admin -- \
  tests/integration/payload/collection-indexes.int.test.ts \
  tests/integration/payload/ready-route.int.test.ts \
  tests/integration/worker/export-expiry.int.test.ts
```

Then run the full Admin integration suite later through `verify:full`.

The closeout migration tail must be present in order:

```text
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
20260904_014_staging_retention_scan
20260904_015_export_cleanup_backoff
20260904_016_operation_retention_quarantine
```

Critical post-migration state includes:

- legacy `export_artifact_ttl` absent;
- `export_expiry_status` present;
- `export_cleanup_due` key order: `{ status: 1, cleanupNextAttemptAt: 1, expiresAt: 1, _id: 1 }`;
- `operation_retention_due` includes terminal status + `itemsPurgedAt` + `retentionBlockedAt` + age ordering expected by source;
- `staging_retention_scan` present;
- `audit_archive_scan` present;
- `audit_archive_batch_unique` unique;
- heartbeat TTL signature unchanged at seven days;
- no TTL on Collection/version/membership/application/credential product records.

## 5. Existing broad suites and static checks

Run the complete Admin suite and release checks:

```bash
npm run test:admin
npm run lint:admin
npm run typecheck:admin
npm run build:admin
npm run lint:collector
npm run build:collector:check
npm run check:admin-generated
npm run check:contracts
```

Then run the API unit/format/lint gates through the standard release gate rather than cherry-picking only Collections tests.

If generated Payload types fail freshness, regenerate via the official command and fix source/schema typing; do not weaken TypeScript or cast away the contract globally.

## 6. Local release gates

```bash
npm run verify
npm run verify:full
```

Safety requirements:

- CMS integration/E2E DB ends in `-test`.
- FastAPI Mongo integration DB ends in `-test`.
- E2E targets stay loopback unless `CONCIERGE_ALLOW_REMOTE_E2E=1` is explicitly set for a disposable remote stack.
- Do not weaken safety guards to get green output.

## 7. Real migration/readiness transition

Against disposable CMS Mongo:

1. capture `/ready` before closeout migrations; schema-related 503 is expected if the DB is behind;
2. run `npm run migrate:cms:locked` exactly once under the existing lock;
3. inspect `payload-migrations` for migrations 011–016;
4. inspect actual Mongo index signatures;
5. require `/ready` 200 only after migration 016 + all required signatures;
6. prove `/ready` did not create/repair anything itself.

## 8. Maintenance failure-injection gate

Use controlled old data.

### Export cleanup

- DeleteObject success → object first, CMS record second.
- DeleteObject failure → CMS record remains; `cleanupAttempts` increments and `cleanupNextAttemptAt` advances.
- A backed-off oldest export must not hide other due exports.
- After backoff expires and storage recovers, cleanup must converge.

### Operation-item retention

- Valid old terminal operation → deterministic summary first, detail second, purge marker last.
- Delete failure after `purgeStartedAt` → retry without rehashing a partial subset.
- Crash after rows disappear but before `itemsPurgedAt` → next run completes marker from durable archive.
- Intact successful detail with count contradiction → no delete; `retentionBlocked*` recorded.
- Existing archive digest/count contradiction before purge → no delete; `retentionBlocked*` recorded.
- Quarantined oldest operation must not starve later safe candidates.

### Admin audit archival

- upload failure → source remains;
- manifest persistence failure → source remains;
- existing matching manifest → crash recovery can delete the same source batch;
- mismatching existing manifest → preserve source and block forward archival for operator investigation;
- completion event is emitted after source deletion and is not included in the archived batch.

## 9. Full-stack lifecycle/E2E flows

### Collections Admin

1. `/admin/collections` loads active + archived Collections.
2. Create through UI; edit metadata with CAS; stale revision reloads rather than overwriting.
3. Independently paginate Members, Draft Changes, Versions and Activity.
4. Target Explorer from Collection detail; archived/publishing collections remain context but not mutation targets.
5. Publish preview reports selected/add/remove/available/unavailable and invalidates stale confirmation.
6. Publish reports success only after reread confirms promoted version + clean draft.
7. Restore historical version as draft; published pointer stays unchanged until a new publish.
8. Archive/restore stays reversible; published history is never hard-deleted.

### Explorer / bulk / Operations

1. All-matching remains server-side.
2. Multi-target parent/children retain actor scoping and sequence semantics.
3. Parent cancellation only cancels children before commit barrier.
4. Raw request hashes/idempotency internals never appear in Admin DTO/UI.
5. Recovery never creates duplicate operation or Payload job.

### Distribution / Collector

1. Applications grant publishable Collections by human title/slug; legacy archived allowlist entries remain removable but cannot be newly granted.
2. Credential issue/rotate/revoke remains show-once/hash-only.
3. Collector published association reads are authorized but draft mutation stays admin-only and online-only.
4. Single-Curation mutation uses the same queued/CAS path as Admin bulk operations.
5. Distribution verifies allowlist plus `401/404/410/429`, live hydration and bounded dump streaming.

## 10. Backup/restore smoke

With MongoDB Database Tools installed:

```bash
CMS_BACKUP_SOURCE_URL="$CMS_TEST_URL" \
CMS_BACKUP_SOURCE_DB=concierge-cms-test \
CMS_RESTORE_TEST_URL="$CMS_TEST_URL" \
CMS_RESTORE_TEST_DB=concierge-cms-restore-test \
bash scripts/operations/cms-backup-restore-smoke.sh
```

The script must refuse source=destination, destination not ending in `-restore-test`, and prod/production-like targets.

Inspect restored version hashes and operational evidence including:

- `audit_archive_manifests`;
- operation `itemArchive`, including purge/quarantine metadata where present;
- export cleanup attempt/backoff metadata where present.

## 11. Real staging worker crash/recovery evidence

The harness is `apps/admin/tests/chaos/worker-checkpoints.mjs`, exposed as:

```bash
npm run chaos:worker-checkpoints -- --help
```

For each real staging scenario (`draft`, `publish`, `selection`, `export`):

1. create a real in-flight domain intent on a CMS DB ending in `-test`;
2. capture `--phase snapshot`;
3. stop the staging Worker;
4. with `CONCIERGE_ALLOW_REMOTE_CHAOS=1` and `CONCIERGE_CHAOS_WORKER_STOPPED=1`, arm the **same** domain/Payload job at the observed checkpoint;
5. restart Worker;
6. run `--phase verify` and retain its JSON evidence.

Verify exactly one original domain intent and scenario-specific success:

- draft: successful terminal status and draft revision >= intended target;
- publish: currentPublishedVersion equals intended target and matching immutable version record exists;
- selection: `ready`, scanComplete and manifestHash;
- export: `complete` with private key + SHA.

Because `deleteJobOnComplete=true`, an internal Payload job may be absent after successful convergence. Absence is acceptable only when the domain success invariant proves completion; a still-present job must not remain stuck/erroring.

Never create a new job to make the recovery scenario pass.

## 12. Staging acceptance

Follow `docs/superpowers/plans/2026-09-03-collections-gate-and-staging.md` and collect real load/concurrency/security/UI/chaos/backup/storage evidence for the exact SHA.

Create real staging evidence at:

`docs/evidence/collections-staging.json`

Then run:

```bash
npm run verify:collections:acceptance -- \
  --evidence docs/evidence/collections-staging.json \
  --expected-commit "$(git rev-parse HEAD)"
```

The fixture under `tests/fixtures` is validator-only and is never release evidence.

## 13. Final static review after green runtime gates

Review specifically for:

- generic Payload mutation accidentally opened;
- Curation accidentally owning Collection membership/rank/order;
- browser expansion of large selections;
- missing actor scoping on operations/exports;
- unsafe recovery CAS or any scan where ineligible old rows are limited before filtering;
- product TTLs;
- export CMS deletion before confirmed object deletion;
- export cleanup retry starvation;
- audit deletion before archive manifest persistence;
- audit archive mismatch being skipped instead of surfaced;
- operation detail deletion before summary persistence;
- operation retention retry/quarantine starvation;
- retention writes accidentally renewing semantic `updatedAt`;
- secrets/request hashes/signed URLs leaking into logs/UI/evidence;
- stale generated Payload output;
- endpoint bypassing feature flags;
- OAuth/admin authorization mutation without append-only audit;
- Places-service deferment accidentally interpreted as a Collections release blocker.

## 14. Definition of done before merge/deployment

The Codex pass is complete only when fresh evidence proves:

1. official generated artifacts are current;
2. targeted closeout tests pass;
3. `npm run verify` passes;
4. `npm run verify:full` passes against disposable full stack;
5. migrations 011–016 and exact readiness/index signatures pass;
6. maintenance failure/backoff/quarantine cases pass;
7. UI lifecycle E2E passes;
8. backup/restore smoke passes;
9. four real staging worker chaos scenarios pass;
10. load/concurrency/security/storage qualification passes;
11. staging acceptance is 20/20 for the exact candidate SHA;
12. final diff contains no unrelated changes;
13. only then is the SHA eligible for the production procedure in `docs/superpowers/plans/2026-09-03-render-collections-production.md` and eventual merge to `main`.

This runbook never authorizes production based on source inspection alone.
