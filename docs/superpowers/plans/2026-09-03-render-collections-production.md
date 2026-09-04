# Render Collections Production Implementation Plan

> **Execution rule:** production deployment remains deferred until Codex has produced fresh 20/20 staging evidence for the exact candidate SHA. This plan is the deployment handoff, not authorization to deploy from ChatGPT.

**Goal:** Provision production Admin and Worker services in Render, then release Collections through observable canaries.

**Architecture:** A public Docker-based Admin Web service and private background Worker share the production CMS database and service credential. The existing FastAPI service remains the system of record for its own API and gains only the exact Admin origin/callback configuration. Server-side flags make each Collections capability fail closed until its canary is healthy. Private S3-compatible storage is used for export artifacts and worker-only audit archives.

**Tech Stack:** Render web services and background workers, Docker, Node 22, Payload CMS, MongoDB Atlas, FastAPI, private S3-compatible object storage, DNS/TLS.

**Specs:**
- `docs/superpowers/specs/2026-09-03-render-collections-rollout-design.md`
- `docs/superpowers/specs/2026-09-04-collections-production-closeout-design.md`

## Global Constraints

- Start only after staging evidence reports 20/20 for the candidate SHA.
- Use exact origins; never add a CORS wildcard or reflect arbitrary origins.
- Never print or commit secret, Mongo, service-key, S3, or DNS-provider credentials.
- Keep consumer credentials and public distribution disabled until their dedicated final canaries.
- On an unhealthy canary, revert only its flag first and follow `docs/runbooks/collections-rollback.md`.
- Do not introduce Render Blueprint adoption or GitHub Actions during this rollout.
- Web/worker never run migrations at boot. Migrations run once through the locked release command.
- Production retention windows must not be silently shortened below the versioned defaults.

---

### Task 1: Create production Admin and Worker services

**Files:**
- Uses: `Dockerfile.admin`
- Uses: `apps/admin/src/env.ts`
- Uses: `apps/admin/.env.example`
- Uses: `scripts/python-tools/render_deployment_manager.py`

**Interfaces:**
- Consumes: qualified staging SHA and the existing production API service `srv-d4fngpjuibrs73bo70vg`.
- Produces: `Concierge-Collector-Admin` web service and `Concierge-Collector-Admin-Worker` background worker with recorded Render IDs.

- [ ] **Step 1: Verify qualification and production baseline**

```bash
QUALIFIED_SHA=$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('docs/evidence/collections-staging.json', 'utf8')).commitSha)")
npm run verify:collections:acceptance -- --evidence docs/evidence/collections-staging.json --expected-commit "$QUALIFIED_SHA"
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py list-deploys srv-d4fngpjuibrs73bo70vg --limit 3
curl --fail --silent --show-error https://concierge-collector.onrender.com/api/v3/health
```

Expected: 20/20 staging evidence for the same SHA; existing API live and healthy.

- [ ] **Step 2: Create the production Admin Web**

Create a Render `web_service` in workspace `tea-d09cc5je5dus73bbc5m0`: repository `https://github.com/wsmontes/Concierge-Collector.git`, branch `main` at `QUALIFIED_SHA`, Docker runtime, Dockerfile `Dockerfile.admin`, region matching the existing API. Confirm the selected deployment commit equals `QUALIFIED_SHA` before continuing.

Configure the protected values for: `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME`, `PAYLOAD_SECRET`, `CMS_SERVICE_KEY`, `CMS_PUBLIC_SERVER_URL=https://admin.concierge-collector.com`, `CMS_COLLECTOR_ORIGINS=https://concierge-collector.com`, `FASTAPI_BASE_URL=https://api.concierge-collector.com`, `METRICS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_EXPORT_PREFIX`, `S3_SIGNED_URL_TTL_SECONDS`.

Set every Collections feature flag explicitly to `false` before the initial deploy.

- [ ] **Step 3: Create the production Worker**

Create a `background_worker` with the same production CMS/storage settings, image source, branch/SHA and region. Override the Docker command to `npm run start:admin-worker`. It must not have a public domain.

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

- [ ] **Step 4: Verify initial production deployment while flags are off**

Check both service IDs until the latest deployment is `live`. Request Admin `/health`. `/ready` may remain 503 before migration; that is expected and must not be bypassed. Confirm the Worker starts without a repeating configuration error but do not enable Collections traffic before schema migration/readiness succeeds. Confirm guarded Collections endpoints return `503 feature_disabled`.

- [ ] **Step 5: Record reversible baseline**

Record service IDs, deploy IDs, SHA, hostname, flag values, health timestamp, non-secret retention values and the prior API deploy ID. Never include protected values.

### Task 2: Configure DNS and authentication boundaries

**Files:**
- Uses: `concierge-api-v3/.env.example: CMS_ADMIN_ORIGIN, CMS_ADMIN_CALLBACK_URL`
- Uses: `apps/admin/src/env.ts: CMS_PUBLIC_SERVER_URL, CMS_COLLECTOR_ORIGINS`
- Uses: `docs/runbooks/collections-rollout.md`

- [ ] Attach `admin.concierge-collector.com` only to Admin Web and wait for verified TLS.
- [ ] On API service `srv-d4fngpjuibrs73bo70vg`, merge `CMS_ADMIN_ORIGIN=https://admin.concierge-collector.com` and `CMS_ADMIN_CALLBACK_URL=https://admin.concierge-collector.com/auth/callback`; preserve all existing CORS/trusted origins.
- [ ] Deploy API and verify health, one-shot CMS handoff, callback, logout/session expiry and immediate role downgrade.
- [ ] Verify no arbitrary callback origin, token query parameter, public worker domain or widened cookie scope exists.

### Task 3: Run closeout migrations and operational smoke tests

**Files:**
- Uses: `scripts/release/migrate-cms-locked.mjs`
- Uses: `scripts/operations/cms-backup-restore-smoke.sh`
- Uses: `docs/runbooks/cms-backup-restore.md`

- [ ] **Step 1: Establish backup and migration lock**

Create a dated backup, acquire the existing migration lock and record holder/start/SHA/database name without connection strings.

- [ ] **Step 2: Run migrations exactly once**

Run:

```bash
npm run migrate:cms:locked
```

Verify the migration stream includes, at minimum, the previously qualified migrations plus the closeout migrations:

```text
20260902_009_operational_retention
20260902_010_selection_retention
20260904_011_export_cleanup_retention
20260904_012_operation_item_retention
20260904_013_audit_archival
```

Verify critical indexes include `export_expiry_status`, `operation_retention_scan`, `audit_archive_scan` and `audit_archive_batch_unique`, and that legacy `export_artifact_ttl` is absent.

- [ ] **Step 3: Require schema-aware readiness**

`GET /ready` must return 200 only after migration 013 and the critical index allowlist are present. A 503 is a release blocker; do not repair schema from the readiness endpoint.

- [ ] **Step 4: Run restore and maintenance smoke tests**

Run `scripts/operations/cms-backup-restore-smoke.sh` against a `*-restore-test` destination. Exercise maintenance with controlled expired data and prove:

- export object deletion precedes CMS reference deletion and storage failure preserves the reference;
- operation-item summary persists before deletion and a post-summary deletion failure remains retryable;
- audit archive object + manifest exist before hot rows disappear;
- no Collection/version/membership/application/credential product record receives TTL.

- [ ] **Step 5: Capture operational baseline**

Record Mongo/API/storage health, Admin readiness, worker heartbeat age, queue age, operation failure rate, maintenance summaries and `409`, `412`, `423`, `5xx` counts.

### Task 4: Release production flags by canary

Use `config/collections-feature-flags.json`, `docs/runbooks/collections-rollout.md`, and `docs/runbooks/collections-rollback.md`.

Enable sequentially, never in parallel:

1. `CMS_AUTH_ENABLED=true` — handoff, logout/session expiry, role downgrade and authz mutation-audit smoke.
2. `CATALOG_SCAN_ENABLED=true` — bounded resumable Explorer scan.
3. `COLLECTIONS_ADMIN_ENABLED=true` — create/edit/bulk/publish/history/operations canary.
4. `COLLECTOR_ASSOCIATION_READ_ENABLED=true` — published reverse association reads only.
5. `COLLECTOR_DRAFT_MUTATION_ENABLED=true` — single-Curation mutation through same operation/CAS path.
6. `CONSUMER_CREDENTIALS_ENABLED=true` — one narrow revocable credential.
7. `COLLECTIONS_DISTRIBUTION_ENABLED=true` — allowlist + `401/404/410/429` + live hydration.

After every flag, observe the operational baseline and revert that flag immediately on invariant/health failure. Do not advance until the incident is closed.

### Task 5: Finalize release evidence

Record enabled flags, service/deploy IDs, candidate SHA, operators, canary evidence, retention settings and observation windows. Retain the exact staging evidence used to qualify the SHA. Production completion is not inferred from compile success; it requires the executed Codex/staging gates plus the canary record.
