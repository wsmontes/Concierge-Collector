# Collections Gate and Staging Implementation Plan

> **Execution rule:** this plan is intentionally deferred to the final Codex/runtime pass. ChatGPT prepares all software, tests and procedures but does not self-attest staging evidence.

**Goal:** Qualify the complete Collections closeout on disposable staging and produce real, commit-bound evidence for all 20 normative acceptance criteria.

**Architecture:** Admin Web and background Worker run against a disposable CMS database in Render; FastAPI remains the operational authority. All production Collections flags stay off. Staging exercises the same migration stream, private storage, recovery and retention behavior that production will use.

**Tech Stack:** Node 22, Vitest, Payload CMS, MongoDB Atlas, private S3-compatible storage, Render Docker services, Render REST API.

**Specs:**
- `docs/superpowers/specs/2026-09-03-render-collections-rollout-design.md`
- `docs/superpowers/specs/2026-09-04-collections-production-closeout-design.md`

## Global Constraints

- Never print, commit or copy a secret value into command output or evidence.
- Staging CMS databases must end in `-test`; production databases are never used by test/chaos commands.
- Remote chaos requires `CONCIERGE_ALLOW_REMOTE_CHAOS=1`; its destructive arm phase also requires the worker to be stopped and `CONCIERGE_CHAOS_WORKER_STOPPED=1`.
- Render staging uses Admin Web + private Worker from `Dockerfile.admin`; no Blueprint adoption.
- Keep every Collections feature flag `false` in production throughout staging qualification.
- Evidence refers to the exact 40-character commit SHA that staging deploys.
- `GET /ready` is a read-only gate. Never weaken it or make it migrate schema.

---

### Task 1: Local closeout gate before staging

- [ ] Install the pinned toolchain with `npm ci` under Node `>=22.12 <23` / npm 10.
- [ ] Regenerate Payload types/import map only through official generators; do not hand-edit generated unions.
- [ ] Run the targeted closeout tests listed in `docs/runbooks/collections-codex-integration-gate.md`.
- [ ] Run `npm run verify` and then `npm run verify:full` against disposable local `*-test` databases.
- [ ] Fix concrete compile/test/runtime defects without reopening the frozen architecture.

The acceptance validator fixture at `tests/fixtures/complete-collections-acceptance.json` remains only a validator fixture and is never release evidence.

### Task 2: Provision isolated Render staging services

Create Git-backed `Concierge-Collector-Admin-Staging` and `Concierge-Collector-Admin-Worker-Staging` from the exact candidate SHA. The Worker has no public domain.

Admin/Worker protected environment names include:

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

Staging operational values begin from the production defaults unless a deliberately shorter retention window is needed to exercise maintenance:

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

Every feature flag starts `false`: `CMS_AUTH_ENABLED`, `CATALOG_SCAN_ENABLED`, `COLLECTIONS_ADMIN_ENABLED`, `COLLECTOR_ASSOCIATION_READ_ENABLED`, `COLLECTOR_DRAFT_MUTATION_ENABLED`, `CONSUMER_CREDENTIALS_ENABLED`, `COLLECTIONS_DISTRIBUTION_ENABLED`.

Record only service IDs, hostnames, SHA, environment-variable names, non-secret numeric/boolean values and timestamps.

### Task 3: Run closeout migrations and readiness

- [ ] Stop write traffic/worker as required by the migration runbook and acquire the existing migration lock.
- [ ] Run `npm run migrate:cms:locked` exactly once against staging.
- [ ] Verify the migration stream includes:

```text
20260902_009_operational_retention
20260902_010_selection_retention
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
```

- [ ] Verify `export_artifact_ttl` is absent and the closeout indexes exist: `export_expiry_status`, `operation_retention_scan`, `audit_archive_scan`, `audit_archive_batch_unique`.
- [ ] Require Admin `/ready` to return 200 after migration. Before migration, a schema-related 503 is expected and must not be bypassed.
- [ ] Run `scripts/operations/cms-backup-restore-smoke.sh` into a `*-restore-test` destination and verify counts/version hashes.

### Task 4: Exercise retention and archival behavior

Using disposable data and, where useful, shortened **staging-only** windows:

- [ ] Expired completed export with an object: prove `DeleteObject` occurs before CMS record removal.
- [ ] Storage deletion failure: prove the export reference survives and can retry.
- [ ] Old terminal operation items: prove summary counts/SHA persist before detail deletion.
- [ ] Simulate deletion failure after the operation summary: prove the parent stays eligible and later retry finishes without rewriting the original digest.
- [ ] Simulate crash after operation detail deletion but before the purge marker: prove next run completes the marker rather than blocking the scan forever.
- [ ] Old Admin audit batch: prove deterministic private NDJSON-gzip + manifest + SHA exist before source deletion.
- [ ] Prove Collections, versions, membership intervals, applications and credentials have no TTL.

Capture worker task summaries and object/manifest identifiers only; never signed URLs, object-store credentials or Mongo URIs.

### Task 5: Produce real worker crash/recovery evidence

Create one real draft operation, publish job, selection materialization and export on staging. For each scenario use `npm run chaos:worker-checkpoints` against the **same domain record and same Payload job**.

Flow for each scenario:

```bash
npm run chaos:worker-checkpoints -- --scenario <scenario> --id "$DOMAIN_ID" --phase snapshot \
  --output "evidence/<scenario>-before.json"

# Stop the staging Worker first.
CONCIERGE_ALLOW_REMOTE_CHAOS=1 CONCIERGE_CHAOS_WORKER_STOPPED=1 \
  npm run chaos:worker-checkpoints -- --scenario <scenario> --id "$DOMAIN_ID" --phase arm \
  --checkpoint "$OBSERVED_CHECKPOINT" --output "evidence/<scenario>-armed.json"

# Restart the Worker.
CONCIERGE_ALLOW_REMOTE_CHAOS=1 npm run chaos:worker-checkpoints -- \
  --scenario <scenario> --id "$DOMAIN_ID" --phase verify \
  --output "evidence/<scenario>-recovered.json"
```

The evidence must prove no duplicate domain intent, the original Payload job is no longer stuck, and scenario-specific invariants converge:

- draft: operation succeeds and draft revision advances consistently;
- publish: exactly the intended target version is published and pointer matches it;
- selection: manifest becomes `ready`, scan completes and manifest hash exists;
- export: one complete record retains private artifact key + SHA.

Do not manufacture new jobs in the harness to make recovery pass.

### Task 6: Execute full staging qualification

Run the load, concurrency, UI/E2E, security, contract, authorization downgrade, distribution and backup tests from `docs/runbooks/collections-codex-integration-gate.md`. Capture immutable log/artifact references for each acceptance criterion, plus:

- Admin `/ready` result;
- worker heartbeat/oldest queue age;
- maintenance-task results;
- FastAPI/Mongo/storage health;
- chaos evidence for all four worker scenarios;
- backup/restore evidence;
- load/storage growth and quota evidence.

### Task 7: Write and validate acceptance evidence

Create `docs/evidence/collections-staging.json` only from the executed staging run:

```bash
CANDIDATE_SHA=$(git rev-parse HEAD)
npm run verify:collections:acceptance -- \
  --evidence docs/evidence/collections-staging.json \
  --expected-commit "$CANDIDATE_SHA"
```

Expected: `Collections acceptance verified` and `20/20 criteria`.

Commit only non-secret evidence and release records after confirming every reference is real staging output. A copied fixture, fabricated pass status or evidence from a different SHA invalidates the qualification.

### Task 8: Production handoff

Only after the exact staging SHA passes 20/20, follow `docs/superpowers/plans/2026-09-03-render-collections-production.md`. Production merge/deployment belongs to the final Codex/operator pass; this staging plan never authorizes a direct merge from an unexecuted ChatGPT branch.
