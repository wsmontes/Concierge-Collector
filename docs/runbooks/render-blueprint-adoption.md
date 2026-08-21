# Render Blueprint Adoption — Collections

This runbook adopts the versioned Render topology without inventing image digests or implicitly replacing the two existing production services.

## Safety rules

- `render.yaml` is generated only after successful API and Admin image builds produce real `sha256:<64 hex>` registry digests.
- Until those digests exist, **do not commit a placeholder render.yaml**. Keep `scripts/release/materialize-render-blueprint.mjs` as the versioned source of the target topology.
- The existing `Concierge-Collector` API service remains available as the rollback path while the image-backed `Concierge-Collector-API-V3` canary is validated.
- Web and worker use the exact same Admin image digest. They have different commands and may use different Mongo credentials even though both credentials are supplied as `CMS_MONGODB_URL`.
- Secrets are provisioned in Render, never written into the Blueprint or promotion receipt.

## Target deployables

1. `Concierge-Collector-Web` — static Collector built into `dist/collector`.
2. `Concierge-Collector-API-V3` — prebuilt `ghcr.io/wsmontes/concierge-api@sha256:...` image.
3. `Concierge-Collector-Admin` — prebuilt `ghcr.io/wsmontes/concierge-admin@sha256:...` image.
4. `Concierge-Collector-Admin-Worker` — the same Admin digest, running the Payload jobs worker command.

## Health and readiness

- API liveness is separate from readiness. Render must use `GET /api/v3/ready` as the API health check before traffic moves to the new deploy.
- Admin uses `GET /ready`; this checks the CMS dependencies expected by the application and never runs migrations.
- The background worker has no public Render health check. The Admin exposes `GET /health/worker`, which reads the durable worker heartbeat. Rollout waits for this endpoint after the worker image deploy.
- `GET /health` remains a process-level liveness endpoint and must not substitute for readiness during promotion.

## CMS migrations

The Admin web service runs `npm run migrate:cms:locked` as its pre-deploy command. The command must acquire the CMS migration lock and execute forward-only, idempotent Payload migrations exactly once for the release. Web and worker startup never run migrations as a side effect.

If a migration fails, the Admin deployment fails before traffic promotion. Do not start the worker against a schema whose migration step has failed.

## Materialize the Blueprint

After the successful CI/local-equivalent build has produced both real image digests:

```bash
node scripts/release/materialize-render-blueprint.mjs \
  --api-digest "$API_DIGEST" \
  --admin-digest "$ADMIN_DIGEST"

render blueprints validate render.yaml
```

The materializer rejects tags, variables, short hashes and malformed digests. `render.yaml` contains literal registry digest URLs and can then be committed as the reviewed desired state for that release.

Before adopting the Blueprint against production, compare the Render inventory with the known existing services and domains. Creating a canary API is intentional; recreating or renaming the existing production API/static service is not.

## Immutable promotion

Promotion is sequential and uses the Render API with an exact image URL:

```bash
export RENDER_API_TOKEN='...'
export RENDER_API_SERVICE_ID='...'
export RENDER_ADMIN_SERVICE_ID='...'
export RENDER_WORKER_SERVICE_ID='...'
export RENDER_API_READY_URL='https://api.concierge-collector.com/api/v3/ready'
export RENDER_ADMIN_READY_URL='https://admin.concierge-collector.com/ready'
export RENDER_WORKER_READY_URL='https://admin.concierge-collector.com/health/worker'

node scripts/release/promote-render-images.mjs \
  --environment staging \
  --api-digest "$API_DIGEST" \
  --admin-digest "$ADMIN_DIGEST"
```

The script records each new deploy ID and the previous deploy ID in a receipt, waits for Render to report the deploy `live`, then checks the appropriate application readiness endpoint. It stops before the next service on failure.

## Domain cutover

Do not move production domains until the image-backed API/Admin/worker have passed staging evidence and the production canary is healthy. During the API cutover, preserve the old `Concierge-Collector` service without the custom API/capture domains so it remains available for rollback.

After a successful production promotion, reconcile `render.yaml` with the exact promoted digests in the same release record. Never replace digest URLs with a mutable `latest`, `main`, or `production` tag.
