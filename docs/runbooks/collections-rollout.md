# Collections rollout runbook

## Purpose

Enable Collections gradually without coupling product rollout to deployment. Every production capability is protected by a server-side feature flag. A deploy may contain the code while every Collections flag remains off.

This runbook does not authorize a Render Blueprint adoption or service recreation. Deployment topology changes require a separately reviewed inventory of the existing Render services, IDs, domains and runtimes.

## Non-negotiable gates

Before the first production flag is enabled:

1. The candidate commit is immutable and identified by a 40-character Git SHA.
2. `npm run verify:full` passes against disposable `*-test` databases and the full local/staging stack.
3. CMS migrations run once under the existing migration lock and complete successfully.
4. `scripts/operations/cms-backup-restore-smoke.sh` passes against a `*-restore-test` destination.
5. Staging load, concurrency, crash/recovery, security and contract evidence is recorded.
6. `docs/evidence/collections-staging.json` is produced from real staging results for that exact commit.
7. `npm run verify:collections:acceptance -- --evidence docs/evidence/collections-staging.json --expected-commit <SHA>` passes all 20 normative criteria.
8. Worker heartbeat, queue age, error rate, Mongo health, FastAPI health and storage health are observable before traffic is enabled.

The evidence file is an output of staging qualification. Do not copy the test fixture into `docs/evidence` and do not mark a criterion as `pass` without an executed evidence reference.

## Flag order

The versioned flag ownership/removal metadata is in `config/collections-feature-flags.json`. Staging and production fail closed when an override is absent.

Enable in this order, stopping after each step until health and invariants are verified:

1. `CMS_AUTH_ENABLED=true`
   - CMS session handoff and server-side introspection only.
   - Verify login, logout/session expiry and role downgrade.
2. `CATALOG_SCAN_ENABLED=true`
   - Enables the server-side catalog scan used by large Explorer selections.
   - Verify scans remain bounded and manifests are resumable.
3. `COLLECTIONS_ADMIN_ENABLED=true`
   - Enables Collections CRUD commands, Explorer/Bulk, publish and Operations Admin.
   - Keep Collector mutation and external distribution disabled.
4. `COLLECTOR_ASSOCIATION_READ_ENABLED=true`
   - Exposes published association reads in the Collector.
   - Verify this remains read-only for non-admin users.
5. `COLLECTOR_DRAFT_MUTATION_ENABLED=true`
   - Enables the single-Curation admin mutation from Collector cards.
   - Verify it enters the same operation queue/CAS path as Admin bulk actions.
6. `CONSUMER_CREDENTIALS_ENABLED=true`
   - Enables application/credential administration.
   - Issue only canary consumer credentials first.
7. `COLLECTIONS_DISTRIBUTION_ENABLED=true`
   - Enables consumer-facing Collection distribution last.
   - Verify allowlists, 401/404/410/429 behavior and live hydration before widening consumers.

Never enable a downstream flag while a prerequisite is unhealthy.

## Canary procedure

For each production flag:

1. Record candidate SHA, flag change, operator, timestamp and previous value.
2. Enable the flag for the smallest supported canary scope/environment.
3. Exercise the corresponding smoke path.
4. Observe at least:
   - worker heartbeat and queue age;
   - operation/publish failures and retries;
   - Mongo/FastAPI/storage errors;
   - selected/available/unavailable counts where applicable;
   - unexpected `409`, `412`, `423`, `5xx` or authorization failures.
5. If healthy, proceed to the next flag. If not, execute `docs/runbooks/collections-rollback.md` immediately.

## Collection-level kill switch

If one published Collection is bad while the platform is healthy, archive that Collection instead of disabling the whole platform. Archive is reversible and preserves version history. It must produce `410` on public current/exact/dump reads until restored.

## Data rules during rollout

- Never hard-delete a Collection that has ever been published.
- Never rewrite published membership intervals to repair a rollout issue.
- A historical restore produces a new draft for review; it does not silently move the published pointer.
- Forward data corrections use an explicit migration/command and audit event.
- Consumer credentials remain individually revocable; do not share a platform-wide consumer secret.
- Collections remain online-only in the Collector; no Collection data enters Dexie or the existing offline sync queue.

## Completion

Rollout is complete only when all enabled flags are recorded, canary credentials/users have been widened intentionally, and the staging acceptance evidence for the deployed commit is retained with the release record.
