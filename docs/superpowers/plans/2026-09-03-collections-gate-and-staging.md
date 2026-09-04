# Collections Gate and Staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the Collections acceptance test and produce real, commit-bound staging qualification evidence.

**Architecture:** The root Vitest suite runs in JSDOM, so test fixtures must be converted from module URLs to filesystem paths before Node's `readFile` receives them. A separate Admin Web and background Worker run against a disposable CMS database in Render; no production feature flag is enabled during this plan.

**Tech Stack:** Node 22, Vitest, Payload CMS, MongoDB Atlas, Render Docker services, Render REST API.

**Spec:** `docs/superpowers/specs/2026-09-03-render-collections-rollout-design.md`

## Global Constraints

- Never print, commit, or copy a secret value into a command output or document.
- Staging CMS databases must end in `-test`; production databases are never used by test commands.
- Render staging services use `Dockerfile.admin`; the worker has no public domain.
- Keep every Collections feature flag `false` in production throughout this plan.
- Evidence refers to the exact 40-character commit SHA that staging deploys.

---

### Task 1: Repair the acceptance-gate fixture path

**Files:**
- Modify: `tests/test_collections_acceptance_gate.test.js:1-11`
- Test: `tests/test_collections_acceptance_gate.test.js`

**Interfaces:**
- Consumes: `verifyCollectionsAcceptance({ evidencePath: string, expectedCommit: string })`.
- Produces: an absolute filesystem path accepted by `node:fs/promises.readFile` in JSDOM and Node.

- [ ] **Step 1: Confirm the current failure**

Run: `npm test -- tests/test_collections_acceptance_gate.test.js`

Expected: four failing tests with `ERR_INVALID_URL_SCHEME` because JSDOM resolves `import.meta.url` to `http:`.

- [ ] **Step 2: Make the smallest test-only change**

Add `fileURLToPath` to the existing `node:url` import and replace the fixture declaration with:

```js
const FIXTURE = fileURLToPath(new URL('./fixtures/complete-collections-acceptance.json', import.meta.url))
```

Do not change `verifyCollectionsAcceptance`; its CLI already resolves string paths correctly.

- [ ] **Step 3: Verify the repaired test**

Run: `npm test -- tests/test_collections_acceptance_gate.test.js`

Expected: 5 passing tests and no `ERR_INVALID_URL_SCHEME`.

- [ ] **Step 4: Run the acceptance command against the fixture**

Run:

```bash
FIXTURE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
npm run verify:collections:acceptance -- --evidence tests/fixtures/complete-collections-acceptance.json --expected-commit "$FIXTURE_SHA"
```

Expected: `Collections acceptance verified` and `20/20 criteria`.

- [ ] **Step 5: Commit and push the repair**

```bash
git add tests/test_collections_acceptance_gate.test.js
git commit -m "test: read Collections evidence fixture from disk"
git push origin main
```

### Task 2: Provision isolated Render staging services

**Files:**
- Uses: `Dockerfile.admin`
- Uses: `apps/admin/.env.example`
- Uses: `scripts/python-tools/render_deployment_manager.py`

**Interfaces:**
- Consumes: commit SHA selected in Task 1 and Render workspace `tea-d09cc5je5dus73bbc5m0`.
- Produces: `Concierge-Collector-Admin-Staging` (web service) and `Concierge-Collector-Admin-Worker-Staging` (background worker), both pinned to the same SHA.

- [ ] **Step 1: Record the candidate SHA and Render baseline**

Run:

```bash
git rev-parse HEAD
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py list-services
```

Expected: record the 40-character SHA; do not reuse a mutable branch reference in staging evidence.

- [ ] **Step 2: Create the staging Admin Web service in Render**

In Render, create a Git-backed `web_service` in workspace `tea-d09cc5je5dus73bbc5m0` with: repository `https://github.com/wsmontes/Concierge-Collector.git`, branch `main`, Docker runtime, Dockerfile path `Dockerfile.admin`, and a dedicated staging name. Use its generated `onrender.com` URL as `CMS_PUBLIC_SERVER_URL` until a staging custom domain is available.

Set these environment variable names with staging-only values in the Render dashboard or API: `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME` ending in `-test`, `PAYLOAD_SECRET`, `CMS_SERVICE_KEY`, `CMS_PUBLIC_SERVER_URL`, `CMS_COLLECTOR_ORIGINS`, `FASTAPI_BASE_URL`, `METRICS_KEY`, `CMS_AUTH_ENABLED=false`, `CATALOG_SCAN_ENABLED=false`, `COLLECTIONS_ADMIN_ENABLED=false`, `COLLECTOR_ASSOCIATION_READ_ENABLED=false`, `COLLECTOR_DRAFT_MUTATION_ENABLED=false`, `CONSUMER_CREDENTIALS_ENABLED=false`, and `COLLECTIONS_DISTRIBUTION_ENABLED=false`.

- [ ] **Step 3: Create the staging Worker service**

Create a `background_worker` from the same repository, branch, Dockerfile, region, and staging CMS environment. Override only the container command with:

```sh
npm run start:admin-worker
```

Do not attach a public custom domain. Set the same shared CMS and service-key values as the staging Admin Web, plus `CMS_JOB_RECOVERY_STALE_SECONDS=180` and `CMS_JOB_MAX_RECOVERIES=3`.

- [ ] **Step 4: Verify builds and liveness without enabling features**

Store the two IDs returned by Render as shell variables for this session:

```bash
STAGING_ADMIN_ID='the Render ID returned for Concierge-Collector-Admin-Staging'
STAGING_WORKER_ID='the Render ID returned for Concierge-Collector-Admin-Worker-Staging'
STAGING_ADMIN_HOST='the generated onrender.com host for Concierge-Collector-Admin-Staging'
```

Run:

```bash
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py list-deploys "$STAGING_ADMIN_ID" --limit 3
concierge-api-v3/venv/bin/python scripts/python-tools/render_deployment_manager.py list-deploys "$STAGING_WORKER_ID" --limit 3
curl --fail --silent --show-error "https://$STAGING_ADMIN_HOST/health"
```

Expected: both latest deploys are `live`; the Admin `/health` endpoint succeeds; Collections endpoints remain disabled with the documented 503 response.

- [ ] **Step 5: Record service IDs and configuration keys**

Create a release record containing only service IDs, hostnames, SHA, environment variable *names*, timestamps, and flag values. Do not record values of credentials or Mongo URLs.

### Task 3: Produce staging qualification evidence

**Files:**
- Uses: `scripts/release/release-gate.mjs`
- Uses: `scripts/operations/cms-backup-restore-smoke.sh`
- Create: `docs/evidence/collections-staging.json`
- Uses: `docs/runbooks/collections-codex-integration-gate.md`

**Interfaces:**
- Consumes: live staging service IDs, staging test database, candidate SHA.
- Produces: a non-fixture evidence document that validates through `verifyCollectionsAcceptance`.

- [ ] **Step 1: Run the full local qualification gate against disposable resources**

Run `npm run verify:full` only after setting the documented local test values for `CMS_MONGODB_URL`, `CMS_MONGODB_DB_NAME` ending in `-test`, `CMS_SERVICE_KEY`, `PAYLOAD_SECRET`, `CMS_PUBLIC_SERVER_URL`, `FASTAPI_BASE_URL`, and `METRICS_KEY`.

Expected: all required root, admin, integration, and E2E gates complete without touching production MongoDB.

- [ ] **Step 2: Run migrations and restore smoke in staging**

Acquire the existing CMS migration lock, run `npm run migrate:cms:locked` once against staging, then run:

```bash
scripts/operations/cms-backup-restore-smoke.sh
```

Expected: migration is recorded once; restore smoke targets a `*-restore-test` destination and succeeds.

- [ ] **Step 3: Collect real staging gates**

Run the load, concurrency, crash/recovery, security and contract commands listed in `docs/runbooks/collections-codex-integration-gate.md`. Capture immutable log URLs or artifact paths for each of the 20 criteria, plus worker heartbeat, queue age, API, Mongo and storage health.

- [ ] **Step 4: Write and validate evidence**

Create `docs/evidence/collections-staging.json` with `environment: "staging"`, the candidate SHA, non-empty `runtimeGates`, and one `status: "pass"` evidence reference per criterion. Then run:

```bash
CANDIDATE_SHA=$(git rev-parse HEAD)
npm run verify:collections:acceptance -- --evidence docs/evidence/collections-staging.json --expected-commit "$CANDIDATE_SHA"
```

Expected: `Collections acceptance verified` and `20/20 criteria`.

- [ ] **Step 5: Commit evidence and release record**

Commit only the non-secret evidence and release record after checking that every reference is real staging output, not a copied test fixture.
