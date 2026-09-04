# Collections Production Closeout — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-04-collections-production-closeout-design.md`

**Goal:** Finish the remaining software-development gaps for production qualification without changing the established Concierge/Collections architecture.

**Execution rule:** work only on `feat/collections-production-closeout-20260904`; do not modify `main`. Source/test/doc implementation is accumulated here. Runtime execution/qualification belongs to the final Codex pass.

## Static/development status

The implementation items below are present in the branch but are **not runtime-qualified in ChatGPT**. Checkboxes mean “implemented/documented in source”, not “test passed”.

### 1. Schema-aware Admin readiness

- [x] Read-only `checkCmsSchemaReadiness(payload)`.
- [x] `/ready` combines Mongo ping + migration marker + critical index signatures and performs no DDL.
- [x] Readiness fails closed on missing/mismatched migration/index state.
- [x] Latest expected migration advanced through `20260904_016_operation_retention_quarantine`.
- [x] Unit coverage for migration/index signature failure cases.

### 2. Object-first export cleanup

- [x] Legacy Mongo export TTL replaced with maintenance indexes.
- [x] DeleteObject occurs before CMS reference deletion.
- [x] Storage failure preserves the CMS reference.
- [x] Failed exports without objects can be removed without storage I/O.
- [x] Persistent cleanup attempt/backoff metadata prevents one bad object from starving a bounded batch.
- [x] Migration 011 establishes non-TTL expiry scan.
- [x] Migration 015 establishes `export_cleanup_due`.
- [x] `export_expired` is treated as deliberate terminal worker outcome rather than wasting Payload retries.

### 3. Bounded operation-item detail

- [x] Terminal operation detail streams through a bounded cursor into deterministic count/status/reason/SHA evidence.
- [x] Evidence is persisted before destructive deletion.
- [x] `purgeStartedAt` makes partial-delete retry safe without hashing a partial subset.
- [x] `itemsPurgedAt` recovers after delete-success/marker-crash.
- [x] Retention writes disable Mongoose timestamps so maintenance does not renew operation age.
- [x] Permanent evidence contradictions are preserved and marked `retentionBlocked*` instead of starving every future batch.
- [x] Transient cursor/Mongo/delete/CAS failures remain retryable.
- [x] Migration 012 establishes initial retention scan.
- [x] Migration 016 establishes `operation_retention_due` including quarantine state.

### 4. Admin audit archival

- [x] Hidden `AuditArchiveManifests` operational collection.
- [x] Scheduled deterministic NDJSON-gzip archive task.
- [x] Object upload + manifest persistence happen before source deletion.
- [x] Existing matching manifest supports crash recovery.
- [x] Upload/manifest failure preserves source events.
- [x] `audit.archive.completed` is emitted after source deletion and is outside the archived batch.
- [x] Migration 013 adds archive scan + unique manifest index.
- [x] Oldest inconsistent manifest/batch deliberately blocks forward archival as an integrity incident rather than being skipped for throughput.

### 5. FastAPI authorization-change audit

- [x] Shared append-only `user_authz_audit_events` writer with deterministic unique `eventKey`.
- [x] Manual authorization/revoke and OAuth promotion/bootstrap use the shared path.
- [x] No-op writes append no event.
- [x] Read-only introspection appends no mutation event.
- [x] Audit event excludes token/cookie/credential material.
- [x] Audit write failure compensates the privilege mutation fail-closed.
- [x] Ambiguous “audit committed but response lost” path rereads `eventKey` before compensation.
- [x] FastAPI index specs cover unique event key + archive-order index.
- [x] External cold archival is explicitly deferred rather than inventing a second Python object-store architecture.

### 6. Worker recovery and chaos evidence

- [x] Chaos driver exists for draft, publish, selection and export.
- [x] Destructive arm refuses non-`*-test` databases.
- [x] Remote chaos requires explicit opt-in; arm requires explicit worker-stopped confirmation.
- [x] Harness never manufactures replacement domain intent/job.
- [x] Payload 3.86 post-domain-success stuck-job window is handled by reopening the same internal job only after validating terminal-success domain state.
- [x] Recovery starts from stuck `payload-jobs`, avoiding starvation behind healthy old domains.
- [x] Missing referenced Payload jobs are detected with lookup filtering before limit.
- [x] Permanently failed/missing-domain jobs are classified once and leave later stuck-job batches.

### 7. Retention/staging scan hardening

- [x] Orphan staging eligibility is filtered before bounded limit.
- [x] Migration 014 adds `staging_retention_scan`.
- [x] Maintenance schedules run bounded batches hourly for sufficient drain capacity without unbounded loops.
- [x] Invalid numeric environment overrides fail explicitly instead of silently reverting to defaults.

### 8. Generated artifacts and release-gate safety

- [x] Root `check:admin-generated` runs Payload's official type generator, compares output and restores the checkout before exit.
- [x] Standard release gate checks generated Payload types before Admin typecheck/build.
- [x] Release-gate test expectations include the generated-types step.
- [x] Permanent fixes must use official `generate:types`/`generate:importmap`/contract generators; generated files are not hand-edited as source.

### 9. Static source classification

- [x] Ambiguous `places_service` TODO inspected against `AIOrchestrator` implementation.
- [x] Places wiring classified as deliberate non-Collections deferment: `place_id_*` workflows fail explicitly with 501 until a service is injected.
- [x] Render Blueprint, GitHub Actions, framework rewrite, vector redesign and synthetic-Curation reconsideration remain intentionally deferred.
- [x] No closeout decision widens the frozen Collection↔Curation ownership model.

### 10. Documentation/handoff

- [x] `.env.example` contains retention/recovery/storage configuration names.
- [x] Rollout and backup/restore docs describe object-first export cleanup, operation summary-first deletion and audit archive-first deletion.
- [x] Staging/production plans retain Git-backed Admin Web + private Worker topology; no Blueprint adoption.
- [x] Codex integration gate is the authoritative runtime/deployment handoff.

## Migration tail to qualify

Codex must apply and verify this complete closeout tail in order:

```text
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
20260904_014_staging_retention_scan
20260904_015_export_cleanup_backoff
20260904_016_operation_retention_quarantine
```

`GET /ready` must remain 503 until migration 016 and every required critical index signature are present.

## Runtime-only work intentionally accumulated for Codex

The following remain unchecked here because they require the repository/runtime/full stack rather than source editing:

- `npm ci` under the pinned Node/npm versions;
- official Payload type/import-map generation and generated-diff commit;
- generated FastAPI client/OpenAPI contracts;
- targeted unit/regression suites;
- Admin/FastAPI/Collector complete unit suites;
- lint/typecheck/build;
- `npm run verify`;
- `npm run verify:full` against safe `*-test` databases;
- real Mongo migrations 011–016 and index inspection;
- readiness transition before/after migration;
- real S3 export cleanup and audit archival failure injection;
- large operation-retention cursor/delete/crash behavior;
- Admin Web + Worker + FastAPI integration and Playwright;
- four staging worker crash/recovery scenarios;
- backup/restore smoke;
- load/concurrency/security/storage growth qualification;
- real `docs/evidence/collections-staging.json` and 20/20 acceptance;
- production canaries and merge to `main` only after exact-SHA qualification.

## Final Codex entrypoint

Follow, in order:

1. `docs/runbooks/collections-codex-integration-gate.md`
2. `docs/superpowers/plans/2026-09-03-collections-gate-and-staging.md`
3. after exact-SHA 20/20 qualification only, `docs/superpowers/plans/2026-09-03-render-collections-production.md`

No production-complete claim is authorized by this plan without fresh executed evidence.
