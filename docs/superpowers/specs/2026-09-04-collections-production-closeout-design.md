# Collections Production Closeout — Design

**Date:** 2026-09-04
**Status:** execution spec — owner delegated autonomous audit/planning/implementation
**Branch:** `feat/collections-production-closeout-20260904`

## Goal

Close the remaining software-development gaps required to operate the existing Concierge Collector + Collections Admin architecture end-to-end before production data volume becomes expensive to migrate.

This is a convergence pass, not a redesign. The domain model, Payload/FastAPI split, Collector offline-first boundary, Collection versioning model, worker publication model and staged feature-flag rollout remain authoritative.

## Frozen architecture

The closeout preserves these existing decisions:

- Entity and Curation remain operational FastAPI/Mongo concerns.
- Collection lifecycle, drafts, memberships, versions, operations, applications and credentials remain Payload/Admin concerns.
- Published Collection associations exposed to Collector are read-only through FastAPI.
- Collector draft mutation uses the narrow Payload bridge and the same queued/CAS operation path as Admin work.
- Publication remains worker-driven, leased, fenced and idempotent.
- Published versions remain immutable; restore of history creates draft intent rather than moving the published pointer backward.
- Admin Web and Admin Worker are separate Render services using the same Admin image/database; only Admin Web receives a public domain.
- `admin.concierge-collector.com` is the intended production Admin hostname.
- Server-side feature flags fail closed in staging/production and are enabled by canary.
- GitHub Actions remain intentionally out of scope because project quality gates are local/Codex-run.

## Superseded/deferred work that must NOT be revived in this closeout

### Render Blueprint adoption

The original 2026-08-18 phase 07 planned `render.yaml` and image-runtime Blueprint adoption. The later rollout runbook explicitly does not authorize Blueprint adoption or recreation of existing services. The current deployment plan is Git-backed Admin Web + Worker services with staged flags.

Therefore this closeout does **not** create `render.yaml`, migrate existing service IDs, or change the API/Collector runtime topology.

### Framework rewrites and domain reconsideration

The following Baseline 1 deferred decisions remain deferred:

- rewriting the vanilla Collector framework;
- replacing `synthetic` Curation semantics;
- changing the vector-storage representation;
- broad save/media orchestration redesign beyond already-established compatibility boundaries.

These are not blockers for Collections production.

## Audit findings

### Already closed

The current mainline already contains the substantial product surface:

- CMS auth handoff and live role revalidation;
- Collection CRUD/lifecycle and optimistic concurrency;
- immutable publish versions and membership intervals;
- worker lease/fencing/takeover behavior;
- Explorer, saved views, selection manifests and server-side scans;
- bulk Collection operations and Operations Admin;
- private selection exports;
- consumer applications/credentials/distribution;
- Collector published-association UI and single-Curation draft mutation;
- Collections Admin list/detail UI, metadata editing, archive/restore, publish, versions, restore-as-draft, activity and distribution picker;
- recovery reconciler, orphan staging retention, worker heartbeat and selection-retention split;
- release gates, acceptance schema/verifier, backup/restore smoke and rollout/rollback runbooks.

Architecture Baseline 1 has already been qualified with the repository standard/full gates before its promotion to main. This closeout must preserve those invariants.

### Gap A — readiness proves connectivity, not schema readiness

`GET /ready` currently pings MongoDB and returns ready. The phase-07 contract requires readiness to also prove that required CMS migrations/indexes are present without running migrations as a side effect.

Risk: a newly deployed Admin process can be declared ready before a required migration/index exists, allowing traffic into an incompatible schema.

Closeout requirement:

- add a read-only CMS schema-readiness checker;
- require the latest expected migration(s) and critical indexes used by Collections;
- return 503 with safe component status when schema is not ready;
- never migrate or repair from `/ready`.

### Gap B — export reference TTL can orphan object-storage data

Migration `20260822_008_exports` installs `export_artifact_ttl` directly on CMS export records. The `ArtifactStore` comments state object deletion/lifecycle is best-effort/out-of-scope. Mongo TTL can therefore remove the only CMS reference before confirmed `DeleteObject`.

The original production-hardening contract is stricter: delete the private object first, confirm success, and only then purge the CMS record.

Closeout requirement:

- replace the export TTL with a normal expiry lookup index;
- maintenance task scans expired completed/failed export records in bounded batches;
- when a stored key exists, call `ArtifactStore.delete(key)` first;
- delete the CMS export record only after object deletion succeeds (or when no object was ever materialized);
- preserve records on storage failure for retry/operator visibility.

### Gap C — high-volume operation item detail has no bounded retention

`collection_operation_items` is intentionally item-level and may grow proportional to bulk editorial work. The original hardening contract specified 90-day retention after terminal operations, but current code only purges orphan draft staging.

Closeout requirement:

- compact terminal operation items older than the configured retention window into a deterministic summary artifact before deletion;
- retain counts by item status and reason plus a SHA-256 digest over the canonical item stream so evidence remains verifiable;
- store the compact summary durably on the parent operation (not as a new product-domain object);
- delete item rows only after the summary is persisted under CAS-safe conditions;
- never compact nonterminal operations.

This keeps the existing domain model while bounding the highest-cardinality operational table.

### Gap D — Admin audit history has no archival boundary

`audit_events` is append-only and intentionally has no TTL. At production scale it grows indefinitely. The original hardening contract specified a 365-day hot-retention window with private NDJSON-gzip archival before purge.

Closeout requirement:

- add a scheduled audit archival task using the existing private artifact-store boundary;
- write deterministic NDJSON-gzip batches with count/SHA metadata;
- persist an archive manifest in CMS before source deletion;
- delete source events only after successful artifact upload + manifest persistence;
- emit an `audit.archive.completed` event outside the archived source batch;
- retain product records (Collections/versions/memberships/applications/credentials) indefinitely.

A small CMS archive-manifest collection is operational evidence, not a new product domain.

### Gap E — operational user authorization changes are not persistently audited

`authorize_user.py` directly updates `users.authorized`/`users.role`; OAuth allowlist promotion also updates those fields directly. Phase 07 specified a single append-only `user_authz_audit_events` path with idempotent `eventKey`.

Closeout requirement:

- implement shared `append_authz_change` logic;
- call it from manual authorization CLI and OAuth allowlist-driven changes;
- record actor/target, before/after authorized+role, source, request/correlation ID and timestamp;
- never store token/cookie/credential material;
- make retries idempotent by unique `eventKey`;
- introspection/read-only authorization checks must not generate mutation-audit events.

### Gap F — staging acceptance references a chaos command that does not exist

The acceptance/hardening plan names `apps/admin/tests/chaos/worker-checkpoints.mjs`, but there is no chaos harness in the repository.

Closeout requirement:

- add the deterministic worker-checkpoint chaos driver expected by the staging gate;
- cover draft operation, publish, selection materialization and export checkpoint/recovery scenarios through existing domain/test helpers or HTTP/runtime hooks;
- make it fail closed when the disposable test environment is not explicitly configured;
- produce machine-readable evidence suitable for the existing 20-criterion acceptance record.

The harness may require Codex/runtime execution later; writing it is part of this development closeout.

### Gap G — rollout configuration does not enumerate all now-required artifact/retention settings consistently

The current `.env.example` contains export storage and several recovery settings, while the latest staging/production plans enumerate only a subset. Once export cleanup/audit archival are hard requirements, deployment configuration must be explicit.

Closeout requirement:

- version the new retention/archive environment names in `.env.example`;
- update staging and production runbooks/plans to list required non-secret names and safe defaults;
- keep secret values outside Git.

## Retention defaults

Production defaults remain aligned with the existing hardening plan:

- worker heartbeat: 7 days;
- unused selection validity: 24 hours;
- used selection audit retention: 90 days;
- export artifact/reference: 7 days;
- terminal operation-item hot detail: 90 days;
- orphan staged draft rows: 30 days;
- Admin audit hot history: 365 days.

Retention settings may be shortened in disposable staging for qualification. Production must not silently shorten evidence-retention windows.

## Readiness contract

`GET /health` remains liveness and must not require Mongo.

`GET /ready` is read-only and returns 200 only when:

1. CMS Mongo ping succeeds;
2. the latest expected Payload migration marker is present;
3. critical Collections indexes required by the deployed code are present.

A failure returns 503 with safe component names/status only. It does not expose connection strings, credentials, database contents or stack traces.

## Storage/archive contract

The existing private S3-compatible store remains the storage abstraction. No public ACL is introduced.

Operational archives use separate logical key namespaces below the configured private prefix:

- `exports/...` (existing selection export behavior);
- `operations/...` only if a future full artifact is required; closeout compaction stores summary on the parent operation and therefore does not require object storage;
- `audit/...` for compressed Admin audit archives.

Signed URLs remain only for explicitly authorized export reads. Audit archive objects are worker-only and are never exposed by a public endpoint in this closeout.

## Verification strategy

Development here writes regression/unit/integration/chaos tests but does not claim runtime qualification.

Codex handoff remains responsible for executing and fixing failures in:

- `npm run verify`;
- `npm run verify:full`;
- real Mongo migrations/index verification;
- Admin Web + Worker + FastAPI integration;
- Playwright;
- worker crash/restart and chaos harness;
- backup/restore smoke;
- load/benchmark runs;
- Render staging qualification and production deployment.

No production-complete claim is valid until those commands produce fresh evidence for the exact candidate SHA.
