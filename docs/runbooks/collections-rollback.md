# Collections Rollback

Rollback is designed to stop exposure first, restore the previously proven runtime second, and preserve data/history for diagnosis.

## 1. Disable server-side flags first

Turn off the narrowest affected flag before changing images:

- `COLLECTOR_DRAFT_MUTATION_ENABLED=false` stops Collector writes while leaving published reads available.
- `COLLECTOR_ASSOCIATION_READ_ENABLED=false` removes Collector association reads.
- `COLLECTIONS_DISTRIBUTION_ENABLED=false` stops consumer distribution.
- `CONSUMER_CREDENTIALS_ENABLED=false` stops credential administration.
- `COLLECTIONS_ADMIN_ENABLED=false` stops Admin Collection endpoints.
- `CATALOG_SCAN_ENABLED=false` stops the Admin catalog boundary.
- `CMS_AUTH_ENABLED=false` stops new CMS handoffs.

These are server-side gates. Hiding buttons in the Collector/Admin is not a rollback control.

## 2. Use the promotion receipt

Every promotion receipt produced by `scripts/release/promote-render-images.mjs` contains, per service:

- `serviceId`
- the new `deployId`
- `previousDeployId`
- the exact immutable image URL deployed

Use `previousDeployId` as the rollback target for the affected API/Admin/worker service. Do not guess a tag or rebuild a supposedly equivalent image.

Render supports rolling a service back to a previous deploy. If using the Render API, send the recorded `previousDeployId` to the service rollback endpoint and wait for the resulting deploy plus application readiness before proceeding to another service.

## 3. Roll back in dependency-safe order

For a UI/Admin regression with a healthy API:

1. Disable mutation/affected feature flags.
2. Roll back worker if a job implementation is implicated.
3. Roll back Admin web to its recorded previous deploy.
4. Verify `/ready` and `/health/worker`.

For an API/distribution regression:

1. Disable distribution/Collector/CMS boundary flags as appropriate.
2. Move API traffic back to the preserved prior API service or roll the image-backed API to its recorded prior deploy.
3. Verify `/api/v3/ready` before restoring any flag.

## 4. Do not roll migrations backward

**Do not roll migrations backward** during operational rollback. Migrations are expand/contract, forward-only and versioned. The prior runtime must tolerate the expanded schema during the rollout window.

If a migration itself is defective, stop feature exposure and deploy a new forward repair migration. Do not manually delete indexes/collections or restore an old database over the live database as a routine rollback mechanism.

## 5. Published state rollback

Never mutate version history to imitate a code rollback. If a bad Collection publication reached users:

- use the audited Collection operation that restores the intended historical version as a new draft/publish operation, or
- archive the Collection as the immediate external kill switch.

The **published pointer** changes only through the normal audited domain path. Historical membership intervals and versions remain intact.

## 6. Data recovery is separate

The CMS backup/restore procedure restores only into an isolated `*-restore-test` database during rehearsal. A production restore is a disaster-recovery decision, not part of ordinary release rollback.

Before re-enabling flags after rollback, verify:

- API/Admin readiness;
- worker heartbeat and backlog;
- no resumable job was incorrectly promoted;
- current published pointers/hashes/counts are consistent;
- the incident and chosen `previousDeployId` values are attached to the release record.
