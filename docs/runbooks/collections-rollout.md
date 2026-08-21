# Collections Rollout

Production rollout is progressive and server-controlled. Browser/UI flags are never the authorization boundary.

## Preconditions

- `npm run quality:local` exits zero, or equivalent CI evidence exists for the exact source commit.
- API and Admin images exist for that commit with SBOM/provenance and real registry digests.
- `render.yaml` has been materialized from those exact digests and validated in staging.
- Staging evidence includes E2E, concurrency/restart, load/chaos and the CMS backup/restore smoke.
- A promotion receipt location and rollback owner are chosen before production changes begin.

## Rollout order

1. **DB roles and secrets**
   - Provision the operational API credential, CMS read-only API credential, Payload web credential and Payload worker credential with their intended privileges.
   - Provision `CMS_SERVICE_KEY`, metrics/cursor/signing keys and private artifact storage credentials independently.
   - Keep every Collections rollout flag `false` in staging/production initially.

2. **Migrations and indexes**
   - Materialize the release Blueprint with the real digests.
   - Run/verify `npm run migrate:cms:locked` through the Admin pre-deploy step.
   - Verify required CMS/operational indexes and readiness before enabling product features.

3. **Deploy Admin and worker with features off**
   - Deploy the exact Admin digest to web and worker.
   - Require `/ready` = 2xx and `/health/worker` = 2xx.
   - Verify the `maintenance` queue is processing scheduled heartbeat/reconciliation/retention tasks.

4. **CMS handoff**
   - Enable `CMS_AUTH_ENABLED=true` for canary administrators only after FastAPI and Admin are healthy.
   - Validate one-shot handoff, host-only session, live role downgrade/revocation and logout.

5. **Catalog scan**
   - Finish/verify `catalog_sequence` backfill and unique/scan indexes.
   - Enable `CATALOG_SCAN_ENABLED=true`.
   - Validate high-water scan/retry behavior before Collections CRUD is opened.

6. **Collections Admin**
   - Enable `COLLECTIONS_ADMIN_ENABLED=true` for the canary environment/users.
   - Create, edit, publish and archive a test Collection; prove draft changes do not alter the current published version until explicit publish.
   - Verify worker restart/lease reconciliation and no partial promotion.

7. **Load, chaos and backup/restore smoke**
   - Run the 50k Explorer/selection workload and record performance/storage evidence.
   - Exercise worker checkpoint interruption/restart.
   - Run the CMS **backup/restore smoke** into a database whose name ends in `-restore-test`; verify counts/version/membership invariants before proceeding.

8. **Consumer credentials and canary distribution**
   - Enable `CONSUMER_CREDENTIALS_ENABLED=true` for the canary Admin.
   - Issue a canary credential and verify show-once/revocation.
   - Enable `COLLECTIONS_DISTRIBUTION_ENABLED=true` only for the canary environment/application path and validate page/dump/live-hydration behavior.

9. **Collector integration**
   - Enable `COLLECTOR_ASSOCIATION_READ_ENABLED=true` first and validate view-only association reads for viewer/curator/admin.
   - Then enable `COLLECTOR_DRAFT_MUTATION_ENABLED=true` for canary admins; validate exactly-one-Curation operations, conflicts, locking and retry behavior.

10. **General published read**
    - Expand `COLLECTOR_ASSOCIATION_READ_ENABLED` after canary evidence remains healthy.
    - Keep admin mutation narrower until operation/worker metrics are stable.

11. **Credential rollout**
    - Expand consumer applications/credentials gradually by application/Collection scope.
    - Do not cache authorization in a way that delays revocation.

## Promotion commands

Build/verification source of truth:

```bash
npm run quality:local
```

Materialize only after successful image builds provide real digests:

```bash
node scripts/release/materialize-render-blueprint.mjs \
  --api-digest "$API_DIGEST" --admin-digest "$ADMIN_DIGEST"
render blueprints validate render.yaml
```

Promote the same digest validated in staging:

```bash
node scripts/release/promote-render-images.mjs \
  --environment production \
  --api-digest "$API_DIGEST" \
  --admin-digest "$ADMIN_DIGEST"
```

Do not proceed to the next flag when the previous stage lacks its required evidence. A skipped GitHub Actions run is not evidence; while Actions remains unavailable, retain the output from `npm run quality:local` for the exact commit.
