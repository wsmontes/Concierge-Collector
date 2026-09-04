# Collections Production Closeout — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-04-collections-production-closeout-design.md`

**Goal:** Finish the remaining software-development gaps for production qualification without changing the established Concierge/Collections architecture.

**Execution rule:** implement autonomously on `feat/collections-production-closeout-20260904`; do not modify `main`. Tests are written before production code. Runtime execution/qualification is deferred to Codex where the chat environment cannot execute the full stack.

---

## Task 1 — Make Admin readiness schema-aware

**Test first**

- Add unit tests for a read-only `checkCmsSchemaReadiness(payload)` helper.
- Add/update `/ready` route tests proving:
  - 200 only when Mongo + migration marker + critical indexes are present;
  - 503 when migration is missing;
  - 503 when a critical index is missing;
  - no migration/DDL method is called from readiness.

**Implementation**

- Create `apps/admin/src/operations/schema-readiness.ts`.
- Check the latest known migration marker and a small stable critical-index allowlist.
- Update `apps/admin/app/ready/route.ts` to return safe component status.
- Keep `/health` unchanged.

---

## Task 2 — Make export cleanup object-first and retryable

**Test first**

- Extend maintenance tests so expired export rows:
  - call object delete before CMS delete when `key` exists;
  - are preserved when object delete fails;
  - are deleted without storage I/O when no object was ever created;
  - are ignored before expiry.
- Add migration test asserting `export_artifact_ttl` is removed and replaced by a non-TTL expiry lookup index.

**Implementation**

- Create migration `20260904_011_export_cleanup_retention.ts`.
- Extend `purgeExpiredArtifactsTask.ts` with bounded export cleanup.
- Reuse `ArtifactStore.delete` and existing lazy S3 configuration.
- Update stale comments that describe Mongo TTL as the source of truth.

---

## Task 3 — Bound terminal operation-item detail

**Test first**

- Add tests proving:
  - nonterminal operation items are never compacted;
  - terminal operations younger than retention are preserved;
  - old terminal operation items produce deterministic status/reason counts + SHA;
  - parent operation summary is persisted before item deletion;
  - rerun is idempotent and does not change the digest;
  - failure to persist summary leaves all item rows intact.

**Implementation**

- Add an optional `itemArchive` JSON field to `CollectionOperations` for the compact evidence summary.
- Add migration/index support needed for bounded scans by operation/update time if not already present.
- Extend `purgeExpiredArtifactsTask.ts` with terminal operation compaction.
- Add `CMS_OPERATION_ITEM_RETENTION_DAYS` and batch-size environment knobs.

---

## Task 4 — Archive old Admin audit events before purge

**Test first**

- Add unit tests around the archival worker with an in-memory `ArtifactStore`:
  - only events older than cutoff are selected;
  - emitted NDJSON is deterministic and gzip-compressed;
  - artifact count/SHA is persisted in a manifest;
  - source rows are deleted only after upload + manifest persistence;
  - upload/manifest failure preserves source rows;
  - `audit.archive.completed` is emitted after the source batch deletion and is not part of that batch.

**Implementation**

- Create `AuditArchiveManifests` hidden operational collection.
- Create `apps/admin/src/jobs/archiveAuditEventsTask.ts`.
- Reuse private artifact storage under an `audit/` key namespace.
- Add migration/indexes for `(createdAt,_id)` and archive-manifest uniqueness.
- Register task/collection in Payload config.
- Add `CMS_AUDIT_RETENTION_DAYS`, `CMS_AUDIT_ARCHIVE_BATCH_SIZE`.

---

## Task 5 — Persist FastAPI authorization-change audit

**Test first**

- Create `test_cms_authz_audit.py` covering:
  - manual authorize/role change;
  - manual revoke;
  - OAuth allowlist auto-authorization/promotion;
  - no event when no authorization fields changed;
  - idempotent retry by `eventKey`;
  - no token/credential material in stored event;
  - introspection/read-only calls do not append mutation audit.

**Implementation**

- Create `concierge-api-v3/app/core/authz_audit.py` with shared `append_authz_change`.
- Refactor `scripts/authorize_user.py` to call the shared writer.
- Refactor OAuth `create_or_update_user` to write audit on automatic `authorized`/`role` changes.
- Add unique/index specs for `user_authz_audit_events`.
- Add a dry-run-safe archive script only if the already-specified operational audit object-storage configuration is available without widening architecture; otherwise preserve the hot append-only table and leave external archival to the staging qualification backlog explicitly.

---

## Task 6 — Add missing worker chaos/evidence harness

**Test/development**

- Create `apps/admin/tests/chaos/worker-checkpoints.mjs`.
- Require explicit disposable `*-test` CMS database and remote opt-in rules consistent with the release gate.
- Drive/record checkpoint scenarios for:
  - draft operation;
  - publish;
  - selection materialization;
  - export.
- Emit JSON evidence with scenario, checkpoint, expected invariant, observed state and pass/fail.
- Never target production or a database not ending `-test`.

Runtime execution remains Codex/staging work.

---

## Task 7 — Normalize production/staging configuration docs

- Update `apps/admin/.env.example` with all retention/archive knobs.
- Update latest staging and production plans so required S3/retention names are explicit.
- Update `docs/runbooks/collections-rollout.md` / backup-retention docs with object-first export purge and audit archival behavior.
- Do not add Blueprint adoption or GitHub Actions.

---

## Task 8 — Static closeout audit after patches

- Search active source (excluding archive docs/data) for unresolved `TODO`, `FIXME`, `coming soon`, placeholder behavior and planned-but-missing Collections files.
- Classify every remaining hit as:
  - production blocker;
  - deliberate deferred decision;
  - stale documentation/archive.
- Update the closeout spec with final classification.
- Produce Codex handoff listing exact commands and runtime-only gates.

## Codex qualification commands

At handoff, Codex should execute at minimum:

```bash
npm run verify
npm run verify:full
npm run verify:collections:acceptance -- --evidence <real-staging-evidence> --expected-commit <candidate-sha>
```

plus migrations, restore smoke, load/chaos, Render staging and production canaries from the current rollout plans.
