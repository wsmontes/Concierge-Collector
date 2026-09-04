# Render Collections Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision production Admin and Worker services in Render, then release Collections through observable canaries.

**Architecture:** A public Docker-based Admin Web service and private background Worker share the production CMS database and service credential. The existing FastAPI service remains the system of record for its own API and gains only the exact Admin origin/callback configuration. Server-side flags make each Collections capability fail closed until its canary is healthy.

**Tech Stack:** Render web services and background workers, Docker, Node 22, Payload CMS, MongoDB Atlas, FastAPI, DNS/TLS.

**Spec:** `docs/superpowers/specs/2026-09-03-render-collections-rollout-design.md`

## Global Constraints

- Start only after the staging evidence gate reports 20/20 for the candidate SHA.
- Use exact origins; never add a CORS wildcard or reflect arbitrary origins.
- Never print or commit secret, Mongo, service-key, S3, or DNS-provider credentials.
- Keep consumer credentials and public distribution disabled until their dedicated final canaries.
- On an unhealthy canary, revert only its flag first and follow `docs/runbooks/collections-rollback.md`.

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

Read the qualified SHA from the immutable staging evidence:

```bash
QUALIFIED_SHA=$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('docs/evidence/collections-staging.json', 'utf8')).commitSha)")
```

Run:

```bash
npm run verify:collections:acceptance -- --evidence docs/evidence/collections-staging.json --expected-commit "$QUALIFIED_SHA"
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py list-deploys srv-d4fngpjuibrs73bo70vg --limit 3
curl --fail --silent --show-error https://concierge-collector.onrender.com/api/v3/health
```

Expected: evidence reports 20/20; existing API deploy is live; health reports a connected database.

- [ ] **Step 2: Create the production Admin Web**

Create a Render `web_service` in workspace `tea-d09cc5je5dus73bbc5m0`: repository `https://github.com/wsmontes/Concierge-Collector.git`, branch `main` at `QUALIFIED_SHA`, Docker runtime, Dockerfile `Dockerfile.admin`, and region matching the existing API. Confirm the selected deployment commit equals `QUALIFIED_SHA` before continuing. Configure `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME`, `PAYLOAD_SECRET`, `CMS_SERVICE_KEY`, `CMS_PUBLIC_SERVER_URL=https://admin.concierge-collector.com`, `CMS_COLLECTOR_ORIGINS=https://concierge-collector.com`, `FASTAPI_BASE_URL=https://api.concierge-collector.com`, and `METRICS_KEY` with production values from the protected Render configuration.

Set every Collections feature flag explicitly to `false` before the initial deploy.

- [ ] **Step 3: Create the production Worker**

Create a `background_worker` with the same production CMS settings, image source, branch/SHA and region. Override the Docker command to `npm run start:admin-worker`. It must not have a public domain. Configure `CMS_JOB_RECOVERY_STALE_SECONDS=180`, `CMS_JOB_MAX_RECOVERIES=3`, `CMS_ORPHAN_STAGING_RETENTION_DAYS=30`, `CMS_ORPHAN_STAGING_BATCH_SIZE=500`, and `CMS_USED_SELECTION_RETENTION_DAYS=90`.

- [ ] **Step 4: Verify initial production deployment**

Use the Render deployment manager to check both service IDs until the latest deployment is `live`. Request the Admin `/health` and `/ready` endpoints using the generated `onrender.com` URL. Confirm the Worker logs show heartbeat/job polling without a repeating error. Confirm a guarded Collections endpoint returns `503 feature_disabled`.

- [ ] **Step 5: Record reversible baseline**

Record service IDs, deploy IDs, SHA, hostname, flag values, health timestamp and the prior API deploy ID. Do not include protected values.

### Task 2: Configure DNS and authentication boundaries

**Files:**
- Uses: `concierge-api-v3/.env.example: CMS_ADMIN_ORIGIN, CMS_ADMIN_CALLBACK_URL`
- Uses: `apps/admin/src/env.ts: CMS_PUBLIC_SERVER_URL, CMS_COLLECTOR_ORIGINS`
- Uses: `docs/runbooks/collections-rollout.md`

**Interfaces:**
- Consumes: live Admin Web service and generated `onrender.com` hostname.
- Produces: TLS-valid `https://admin.concierge-collector.com` with an exact API callback and origin allowlist.

- [ ] **Step 1: Attach the custom domain in Render**

Add `admin.concierge-collector.com` only to the production Admin Web. Apply the DNS record requested by Render at the domain provider. Wait for Render to report the domain verified and TLS active.

- [ ] **Step 2: Configure exact FastAPI authentication origins**

On existing API service `srv-d4fngpjuibrs73bo70vg`, set `CMS_ADMIN_ORIGIN=https://admin.concierge-collector.com` and `CMS_ADMIN_CALLBACK_URL=https://admin.concierge-collector.com/auth/callback`. Add the exact Admin origin to `CORS_ORIGINS` and `TRUSTED_CALLBACK_ORIGINS` while preserving all existing entries. Use the API manager's read-merge-write environment helper; never replace the whole environment with a partial map.

- [ ] **Step 3: Deploy and verify the API configuration**

Trigger the API deploy only after reviewing the merged environment key list. Verify `/api/v3/health`, login handoff, callback, logout, expired session and role downgrade. Reject any callback origin not exactly `https://admin.concierge-collector.com`.

- [ ] **Step 4: Validate the public Admin endpoint**

Open `https://admin.concierge-collector.com/admin/collections`. Expected before flags: the Admin loads and authenticated requests are denied only with documented feature-disabled responses; no cross-origin errors, open redirect, token in URL, or cookie-domain widening appears.

### Task 3: Run migrations and operational smoke tests

**Files:**
- Uses: `scripts/release/migrate-cms-locked.mjs`
- Uses: `scripts/operations/cms-backup-restore-smoke.sh`
- Uses: `docs/runbooks/cms-backup-restore.md`

**Interfaces:**
- Consumes: live production Admin and Worker with all Collections flags disabled.
- Produces: one recorded migration execution and verified restore/recovery behavior.

- [ ] **Step 1: Establish backup and migration lock**

Create a dated production backup according to `docs/runbooks/cms-backup-restore.md`. Acquire the existing migration lock and record the holder, start time, SHA and database name without exposing its connection string.

- [ ] **Step 2: Run migrations exactly once**

Run `npm run migrate:cms:locked` against production through the approved operational environment. Verify migrations `20260902_009_operational_retention` and `20260902_010_selection_retention` are recorded and their expected indexes exist.

- [ ] **Step 3: Run restore and Worker smoke tests**

Run `scripts/operations/cms-backup-restore-smoke.sh` against a `*-restore-test` destination. Confirm the Worker heartbeat appears, reconciliation is bounded, and no domain record was deleted by recovery or retention tasks.

- [ ] **Step 4: Capture operational baseline**

Record baseline values for Mongo health, API health, storage health, worker heartbeat age, queue age, operation failure rate and `409`, `412`, `423`, and `5xx` response counts.

### Task 4: Release production flags by canary

**Files:**
- Uses: `config/collections-feature-flags.json`
- Uses: `docs/runbooks/collections-rollout.md`
- Uses: `docs/runbooks/collections-rollback.md`

**Interfaces:**
- Consumes: healthy production services, migration baseline, and qualified evidence.
- Produces: explicitly recorded flag state for each enabled Collections capability.

- [ ] **Step 1: Enable CMS authentication canary**

Set only `CMS_AUTH_ENABLED=true`. Verify one approved administrator can log in, log out, expire a session and be denied after a role downgrade. Observe the operational baseline before proceeding.

- [ ] **Step 2: Enable scan and Admin canaries**

Set `CATALOG_SCAN_ENABLED=true`; test a bounded, resumable large Explorer selection. Then set `COLLECTIONS_ADMIN_ENABLED=true`; create a test Collection, publish a draft, restore a historical version as a new draft, and cancel one safe test operation. Observe queue age, retries, error counts and ownership boundaries after each flag.

- [ ] **Step 3: Enable Collector association canaries**

Set `COLLECTOR_ASSOCIATION_READ_ENABLED=true`; verify published associations are visible only to authenticated users and remain read-only. Then set `COLLECTOR_DRAFT_MUTATION_ENABLED=true`; verify a single-Curation action enters the same queue/CAS path as Admin bulk work.

- [ ] **Step 4: Enable credentials and distribution last**

Set `CONSUMER_CREDENTIALS_ENABLED=true`; issue one revocable canary credential with a narrow allowlist. Then set `COLLECTIONS_DISTRIBUTION_ENABLED=true`; verify allowlist enforcement plus expected `401`, `404`, `410` and `429` behavior before widening consumers.

- [ ] **Step 5: Handle an unhealthy canary**

If any health signal or invariant fails, immediately set the flag from the current step back to `false`, retain all evidence, and execute the matching action in `docs/runbooks/collections-rollback.md`. Do not advance another flag until the incident is closed.

- [ ] **Step 6: Finalize the release record**

Record enabled flags, service/deploy IDs, candidate SHA, canary operators, evidence links and observation windows. Archive staging evidence with the release record.
