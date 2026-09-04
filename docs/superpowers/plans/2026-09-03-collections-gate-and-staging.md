# Collections Gate and Staging Implementation Plan

> **Execution rule:** this plan belongs to the final Codex/runtime pass. ChatGPT prepares software, tests and procedures but does not self-attest runtime or staging evidence.

**Goal:** Qualify the complete Collections closeout on disposable staging and produce real, commit-bound evidence for all 20 normative acceptance criteria.

**Architecture:** Admin Web and background Worker run against a disposable CMS database; FastAPI remains the operational Entity/Curation/auth authority. Production Collections flags stay off while staging exercises the same migration stream, private storage, recovery and retention behavior intended for production.

**Tech Stack:** Node 22, npm 10, Vitest, Payload CMS 3.86, MongoDB, private S3-compatible storage, FastAPI, Playwright and Render staging services.

## Global constraints

- Never print, commit or copy secret values into evidence.
- Staging CMS databases must end in `-test`; production databases are never used by test/chaos commands.
- Remote chaos requires `CONCIERGE_ALLOW_REMOTE_CHAOS=1`; destructive arm additionally requires worker stopped + `CONCIERGE_CHAOS_WORKER_STOPPED=1`.
- Render staging uses Git-backed Admin Web + private Worker; no Blueprint adoption.
- Keep every production Collections feature flag `false` during staging qualification.
- Evidence must identify the exact 40-character candidate SHA.
- `GET /ready` is read-only and may never be weakened to run migrations/DDL.
- Recovery must operate on the same original domain/Payload job; no replacement intent/job is allowed.

## Task 1 — Local closeout gate before staging

Run from a clean checkout of the candidate branch:

```bash
node --version
npm --version
npm ci
npm run generate:types --workspace=@concierge/admin
npm run generate:importmap --workspace=@concierge/admin
npm run generate:contracts
npm run check:admin-generated
npm run check:contracts
npm run verify
npm run verify:full
```

Use only disposable local `*-test` databases for full integration/E2E. Fix concrete runtime defects without reopening the frozen architecture.

The acceptance validator fixture at `tests/fixtures/complete-collections-acceptance.json` remains validator-only and is never release evidence.

## Task 2 — Provision isolated staging services

Deploy the exact candidate SHA to a Git-backed Admin Web and private Admin Worker. The Worker has no public domain.

Required protected/environment names include:

```text
CMS_MONGODB_URL
CMS_MONGODB_DB_NAME=<name ending in -test>
PAYLOAD_SECRET
CMS_SERVICE_KEY
CMS_PUBLIC_SERVER_URL
CMS_COLLECTOR_ORIGINS
FASTAPI_BASE_URL
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

Every Collections feature flag begins `false`: `CMS_AUTH_ENABLED`, `CATALOG_SCAN_ENABLED`, `COLLECTIONS_ADMIN_ENABLED`, `COLLECTOR_ASSOCIATION_READ_ENABLED`, `COLLECTOR_DRAFT_MUTATION_ENABLED`, `CONSUMER_CREDENTIALS_ENABLED`, `COLLECTIONS_DISTRIBUTION_ENABLED`.

Record only non-secret values, service/deploy IDs, hostnames, timestamps and SHA.

## Task 3 — Apply closeout migrations and prove readiness transition

Under the existing migration lock:

```bash
npm run migrate:cms:locked
```

The staging database must record this complete closeout tail:

```text
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
20260904_014_staging_retention_scan
20260904_015_export_cleanup_backoff
20260904_016_operation_retention_quarantine
```

Verify at minimum:

- `export_artifact_ttl` absent;
- `export_expiry_status` present;
- `export_cleanup_due` present with exact key order;
- `operation_retention_due` present with quarantine-aware key order;
- `staging_retention_scan` present;
- `audit_archive_scan` present;
- `audit_archive_batch_unique` unique;
- heartbeat TTL remains seven days;
- no product-domain TTL is introduced.

`GET /ready` must remain 503 while migration 016 or any required index signature is missing, and return 200 only after the deployed schema matches the source allowlist. Do not repair schema from the endpoint.

## Task 4 — Exercise maintenance and archival behavior

Using controlled disposable data and, where useful, shorter **staging-only** windows:

### Exports

- expired completed export with object → prove DeleteObject before CMS reference deletion;
- object deletion failure → prove CMS reference survives, `cleanupAttempts` increments and `cleanupNextAttemptAt` advances;
- prove a backed-off bad export does not starve other due exports;
- after backoff expiry/storage recovery, prove cleanup converges;
- expired failed export without object may be deleted without storage I/O.

### Operation items

- old valid terminal detail → prove deterministic summary/SHA before delete;
- partial delete/crash after `purgeStartedAt` → prove retry skips partial rehash and eventually finishes;
- crash after rows disappear but before `itemsPurgedAt` → prove marker recovers from immutable summary;
- successful intact detail with selected-count contradiction → prove no deletion and `retentionBlocked*` quarantine;
- archive/detail contradiction before purge → prove no deletion and quarantine;
- prove a quarantined oldest operation does not starve later safe candidates;
- verify retention metadata writes do not renew semantic `updatedAt`.

### Admin audit

- upload failure → source remains;
- manifest persistence failure → source remains;
- matching pre-existing manifest → crash recovery can finish source deletion;
- mismatching manifest/batch → source remains and forward archival deliberately stops for operator investigation;
- `audit.archive.completed` is emitted only after source deletion and outside the archived batch.

## Task 5 — Produce real worker crash/recovery evidence

Create one real draft operation, publish job, selection materialization and export on staging. Use the same original domain record/Payload job for every scenario:

```bash
npm run chaos:worker-checkpoints -- --scenario <scenario> --id "$DOMAIN_ID" --phase snapshot \
  --output "evidence/<scenario>-before.json"

# Stop worker first.
CONCIERGE_ALLOW_REMOTE_CHAOS=1 CONCIERGE_CHAOS_WORKER_STOPPED=1 \
  npm run chaos:worker-checkpoints -- --scenario <scenario> --id "$DOMAIN_ID" --phase arm \
  --checkpoint "$OBSERVED_CHECKPOINT" --output "evidence/<scenario>-armed.json"

# Restart worker.
CONCIERGE_ALLOW_REMOTE_CHAOS=1 \
  npm run chaos:worker-checkpoints -- --scenario <scenario> --id "$DOMAIN_ID" --phase verify \
  --output "evidence/<scenario>-recovered.json"
```

Prove:

- draft: one original operation reaches success and draft revision is at least the target revision;
- publish: intended version is the current published pointer and immutable version exists;
- selection: `ready`, scan complete and manifestHash present;
- export: `complete` with private artifact key + SHA.

Because `deleteJobOnComplete=true`, a Payload job may be absent after successful convergence. That is acceptable only when the domain success invariant proves completion. A surviving job must not remain stuck/erroring.

Also exercise the post-domain-success crash window: terminal-success domain with a stuck `processing:true` Payload job must recover by reopening the same internal job, never by manufacturing a replacement.

## Task 6 — Full staging qualification

Run the complete load, concurrency, UI/E2E, security, contract, authorization downgrade, distribution and backup tests from `docs/runbooks/collections-codex-integration-gate.md`.

Capture immutable references for:

- exact candidate SHA;
- Admin readiness result;
- worker heartbeat/oldest queue age;
- maintenance summaries;
- FastAPI/Mongo/storage health;
- generated artifact freshness;
- four worker chaos scenarios;
- backup/restore;
- load/concurrency/security/UI runs;
- storage growth/quota observation.

## Task 7 — Write and validate real acceptance evidence

Create `docs/evidence/collections-staging.json` only from executed staging results:

```bash
CANDIDATE_SHA=$(git rev-parse HEAD)
npm run verify:collections:acceptance -- \
  --evidence docs/evidence/collections-staging.json \
  --expected-commit "$CANDIDATE_SHA"
```

Expected release evidence is 20/20 criteria for that exact SHA. A copied fixture, fabricated pass or evidence from another commit invalidates qualification.

## Task 8 — Production handoff

Only after the exact staging SHA has fresh 20/20 evidence, follow `docs/superpowers/plans/2026-09-03-render-collections-production.md`.

This staging plan never authorizes production deployment or merge to `main` from an unexecuted ChatGPT branch.
