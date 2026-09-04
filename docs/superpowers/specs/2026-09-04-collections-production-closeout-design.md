# Collections Production Closeout — Design

**Date:** 2026-09-04
**Status:** development/static closeout candidate — runtime qualification not executed in ChatGPT
**Branch:** `feat/collections-production-closeout-20260904`
**Baseline:** `main` at `b545626a9829e8f449eab783df541a7ca61e4bce`

## Goal

Close the remaining software-development gaps required to operate the existing Concierge Collector + Collections Admin architecture end-to-end before production data volume becomes expensive to migrate.

This is a convergence pass, not a redesign. Runtime correctness is deliberately not self-attested here: the final Codex pass owns generated artifacts, typecheck/build/tests, real Mongo migrations/indexes, full-stack integration, Playwright, crash/chaos, backup/restore, load and staging evidence.

## Frozen architecture

The closeout preserves these decisions:

- Entity and Curation remain operational FastAPI/Mongo concerns.
- Collection lifecycle, drafts, memberships, versions, operations, applications and credentials remain Payload/Admin concerns.
- Collection ↔ Curation remains N:N. Curation never owns Collection membership, order or rank.
- Published Collection associations exposed to Collector are read-only through FastAPI.
- Collector draft mutation uses the narrow Payload bridge and the same queued/CAS operation path as Admin work.
- Publication remains worker-driven, leased, fenced and idempotent.
- Published versions remain immutable; restoring history creates new draft intent rather than moving the published pointer backward.
- Collections remain online-only in Collector; no Dexie/offline queue is added.
- Admin Web and private Admin Worker remain separate services. No Render Blueprint adoption is introduced.
- Server-side feature flags fail closed in staging/production and are enabled by canary.
- GitHub Actions remain intentionally out of scope; release gates are local/Codex-run.

## Closeout result by original gap

| Gap | Development/static disposition | Runtime evidence still required |
| --- | --- | --- |
| A — schema readiness | `GET /ready` now combines Mongo ping with a read-only Payload migration/index compatibility check. It performs no DDL. Latest expected migration is `20260904_016_operation_retention_quarantine`. | Apply migrations to real disposable Mongo; prove 503 before incompatible schema and 200 after exact migration/index set. |
| B — export TTL/object orphaning | Legacy `export_artifact_ttl` is removed. Cleanup is object-first, then CMS-reference deletion. Storage failure preserves the reference. Persistent cleanup backoff prevents one bad object from starving the batch. | S3-compatible DeleteObject failure injection, retry/backoff timing and object/reference inspection. |
| C — operation-item growth | Old terminal detail is streamed through bounded cursors into deterministic count/reason/SHA evidence before deletion. `purgeStartedAt`/`itemsPurgedAt` make partial-delete recovery crash-safe. Permanent evidence contradictions are preserved and quarantined from later batches. | Real Mongo cursor/delete/CAS behavior, partial-delete/crash injection, large-volume memory/load observation. |
| D — Admin audit growth | Old `audit_events` are written as deterministic private NDJSON-gzip, manifested with count/SHA/key, then removed. Manifest/upload failure preserves source. | Real S3 + Mongo archival, failure injection, restore/inspection. |
| E — FastAPI authorization audit | Shared append-only `user_authz_audit_events` path covers manual changes, OAuth promotion/bootstrap and no-op/idempotent retries. Audit failure is fail-closed with compensation; ambiguous network failure checks `eventKey` before rollback. | Pytest + real Mongo indexes + auth downgrade/bootstrap integration. |
| F — missing worker chaos harness | `apps/admin/tests/chaos/worker-checkpoints.mjs` exists for draft/publish/selection/export with strict `*-test`, remote opt-in and worker-stopped safety guards. It never manufactures replacement domain intents/jobs. | Real staging worker stop/arm/restart/verify for all four scenarios. |
| G — inconsistent config/runbooks | `.env.example`, rollout, staging, production, backup/restore and Codex handoff enumerate storage/retention/recovery settings and conservative invariants. | Verify actual staging/production secret-store names and non-secret values match the versioned docs. |

## Additional hardening discovered during closeout

### Payload job recovery is job-first

Payload 3.86 still uses a durable `processing` boolean. A process can die after domain success but before Payload finalizes/deletes its internal job. Recovery therefore starts from bounded stuck `payload-jobs`, maps only the four known domain task slugs and validates the linked domain record before re-opening the same job.

This avoids the starvation bug caused by scanning the oldest domain intents first. Active/reclaimable domain records whose referenced Payload job is missing are detected separately through a Mongo `$lookup` that filters missing jobs before the bounded limit. The physical jobs collection name comes from the live Mongoose model rather than a hardcoded pluralization assumption.

A job tied to a terminal-success domain may be reopened idempotently so configured `deleteJobOnComplete` can finish cleanup. A job tied to a permanently failed/missing domain is classified once in job metadata so it does not monopolize the stuck-job batch.

### Export cleanup backoff

A permanently failing object key must not consume the first bounded cleanup slots forever. `collection_exports` therefore carries operational cleanup attempt/last-attempt/next-attempt metadata. DeleteObject failure preserves the record and schedules exponential retry (bounded to 24h); due records are selected with `export_cleanup_due`.

No provider error text or credential material is persisted.

### Operation-retention quarantine

Permanent contradictions discovered before destructive retention — successful `selectedCount` disagreeing with intact detail, persisted archive evidence disagreeing with intact detail, or invalid immutable archive item count — are not retried forever. They are marked under `itemArchive.retentionBlocked*`, excluded by `operation_retention_due`, and all raw evidence is preserved for operator investigation.

Transient Mongo/cursor/delete/CAS failures remain retryable and are not quarantined.

### Maintenance writes do not renew operation age

Retention-only writes use Mongoose `{ timestamps: false }`. `itemArchive`, purge-start and purge-completion bookkeeping is not a semantic operation edit and must not move `updatedAt`, otherwise a failed 90-day purge could disappear for another retention window.

### Export-expired worker lifecycle

`export_expired` is a deliberate terminal domain outcome, not a transient worker failure. The export task returns terminal `failed` output for that exact 410 condition so Payload can complete/delete the internal job. Other conflicts, 5xx and unknown errors continue to propagate to Payload retry policy.

### Generated Payload artifacts are now a gate

The root release gate runs `check:admin-generated` before Admin typecheck/build. That check executes Payload's official type generator, compares the generated output with the checked-in file and always restores the original checkout before returning. Stale generated output fails with an instruction to run the official generator and commit its deterministic diff.

## Migration sequence introduced by this closeout

The closeout migration tail is:

```text
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
20260904_014_staging_retention_scan
20260904_015_export_cleanup_backoff
20260904_016_operation_retention_quarantine
```

Critical new/changed indexes include:

- `export_expiry_status` and `export_cleanup_due` on `collection_exports`;
- `operation_retention_due` on `collection_operations`;
- `staging_retention_scan` on `collection_draft_changes`;
- `audit_archive_scan` on `audit_events`;
- `audit_archive_batch_unique` on `audit_archive_manifests`;
- existing Collections queue/lease/slug/heartbeat indexes required by schema readiness.

The legacy export TTL must be absent after migration.

## Retention defaults

- worker heartbeat: 7 days;
- unused selection validity: 24 hours;
- used selection audit retention: 90 days;
- export artifact/reference: 7 days;
- terminal operation-item hot detail: 90 days;
- orphan staged draft rows: 30 days;
- Admin audit hot history: 365 days.

Maintenance runs in bounded batches. Production must not silently shorten evidence-retention windows. Disposable staging may use shorter windows only to exercise behavior and must record the override in evidence.

## Audit archival ordering is intentionally fail-safe

Unlike export cleanup and operation-retention corruption handling, Admin audit archival intentionally does not skip past an inconsistent oldest batch. An existing archive manifest whose count/SHA/key does not match the deterministic batch is an integrity incident; proceeding to newer batches could make the gap less visible. The worker therefore preserves source rows and requires operator investigation rather than optimizing throughput around a broken audit chain.

## Explicitly deferred / non-blocking work

These items are outside the Collections production closeout and must not be revived as release blockers without a separate decision:

- Render Blueprint adoption/service recreation;
- GitHub Actions adoption;
- Collector framework rewrite;
- synthetic-Curation semantics redesign;
- vector-storage representation redesign;
- broad media/save orchestration redesign;
- FastAPI authorization-audit external cold archival: the Python service has no existing shared S3 artifact-store boundary, so the append-only hot audit collection and indexes remain authoritative for this release rather than creating a second storage architecture;
- Google Places injection into `AIOrchestrator`: `place_id_*` workflows deliberately return 501 until Places is wired; audio/image/text workflows are unaffected and this feature is unrelated to Collections.

## Readiness contract

`GET /health` remains liveness and must not require Mongo.

`GET /ready` is read-only and may return 200 only when:

1. CMS Mongo ping succeeds;
2. migration `20260904_016_operation_retention_quarantine` is recorded;
3. every critical index signature expected by the deployed code is present, including key order, uniqueness and TTL attributes where applicable.

A failure returns 503 with safe component status only. Readiness never creates indexes, runs migrations or repairs data.

## Verification boundary

No test/build/migration/staging result is inferred from source inspection. The final Codex handoff must produce fresh evidence for the exact candidate SHA by running, at minimum:

```bash
npm ci
npm run generate:types --workspace=@concierge/admin
npm run generate:importmap --workspace=@concierge/admin
npm run generate:contracts
npm run check:admin-generated
npm run check:contracts
npm run verify
npm run verify:full
```

and then the migration/readiness/failure-injection, backup/restore, four real worker chaos scenarios, load/security/UI qualification and 20/20 staging acceptance described in `docs/runbooks/collections-codex-integration-gate.md`.

Only that executed qualification can promote this development/static candidate toward production deployment and merge to `main`.
