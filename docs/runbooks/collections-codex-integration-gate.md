# Collections production closeout — Codex integration and deployment gate

## Objective

This branch intentionally accumulates implementation, regression tests, specs and runbooks without spending local/runtime cycles in ChatGPT. Codex should treat it as an integration candidate, **not** as a new design exercise. Preserve the architecture and fix concrete compile/test/integration defects discovered by the gates below.

Branch: `feat/collections-production-closeout-20260904`
Baseline: `main` at `b545626a9829e8f449eab783df541a7ca61e4bce`

Do not merge to `main` until every required local/full-stack/staging gate below is freshly green for the exact candidate SHA.

## Architecture invariants to preserve while fixing

- `Collection` remains a separate N:N aggregate. Never add Collection/rank/order ownership fields to Curation.
- Payload custom command endpoints remain the lifecycle/membership/publish writers; do not re-enable generic Payload CRUD for Collections.
- FastAPI remains Entity/Curation/auth authority; Payload revalidates live admin authorization.
- Collector Collections remain online-only: no Dexie schema and no existing offline sync queue fallback.
- Published membership is interval/version based and historical versions remain immutable.
- Historical restore creates a draft; it does not rewrite the current published pointer.
- Publish remains asynchronous, leased, fenced, idempotent and atomic at promotion.
- Bulk selections remain server-side manifests; the browser never expands all-matching into every Curation ID.
- Consumer secrets remain hash-only/show-once.
- Recovery must never manufacture a duplicate domain intent or replacement Payload job.
- Retention must never delete resumable staging or product-domain records.
- Export cleanup is object-first; Admin audit archival is artifact+manifest-first; operation-item purge is summary-first.
- No GitHub Actions are required. The project intentionally uses local/Codex gates.
- Do not introduce Render Blueprint adoption during this release.

## 1. Toolchain and clean install

```bash
node --version
npm --version
npm ci
```

Expected Node: `>=22.12 <23`; npm major 10.

Also create/activate the existing Python venv and install the pinned API requirements before Python gates.

## 2. Generated artifacts first

The closeout adds a Payload collection, fields and scheduled tasks. Generated output may therefore be stale by design in the ChatGPT branch.

Run only the official generators:

```bash
npm run generate:types --workspace=@concierge/admin
npm run generate:importmap --workspace=@concierge/admin
npm run generate:contracts
npm run check:contracts
```

Commit deterministic generated changes. Do **not** hand-edit Payload generated type unions or import maps as the permanent fix.

## 3. Targeted closeout regression tests

Run these before broad suites so failures are easy to triage.

### FastAPI authorization audit

```bash
cd concierge-api-v3
venv/bin/pytest tests/test_cms_authz_audit.py -v
cd ..
```

Verify manual grant/revoke, OAuth allowlist promotion, first-login admin bootstrap, idempotency, no read-only introspection audit and versioned indexes.

### Admin readiness/retention/archive/chaos contracts

```bash
npm run test --workspace=@concierge/admin -- \
  tests/unit/operations/schema-readiness.test.ts \
  tests/unit/jobs/purge-expired-exports.test.ts \
  tests/unit/jobs/compact-operation-items.test.ts \
  tests/unit/jobs/archive-audit-events.test.ts \
  tests/unit/chaos/worker-checkpoints.test.js \
  tests/unit/jobs/reconcile-recovery.test.ts \
  tests/unit/jobs/purge-orphan-staging.test.ts
```

Important closeout expectations:

- `/ready` requires migration `20260904_013_audit_archival` plus critical indexes and performs no DDL.
- `export_artifact_ttl` is removed; expired exports delete private storage first.
- operation-item deletion can retry after summary persistence and can recover the purge marker after a post-delete crash.
- audit archival writes deterministic private gzip + manifest before source deletion.
- chaos target guard refuses non-`*-test` databases and remote Mongo without explicit opt-in.

### Migration/index integration

Run the Admin Mongo integration suite against a disposable CMS DB ending in `-test`, including:

```bash
npm run test:integration --workspace=@concierge/admin -- \
  tests/integration/payload/collection-indexes.int.test.ts \
  tests/integration/payload/ready-route.int.test.ts
```

Verify migrations 011–013 and index names from the production plan.

## 4. Existing convergence/unit suites

Run the complete Admin unit suite:

```bash
npm run test:admin
```

Then the root/Collector and API unit suites through the normal release gate rather than cherry-picking only Collections tests.

## 5. Static checks

```bash
npm run lint:admin
npm run typecheck:admin
npm run build:admin
npm run lint:collector
npm run build:collector:check
npm run check:contracts
```

If the closeout reveals a type error in new maintenance JSON fields, fix the source schema/types and regenerate; do not weaken TypeScript or cast away the domain contract globally.

## 6. Local release gates

```bash
npm run verify
npm run verify:full
```

Use disposable databases only:

- CMS DB name ends in `-test`.
- operational FastAPI Mongo DB name ends in `-test`.
- E2E URLs remain loopback unless `CONCIERGE_ALLOW_REMOTE_E2E=1` is deliberately set for a disposable remote stack.

Do not weaken test-database safety guards to make the gate pass.

## 7. Full-stack manual/E2E flows

### Collections Admin

1. `/admin/collections` loads active + archived Collections.
2. Create through UI, edit metadata with CAS and verify stale-revision reload.
3. Independently paginate Members, Draft Changes, Versions and Activity.
4. Target Explorer from Collection detail; archived/publishing collections remain context but not mutation targets.
5. Publish preview shows selected/add/remove/available/unavailable and invalidates stale confirmation.
6. Publish reports success only after reread confirms promoted version + clean draft.
7. Restore historical version as draft; published pointer stays unchanged until new publish.
8. Archive/restore remains reversible; published history is never hard-deleted.

### Explorer / bulk / Operations

1. All-matching stays server-side.
2. Multi-target parent/children retain actor scoping and sequence semantics.
3. Parent cancellation only cancels children before commit barrier.
4. Raw request hashes/idempotency internals never appear in Admin DTO/UI.
5. Recovery never creates a duplicate operation or Payload job.

### Distribution / Collector

1. Applications select publishable Collections by human title/slug; legacy archived allowlist entries remain removable but cannot be newly granted.
2. Credential issue/rotate/revoke remains show-once/hash-only.
3. Collector published association reads are visible to authorized reader roles but draft mutation remains admin-only and online-only.
4. Single-Curation mutation uses the same queued/CAS path as Admin bulk operations.
5. Distribution verifies allowlist plus `401/404/410/429`, live hydration and bounded dump streaming.

## 8. Closeout migration and maintenance gate

Against a disposable CMS database:

```bash
npm run migrate:cms:locked
```

Verify migration records include:

```text
20260902_009_operational_retention
20260902_010_selection_retention
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
```

Then verify:

- `export_artifact_ttl` absent;
- `export_expiry_status`, `operation_retention_scan`, `audit_archive_scan`, `audit_archive_batch_unique` present;
- `/ready` returns 200 only after these are installed;
- no product Collection/version/membership/application/credential TTL exists.

Exercise maintenance with controlled old data and failure injection:

- S3 delete failure preserves export reference;
- operation detail delete failure preserves retryability;
- crash after item delete/before marker can finish on next run;
- archive upload/manifest failure preserves audit source events.

## 9. Backup/restore smoke

With MongoDB Database Tools installed:

```bash
CMS_BACKUP_SOURCE_URL="$CMS_TEST_URL" \
CMS_BACKUP_SOURCE_DB=concierge-cms-test \
CMS_RESTORE_TEST_URL="$CMS_TEST_URL" \
CMS_RESTORE_TEST_DB=concierge-cms-restore-test \
bash scripts/operations/cms-backup-restore-smoke.sh
```

The script must refuse source=destination, destination not ending in `-restore-test`, and prod/production-like targets. Inspect restored CollectionVersion hashes plus `audit_archive_manifests`/operation itemArchive evidence.

## 10. Real staging worker crash/recovery evidence

The repository now contains `apps/admin/tests/chaos/worker-checkpoints.mjs`, exposed as:

```bash
npm run chaos:worker-checkpoints -- --help
```

For each real staging scenario (`draft`, `publish`, `selection`, `export`):

1. create a real in-flight domain intent on a staging CMS DB ending in `-test`;
2. capture `--phase snapshot`;
3. stop the staging Worker;
4. with `CONCIERGE_ALLOW_REMOTE_CHAOS=1` and `CONCIERGE_CHAOS_WORKER_STOPPED=1`, `--phase arm` the **same** domain/Payload job at the observed checkpoint;
5. restart Worker;
6. run `--phase verify` and retain its JSON evidence.

The verify result must prove exactly one original domain intent, a non-stuck original Payload job and the scenario-specific success invariant. Never create a new job to make a recovery test pass.

## 11. Staging acceptance

Follow `docs/superpowers/plans/2026-09-03-collections-gate-and-staging.md` and collect real load/concurrency/security/UI/chaos/backup/storage evidence for the exact SHA.

Create:

`docs/evidence/collections-staging.json`

Then:

```bash
npm run verify:collections:acceptance -- \
  --evidence docs/evidence/collections-staging.json \
  --expected-commit "$(git rev-parse HEAD)"
```

The fixture under `tests/fixtures` is validator-only and is never release evidence.

## 12. Static review focus after green runtime gates

Review specifically for:

- generic Payload mutation accidentally opened;
- Curation accidentally owning Collection membership/rank/order;
- browser expansion of large selections;
- missing actor scoping on operations/exports;
- unsafe recovery CAS or unbounded maintenance scans;
- product TTLs;
- export record deletion before confirmed private-object deletion;
- audit deletion before archive manifest persistence;
- operation detail deletion before summary persistence;
- a maintenance retry starvation path;
- secrets/request hashes/signed URLs leaking into logs/UI/evidence;
- stale generated Payload output;
- new endpoint bypassing feature flags;
- OAuth/admin authorization mutation not writing its append-only audit event.

## 13. Definition of done before merge/deployment

The Codex pass is complete only when:

1. targeted closeout tests pass;
2. generated artifacts/contracts are current;
3. `npm run verify` passes;
4. `npm run verify:full` passes against disposable full stack;
5. migrations/readiness/maintenance failure cases pass;
6. UI lifecycle E2E passes;
7. backup/restore smoke passes;
8. four worker chaos scenarios pass on real staging;
9. staging acceptance is 20/20 for the exact candidate SHA;
10. review findings are fixed without breaking frozen invariants;
11. branch diff contains no unrelated cleanup;
12. only then is the candidate eligible for the production procedure in `docs/superpowers/plans/2026-09-03-render-collections-production.md` and eventual merge to `main`.
