# Collections convergence — Codex integration gate

## Objective

This branch intentionally accumulates implementation before the runtime gate. Codex should treat the branch as a nearly complete integration candidate, not as a design task. Preserve the architecture and fix concrete compile/test/integration defects discovered by the commands below.

Branch: `feat/collections-admin-convergence-20260902`
Baseline: `main` at `4d1d661c68ed815384744ad609ea2923aac7fd1a`

## Architecture invariants to preserve while fixing

- `Collection` remains a separate aggregate. Never add Collection/rank/order fields to Curation.
- Payload custom command endpoints remain the only lifecycle/membership/publish writers; do not re-enable generic Payload CRUD for Collections.
- FastAPI remains Curation/Entity/auth authority; Payload revalidates admin authorization.
- Collector Collections remain online-only: no Dexie schema and no existing sync queue fallback.
- Membership is interval-based; published versions are immutable history.
- Historical restore creates a draft; it does not rewrite the current published pointer.
- Publish remains asynchronous/fenced/atomic.
- Bulk selections remain server-side manifests; the browser never expands all-matching into every Curation ID.
- Consumer secrets remain hash-only/show-once.
- Recovery must never manufacture a duplicate domain job or purge resumable staging.
- No GitHub Actions are required: the project intentionally uses the local release gate because hosted Actions would exceed the desired free-tier usage.

## 1. Toolchain and clean install

```bash
node --version
npm --version
npm ci
```

Expected Node: `>=22.12 <23`; npm major 10.

## 2. Fast feedback — new convergence tests

Run the root acceptance gate test first:

```bash
npx vitest run tests/test_collections_acceptance_gate.test.js
```

Run the Admin unit suite. The following new areas are especially relevant if triaging a failure:

```bash
npm run test --workspace=@concierge/admin -- \
  tests/unit/collections/admin-client.test.ts \
  tests/unit/components/collections-workspace.test.tsx \
  tests/unit/components/collection-detail-workspace.test.tsx \
  tests/unit/components/collection-commands.test.tsx \
  tests/unit/components/collection-publish.test.tsx \
  tests/unit/components/explorer-target-collection.test.tsx \
  tests/unit/components/operations-workspace.test.tsx \
  tests/unit/components/application-collection-picker.test.tsx \
  tests/unit/payload/operations-admin-endpoints.test.ts \
  tests/unit/payload/publishing-preview-endpoint.test.ts \
  tests/unit/publishing/publish-preview.test.ts \
  tests/unit/jobs/reconcile-recovery.test.ts \
  tests/unit/jobs/purge-orphan-staging.test.ts \
  tests/unit/migrations/operational-retention.test.ts
```

Then run the complete Admin unit suite:

```bash
npm run test:admin
```

## 3. Static checks

```bash
npm run lint:admin
npm run typecheck:admin
npm run build:admin
npm run lint:collector
npm run build:collector:check
npm run check:contracts
```

When generated Payload types/import maps are stale because of the two new maintenance tasks, regenerate them explicitly and commit only deterministic generated output:

```bash
npm run generate:types --workspace=@concierge/admin
npm run generate:importmap --workspace=@concierge/admin
npm run check:contracts
```

Do not hand-edit generated Payload type unions as the permanent fix.

## 4. Local unit release gate

```bash
npm run verify
```

This must cover Collector build/lint/tests, Admin unit/typecheck/build, API unit/format/lint and generated contracts.

## 5. Full stack

Use disposable databases only:

- CMS database name must end in `-test`.
- operational FastAPI Mongo database name must end in `-test`.
- E2E base URLs should remain loopback unless `CONCIERGE_ALLOW_REMOTE_E2E=1` is deliberately set for a disposable remote stack.

Start FastAPI, Admin web and Admin worker using the existing Architecture Baseline 1 qualification runbook. Then run:

```bash
npm run verify:full
```

This is the primary integration gate. Do not weaken its test-database safety guards to make the run pass.

## 6. Specific manual/E2E flows to inspect

### Collections Admin

1. `/admin/collections` loads active + archived Collections.
2. Create a Collection through the UI.
3. Open `/admin/collections/<id>`.
4. Edit metadata with CAS.
5. Paginate Members, Draft Changes, Versions and Activity independently.
6. `Add Curations` navigates to Explorer with the target Collection as a hint.
7. Publish preview shows selected/add/remove/available/unavailable counts.
8. If availability changes, the prior unavailable confirmation is invalidated.
9. Publish only reports success after the Collection reread confirms the promoted version and clean draft.
10. Restore a historical version as draft; current published version must remain unchanged until a later publish.
11. Archive/restore is reversible and never hard-deletes published history.

### Explorer / bulk

1. Target Collection from the query string is revalidated against the server list before preselection.
2. Archived/publishing Collections are visible as context but cannot be selected as bulk targets.
3. All-matching selections remain server-side manifests.
4. Multi-target operation appears in `/admin/operations`.
5. Cancel on a parent operation cancels only children still before the commit barrier.

### Operations

1. `/admin/operations` shows recent bulk operations and publication jobs for the current admin only.
2. Collection names link to their detail pages.
3. Raw request hashes/idempotency internals are not exposed.
4. History paging works newest-first.
5. JobDrawer parent cancellation uses the parent cancellation endpoint, not child `cancelDraftOperation(parentId)` semantics.

### Distribution Admin

1. New applications select Collections by title/slug, not Mongo IDs.
2. Only publishable Collections can be newly granted.
3. A legacy/archived Collection already present in an allowlist remains visible/removable but cannot be newly added accidentally.
4. Editing allowlist/rate limit uses `If-Match` and reloads on revision conflict.
5. Issue/rotate/revoke retains show-once/hash-only semantics.

### Maintenance/recovery

1. A healthy queued Payload job is untouched.
2. A stale/exhausted Payload job is reopened only when its domain record is resumable and its lease is reclaimable.
3. `meta.recoveryCount` stops automatic recovery after the configured bound.
4. Missing Payload job is reported, not silently recreated.
5. Orphan staged rows are purged only when the operation is terminal/missing and older than retention.
6. Staging for a resumable operation is preserved.
7. Worker heartbeat TTL migration is the only new automatic TTL; product records remain TTL-free.

## 7. Backup/restore smoke

With MongoDB Database Tools installed and an isolated destination:

```bash
CMS_BACKUP_SOURCE_URL="$CMS_TEST_URL" \
CMS_BACKUP_SOURCE_DB=concierge-cms-test \
CMS_RESTORE_TEST_URL="$CMS_TEST_URL" \
CMS_RESTORE_TEST_DB=concierge-cms-restore-test \
bash scripts/operations/cms-backup-restore-smoke.sh
```

The script must refuse source=destination DB, any destination not ending in `-restore-test`, and destination names containing `prod`/`production`.

## 8. Staging acceptance (not a local self-attestation)

After real concurrency/crash/load/security/contract/backup evidence exists for the exact candidate commit, create:

`docs/evidence/collections-staging.json`

Then run:

```bash
npm run verify:collections:acceptance -- \
  --evidence docs/evidence/collections-staging.json \
  --expected-commit "$(git rev-parse HEAD)"
```

The test fixture at `tests/fixtures/complete-collections-acceptance.json` is only a validator fixture and is never valid release evidence.

## 9. Review focus after green tests

Review the branch specifically for:

- accidental generic Payload mutation paths;
- stale admin error-shape assumptions (`{error:{code}}` is the administrative shape);
- browser materialization of large selections;
- missing actor scoping on new Operations reads/cancel;
- unsafe recovery CAS or unbounded maintenance scans;
- any TTL accidentally added to Collections, versions, membership, application or credential product records;
- secrets/request hashes leaked to Admin read DTOs;
- UI confirmations implemented with `window.prompt/window.confirm` in newly touched Collections/Operations flows;
- generated Payload type/import-map drift;
- feature flags bypassed by newly added endpoints.

## 10. Definition of done for the Codex pass

Do not merge merely because TypeScript compiles. The Codex pass is complete when:

1. targeted new tests pass;
2. `npm run verify` passes;
3. `npm run verify:full` passes against the disposable full stack;
4. new UI lifecycle E2E passes;
5. backup/restore smoke passes;
6. review findings are fixed without breaking the invariants above;
7. the branch diff contains no unrelated cleanup;
8. staging-only acceptance work remains clearly marked pending until real staging evidence exists.
