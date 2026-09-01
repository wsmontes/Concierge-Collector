# Claude qualification handoff — Architecture Baseline 1

This branch is a **candidate**, not a proven baseline. ChatGPT performed the architecture/static convergence and added regression contracts, but could not execute the complete checkout. Claude's job is to execute, diagnose, fix and re-run until the branch is genuinely green.

Target branch: `chore/local-release-gate`  
PR: `#6`  
Do not merge until every required qualification below is green.

## 1. Install

Use the repository-pinned Node/npm versions and Python 3.13.

```bash
npm ci --legacy-peer-deps
python3 -m pip install \
  -r concierge-api-v3/requirements.txt \
  -r concierge-api-v3/requirements-dev.txt
npx playwright install chromium
```

## 2. Start disposable local infrastructure

A MongoDB instance must be available at `127.0.0.1:27017` (or override the test URLs with another **test-only** instance).

The qualification databases are:

```text
concierge-collector-test
concierge-cms-test
```

Both names must end in `-test`. `verify:full` refuses unsafe names and the FastAPI Mongo fixtures have a second independent guard.

### FastAPI

Start FastAPI against the test database and in explicit development mode so `/auth/dev-login` is available to the E2E handoff:

```bash
cd concierge-api-v3
ENVIRONMENT=development \
MONGODB_URL=mongodb://127.0.0.1:27017 \
MONGODB_DB_NAME=concierge-collector-test \
API_SECRET_KEY=test-api-secret-key \
CMS_ADMIN_ORIGIN=http://127.0.0.1:3000 \
CMS_ADMIN_CALLBACK_URL=http://127.0.0.1:3000/auth/callback \
CMS_SERVICE_KEY=test-cms-service-key \
CATALOG_CURSOR_SECRET=test-catalog-cursor-secret \
METRICS_KEY=test-metrics-key \
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Development may use `API_SECRET_KEY` as the JWT fallback. Do not copy that fallback into production configuration.

### Admin web

From the repository root, start the Admin against its separate test database. Because a production-style Next server is fail-closed for staged Collections flags, enable the capabilities used by the qualification stack explicitly:

```bash
CMS_MONGODB_URL=mongodb://127.0.0.1:27017 \
CMS_MONGODB_DB_NAME=concierge-cms-test \
CMS_SERVICE_KEY=test-cms-service-key \
CMS_PUBLIC_SERVER_URL=http://127.0.0.1:3000 \
FASTAPI_BASE_URL=http://127.0.0.1:8000 \
METRICS_KEY=test-metrics-key \
PAYLOAD_SECRET=test-payload-secret-with-at-least-32-chars \
COLLECTIONS_ADMIN_ENABLED=true \
CONSUMER_CREDENTIALS_ENABLED=true \
COLLECTOR_ASSOCIATION_READ_ENABLED=true \
COLLECTOR_DRAFT_MUTATION_ENABLED=true \
npm run dev --workspace=@concierge/admin
```

### Admin worker

Run the worker with the same Admin environment values in another process:

```bash
CMS_MONGODB_URL=mongodb://127.0.0.1:27017 \
CMS_MONGODB_DB_NAME=concierge-cms-test \
CMS_SERVICE_KEY=test-cms-service-key \
CMS_PUBLIC_SERVER_URL=http://127.0.0.1:3000 \
FASTAPI_BASE_URL=http://127.0.0.1:8000 \
METRICS_KEY=test-metrics-key \
PAYLOAD_SECRET=test-payload-secret-with-at-least-32-chars \
COLLECTIONS_ADMIN_ENABLED=true \
CONSUMER_CREDENTIALS_ENABLED=true \
COLLECTOR_ASSOCIATION_READ_ENABLED=true \
COLLECTOR_DRAFT_MUTATION_ENABLED=true \
npm run start:worker --workspace=@concierge/admin
```

## 3. Run the standard gate

From the repository root:

```bash
npm run verify
```

Do not move on while this is red. Fix root cause, add/adjust a regression when appropriate, and rerun the full standard gate.

## 4. Run the full gate

Keep FastAPI, Admin and the worker running, then:

```bash
CMS_MONGODB_URL=mongodb://127.0.0.1:27017 \
CMS_MONGODB_DB_NAME=concierge-cms-test \
MONGODB_TEST_URL=mongodb://127.0.0.1:27017 \
MONGODB_TEST_DB_NAME=concierge-collector-test \
CMS_E2E_BASE_URL=http://127.0.0.1:3000 \
CMS_E2E_FASTAPI_URL=http://127.0.0.1:8000 \
npm run verify:full
```

The full gate must execute, not skip:

1. Admin integration tests;
2. API integration tests;
3. API real-Mongo tests with `--run-mongo`;
4. deterministic API E2E seed (`scripts/seed_e2e_curations.py`);
5. live CMS auth handoff E2E;
6. Explorer E2E;
7. Collection publish E2E with worker processing.

The seed is idempotent and guarantees at least three active Curations with `catalog_sequence` after the Mongo suite has run.

## 5. High-risk regressions to inspect if anything fails

Prioritize these boundaries rather than masking failures:

- `concierge-api-v3/app/api/auth.py`: one-shot OAuth state, refresh rotation, logout and first-login races;
- `concierge-api-v3/app/api/capture.py`: claim/lease/heartbeat, canonical writers, `human + draft + entity_id + source_id` semantics;
- `concierge-api-v3/app/api/curations.py`: live RBAC, legacy CAS and exhaustive semantic fallback;
- `concierge-api-v3/main.py`: provider sanitization and route-level live gates;
- `apps/admin/src/feature-flags.ts` / `payload.config.ts`: fail-closed staged rollout;
- `scripts/modules/curationAuthoringController.js`: ownership before mutable edit and one durability restore;
- Collection publish integration: lease takeover, fencing token and single promotion/audit.

Do not reintroduce the old Capture `status=linked` semantics. Linkage is `entity_id`; Capture creates a human `draft`.

Do not restore a recency-limited semantic fallback just to improve test/runtime speed. Correct recall is the Baseline 1 invariant.

## 6. Generated contracts

`npm run verify` runs `check:contracts`. If the semantic response schema change causes a generated contract mismatch, inspect the generated diff and regenerate only if it accurately reflects the intended `fallback_exhaustive` / `partial=false` contract.

Do not accept unrelated generated churn.

## 7. Identity migration dry runs

These steps target real operational data and therefore remain manual. **Dry-run first; do not apply automatically.** With the intended environment configured:

```bash
cd concierge-api-v3
python3 scripts/audit_user_identity_duplicates.py --database <target-db>
python3 scripts/purge_google_refresh_tokens.py
python3 scripts/ensure_user_identity_indexes.py --database <target-db>
```

Expected before apply:

- duplicate identity audit exits clean;
- purge reports the count but does not modify data;
- index migration reports what it would ensure but does not modify indexes.

Only after human review may the explicit `--apply` forms be used for purge/index installation.

## 8. Production rollout flags

FastAPI and Payload/Admin now enforce the staged rollout server-side. In staging/production, and when the environment is unclassified, missing flags are disabled.

Before deployment, explicitly choose values for:

```text
CMS_AUTH_ENABLED
CATALOG_SCAN_ENABLED
COLLECTIONS_ADMIN_ENABLED
COLLECTOR_ASSOCIATION_READ_ENABLED
COLLECTOR_DRAFT_MUTATION_ENABLED
CONSUMER_CREDENTIALS_ENABLED
COLLECTIONS_DISTRIBUTION_ENABLED
```

Ownership/removal metadata is in `config/collections-feature-flags.json`. Do not simply set every flag to true without deciding the intended rollout state.

## 9. Promotion criteria

Architecture Baseline 1 is qualified only when:

- `npm run verify` passes from a clean checkout;
- `npm run verify:full` passes with no relevant suite skipped;
- Mongo and E2E targets are confirmed disposable/test-only;
- auth handoff, refresh/logout and live role revocation are green;
- Collection worker/publish takeover/fencing coverage is green;
- generated contracts are clean;
- applicable identity migration dry runs are reviewed;
- no production feature flag is relying on an accidental default.

After that, update `docs/ARCHITECTURE_BASELINE_1.md` from `candidate` to the chosen qualified status, then PR #3/#4 can be closed as superseded by PR #6. Merge PR #6 only with explicit owner approval.
