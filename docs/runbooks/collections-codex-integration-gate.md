# Collections production closeout — Codex integration and deployment gate

## Objective

Qualify the exact source candidate produced on `feat/collections-production-closeout-20260904`. This is an integration/runtime pass, **not** a design pass.

Baseline: `main` at `b545626a9829e8f449eab783df541a7ca61e4bce`.

Do not merge or deploy until every required gate is freshly green for the exact candidate SHA.

## Architecture invariants

- Collection↔Curation stays N:N; Curation never owns Collection membership/rank/order.
- Payload custom commands own Collection lifecycle/membership/publish; generic Payload mutation stays closed.
- FastAPI remains Entity/Curation/auth authority.
- Collector Collections stay online-only; no Dexie/offline queue is added.
- Published membership/history remain immutable/versioned; historical restore creates a draft.
- Publish stays asynchronous, leased, fenced, idempotent and atomic.
- Server-side selections remain bounded; browser never expands all-matching to every ID.
- Consumer secrets stay show-once/hash-only.
- Recovery never manufactures replacement domain intents or Payload jobs.
- Export cleanup is object-first; operation detail is summary-first; Admin audit archival is artifact+manifest-first.
- Export cleanup backoff and operation-retention quarantine must prevent maintenance starvation without deleting evidence.
- Audit archive integrity mismatch deliberately blocks forward archival.
- No GitHub Actions or Render Blueprint adoption in this release.

## 1. Toolchain and clean install

```bash
node --version
npm --version
npm ci
```

Expected Node: `>=22.12 <23`; npm major 10. Activate/install the pinned FastAPI Python environment before Python gates.

## 2. Generate official artifacts first

```bash
npm run generate:types --workspace=@concierge/admin
npm run generate:importmap --workspace=@concierge/admin
npm run generate:contracts
npm run check:admin-generated
npm run check:contracts
```

Commit deterministic generated diffs. Do not hand-edit generated Payload unions/import maps or generated FastAPI client files as the permanent fix.

## 3. Targeted closeout regression tests

### Root/generated/release-gate contracts

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
  tests/test_cms_authz_audit_legacy.py \
  tests/test_oauth_authz_boundary.py \
  -v
cd ..
```

Required behavior:

- manual grant/revoke/role mutation writes one idempotent append-only event;
- OAuth promotion/bootstrap writes the same stream;
- read-only introspection writes no mutation event;
- audit failure compensates privilege mutation fail-closed;
- ambiguous post-commit network failure confirms `eventKey` before rollback;
- legacy users physically missing `authorized`/`role` still mutate through a raw-state CAS and are audited with logical defaults;
- no token/cookie/credential material is persisted.

### Admin readiness, maintenance, recovery and chaos

```bash
npm run test --workspace=@concierge/admin -- \
  tests/unit/operations/schema-readiness.test.ts \
  tests/unit/observability/ready-route.test.ts \
  tests/unit/jobs/purge-expired-exports.test.ts \
  tests/unit/jobs/compact-operation-items.test.ts \
  tests/unit/jobs/operation-item-retention-age.test.ts \
  tests/unit/jobs/operation-item-retention-bounded.test.ts \
  tests/unit/jobs/operation-item-retention-integrity.test.ts \
  tests/unit/jobs/operation-item-retention-quarantine.test.ts \
  tests/unit/jobs/operation-item-retention-resilience.test.ts \
  tests/unit/jobs/archive-audit-events.test.ts \
  tests/unit/jobs/audit-archive-manifest-consistency.test.ts \
  tests/unit/jobs/reconcile-recovery.test.ts \
  tests/unit/jobs/reconcile-terminal-jobs.test.ts \
  tests/unit/jobs/reconcile-job-first-starvation.test.ts \
  tests/unit/jobs/purge-orphan-staging.test.ts \
  tests/unit/jobs/purge-orphan-staging-starvation.test.ts \
  tests/unit/jobs/export-task-terminal-errors.test.ts \
  tests/unit/chaos/worker-checkpoints.test.ts \
  tests/unit/migrations/export-cleanup-retention.test.ts \
  tests/unit/migrations/staging-retention-scan.test.ts \
  tests/unit/migrations/maintenance-starvation-indexes.test.ts
```

Expected boundaries:

- `/ready` requires migration `20260904_016_operation_retention_quarantine` and exact critical index signatures; no DDL.
- legacy `export_artifact_ttl` is absent.
- export DeleteObject succeeds before CMS deletion; failure preserves reference and advances bounded cleanup backoff.
- exact `export_expired` is a terminal domain outcome; transient/unknown errors still retry.
- operation detail is streamed in canonical order and summary/SHA is durable before deletion.
- once `purgeStartedAt` exists, retry never rehashes a partial subset.
- invalid immutable archive evidence is quarantined **before any further destructive delete**.
- retention bookkeeping does not renew semantic `updatedAt`.
- audit archive object + manifest precede source deletion; manifest mismatch blocks forward archival.
- recovery starts from stuck `payload-jobs` and validates linked domain state.
- reopening a Payload 3.86 job physically `$unset`s `completedAt` and `waitUntil`; `completedAt:null` is not acceptable because the runner requires `exists:false`.
- no recovery path creates replacement domain/job.
- chaos harness refuses unsafe targets and only arms the same original job.

## 4. Migration/index integration

Run against disposable CMS Mongo ending in `-test`:

```bash
npm run test:integration --workspace=@concierge/admin -- \
  tests/integration/payload/collection-indexes.int.test.ts \
  tests/integration/payload/ready-route.int.test.ts \
  tests/integration/worker/export-expiry.int.test.ts
```

Then apply under the existing migration lock:

```bash
npm run migrate:cms:locked
```

The closeout migration tail must be present in order:

```text
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
20260904_014_staging_retention_scan
20260904_015_export_cleanup_backoff
20260904_016_operation_retention_quarantine
```

Verify actual Mongo signatures, including:

- `export_artifact_ttl` absent;
- `export_expiry_status`;
- `export_cleanup_due` = `{ status:1, cleanupNextAttemptAt:1, expiresAt:1, _id:1 }`;
- `operation_retention_due` includes status, `itemsPurgedAt`, `retentionBlockedAt`, `updatedAt`, `_id` in source-defined order;
- `staging_retention_scan`;
- `audit_archive_scan`;
- unique `audit_archive_batch_unique`;
- seven-day `worker_heartbeat_ttl` signature;
- no automatic TTL on Collections, published versions, memberships, applications or credentials.

Prove `/ready` is 503 while schema is behind and 200 only after migration 016 + every required signature. The endpoint itself must not mutate schema.

## 5. Broad local gates

```bash
npm run test:admin
npm run lint:admin
npm run typecheck:admin
npm run build:admin
npm run lint:collector
npm run build:collector:check
npm run check:admin-generated
npm run check:contracts
npm run verify
npm run verify:full
```

Use only safe `*-test` databases. Remote E2E requires explicit opt-in. Do not weaken database/origin safety guards to make a gate pass.

## 6. Maintenance failure injection

### Export cleanup

- successful DeleteObject → object first, CMS record second;
- DeleteObject failure → reference remains, attempts increment, next-attempt advances;
- a backed-off bad oldest record cannot hide other due exports;
- storage recovery after due time converges cleanup.

### Operation-item retention

- summary/count/SHA persist before detail deletion;
- delete failure after `purgeStartedAt` remains retryable without partial rehash;
- crash after rows disappear/before marker recovers `itemsPurgedAt` from durable archive;
- selected-count/detail contradiction preserves raw detail and quarantines;
- archive/detail contradiction preserves raw detail and quarantines;
- invalid `itemArchive.itemCount` after purge start is detected before any further delete;
- quarantined oldest operation does not starve later safe candidates.

### Admin audit archive

- upload failure preserves source;
- manifest persistence failure preserves source;
- matching pre-existing manifest permits crash recovery;
- mismatching manifest preserves source and blocks forward archival;
- completion event is outside the archived source batch and appears only after successful source deletion.

## 7. Backup/restore smoke

```bash
CMS_BACKUP_SOURCE_URL="$CMS_TEST_URL" \
CMS_BACKUP_SOURCE_DB=concierge-cms-test \
CMS_RESTORE_TEST_URL="$CMS_TEST_URL" \
CMS_RESTORE_TEST_DB=concierge-cms-restore-test \
bash scripts/operations/cms-backup-restore-smoke.sh
```

Inspect restored version hashes plus `audit_archive_manifests`, operation `itemArchive` purge/quarantine evidence and export cleanup backoff metadata. Safety guards must reject source=destination, production-like restore names and destinations not ending `-restore-test`.

## 8. Full-stack UI/domain flows

Exercise at minimum:

- Collection list/create/edit CAS/stale-revision handling;
- Members, Draft Changes, Versions and Activity pagination;
- Explorer context and all-matching server-side selection;
- multi-target parent/child operations and cancellation barrier;
- publish preview, stale confirmation invalidation and atomic promotion;
- historical restore creates draft without moving published pointer;
- archive/restore preserves history;
- Collector association reads remain published/read-only;
- single-Curation mutation uses the same queued/CAS path;
- application/credential issue/rotate/revoke stays show-once/hash-only;
- distribution verifies allowlist, `401/404/410/429`, live hydration and bounded dump streaming.

## 9. Real worker crash/recovery evidence

Use `apps/admin/tests/chaos/worker-checkpoints.mjs` for `draft`, `publish`, `selection`, `export`.

For each scenario:

1. create one real in-flight domain intent on staging CMS DB ending `-test`;
2. capture `--phase snapshot`;
3. stop Worker;
4. with remote/worker-stopped opt-ins, arm the **same** domain/Payload job;
5. restart Worker;
6. verify the original intent converges exactly once.

Success invariants:

- draft: successful terminal state + draft revision at least target;
- publish: current pointer equals intended version + immutable version exists;
- selection: `ready`, scan complete, manifestHash exists;
- export: `complete`, private key and SHA exist.

Because `deleteJobOnComplete=true`, the Payload job may be absent after successful convergence. Absence is valid only when the domain success invariant proves completion; a surviving job must not remain stuck/erroring.

Explicitly exercise the post-domain-success crash window: terminal-success domain + stale `processing:true`/completed internal job must recover by reopening the same job with completion fields physically unset.

## 10. Staging acceptance

Follow `docs/superpowers/plans/2026-09-03-collections-gate-and-staging.md`, create real evidence for the exact SHA at `docs/evidence/collections-staging.json`, then run:

```bash
npm run verify:collections:acceptance -- \
  --evidence docs/evidence/collections-staging.json \
  --expected-commit "$(git rev-parse HEAD)"
```

The fixture under `tests/fixtures` is validator-only. Release qualification requires 20/20 real staging criteria for the exact candidate SHA.

## 11. Final review and definition of done

After all runtime gates are green, inspect the final diff for:

- generic Payload writes accidentally opened;
- Collection ownership leaking into Curation;
- browser-side large-selection expansion;
- missing actor scoping;
- product TTLs;
- any cleanup/archive deletion before durable evidence boundary;
- maintenance/recovery starvation;
- recovered Payload jobs still carrying `completedAt`/blocking `waitUntil`;
- secrets, signed URLs or request hashes leaking into UI/log/evidence;
- stale generated artifacts;
- authz mutation without append-only audit;
- unrelated cleanup/drift.

Only after generated artifacts, targeted suites, `verify`, `verify:full`, migrations/readiness, failure injection, backup/restore, four chaos scenarios, load/security/UI qualification and exact-SHA 20/20 staging acceptance are green is the candidate eligible for `docs/superpowers/plans/2026-09-03-render-collections-production.md` and eventual merge to `main`.
