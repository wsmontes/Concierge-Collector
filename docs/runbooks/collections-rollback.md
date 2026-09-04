# Collections rollback runbook

## Principle

Rollback is primarily a capability rollback, not a data rollback. Disable server-side flags first, preserve durable Collection/version history, and only change deployment artifacts after the product surface is safe.

Do not reverse migrations destructively in production. Data/schema fixes are forward-only unless a separately reviewed recovery procedure proves the reverse operation safe.

## Immediate containment

When impact is external distribution only:

1. Set `COLLECTIONS_DISTRIBUTION_ENABLED=false`.
2. Confirm distribution endpoints fail closed while Admin/worker state remains inspectable.
3. Revoke the affected consumer credential/application if the incident is scoped to one consumer.

When consumer credential administration itself is unsafe:

1. Set `COLLECTIONS_DISTRIBUTION_ENABLED=false`.
2. Set `CONSUMER_CREDENTIALS_ENABLED=false`.
3. Existing credential records remain stored; do not delete hashes or audit history during containment.

When Collector mutations are unsafe:

1. Set `COLLECTOR_DRAFT_MUTATION_ENABLED=false`.
2. Leave `COLLECTOR_ASSOCIATION_READ_ENABLED=true` only if published reads are confirmed healthy.
3. Existing queued operations are not manually deleted. Inspect `/admin/operations`, allow safely resumable work to finish, or cancel only pre-commit operations.

When published association reads are unsafe:

1. Set `COLLECTOR_DRAFT_MUTATION_ENABLED=false`.
2. Set `COLLECTOR_ASSOCIATION_READ_ENABLED=false`.

When Collections Admin/worker behavior is unsafe:

1. Disable all downstream flags above.
2. Set `COLLECTIONS_ADMIN_ENABLED=false`.
3. Keep CMS authentication enabled only if it is independently healthy and needed for incident inspection.
4. Do not remove staged rows manually while a resumable operation/job exists.

When catalog scan is implicated:

1. Disable Collections Admin/downstream capabilities.
2. Set `CATALOG_SCAN_ENABLED=false`.
3. Existing immutable manifests may expire by their existing retention policy; do not mutate a ready manifest in place.

When CMS authentication is implicated:

1. Disable all Collections capabilities.
2. Set `CMS_AUTH_ENABLED=false`.
3. Fix/rotate the affected CMS session/service credentials as appropriate.

## Collection-level rollback

If the incident is isolated to one Collection:

- Archive the Collection as the first kill switch. This preserves the current published version and makes public current/exact/dump reads return `410`.
- Restore the Collection when it is safe; restore must expose the same published version again.
- If content should return to a historical version, use **Restore as draft**, inspect the resulting draft delta, then perform a normal publish. Never rewrite `currentPublishedVersion` or membership intervals by hand.

## Job recovery rules

The maintenance reconciler is conservative:

- it may reopen the **same** Payload job only when the domain record is still resumable, its lease is reclaimable and the Payload job is proven stale/exhausted;
- `meta.recoveryCount` bounds automatic recovery cycles;
- it does not manufacture a missing Payload job;
- it does not purge staged rows for a non-terminal operation;
- it does not cancel children that already crossed the commit barrier.

If a job is classified as missing/exhausted by recovery, treat it as an operator incident. Do not create an ad-hoc duplicate job before inspecting the domain record, Payload job collection, audit trail and published pointer.

## Artifact/application rollback

If the code artifact itself must be rolled back:

1. Disable the affected product flags first.
2. Record the current commit/image digest and the previously qualified digest.
3. Re-deploy the previously qualified immutable artifact without rebuilding it.
4. Verify `/ready`, worker heartbeat, queue health and migrations/index compatibility.
5. Re-enable capabilities only through the normal rollout order after qualification.

A deployment rollback must not run a destructive migration down command or delete data introduced by the newer version.

## Verification after rollback

At minimum verify:

- disabled endpoints fail closed;
- unaffected read paths still work;
- no Collection published pointer changed unexpectedly;
- no published membership interval was deleted/re-written;
- worker heartbeat and queue age are understood (healthy or intentionally stopped);
- pre-commit cancellations did not affect committing/terminal children;
- audit history remains available;
- consumer credentials remain revocable;
- archived Collection behavior is `410`, not `404` or accidental live distribution.

Record incident timestamp, flags changed, Collections/applications affected, job IDs, deployed SHA/digest and recovery actions. Any data correction after containment is a separate audited forward change.
