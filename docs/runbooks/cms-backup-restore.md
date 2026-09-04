# CMS Backup / Restore Smoke Runbook

## Purpose

Prove that the `concierge-cms` MongoDB data needed by Collections can be dumped and restored into an isolated namespace without changing the source database.

This is a release/operations check, not an application startup step. Web and worker processes never run `mongodump`, `mongorestore`, or migrations automatically.

## Safety properties

`scripts/operations/cms-backup-restore-smoke.sh` fails before restore unless all of the following are true:

- source and destination database names are supplied explicitly;
- the restore database name ends with `-restore-test`;
- restore database/URI do not contain `prod`/`production`;
- source and destination are not the same namespace;
- `mongodump`, `mongorestore`, and `mongosh` are installed;
- the source invariant snapshot is identical before and after the dump.

The script never prints MongoDB URIs. The temporary compressed archive is deleted by a shell trap.

## What the smoke verifies

The comparison covers both broad and domain-specific state:

1. document counts for every non-system collection;
2. Collection lifecycle/version/draft/revision counters;
3. immutable CollectionVersion selected counts and membership hashes.

A mismatch fails the smoke. The restored test database remains available for explicit operator inspection.

## Prerequisites

Use a staging/test source or a deliberately quiesced production backup source. Stop CMS write traffic and the Payload Worker while the source signature + dump is taken. A changing source causes an intentional failure rather than ambiguous evidence.

MongoDB Database Tools and `mongosh` must be installed on the operator machine.

## Run

```bash
export CMS_BACKUP_SOURCE_URL='mongodb+srv://...'
export CMS_BACKUP_SOURCE_DB='concierge-cms-staging'
export CMS_RESTORE_TEST_URL='mongodb+srv://...'
export CMS_RESTORE_TEST_DB='concierge-cms-restore-test'

bash scripts/operations/cms-backup-restore-smoke.sh
```

Expected terminal line:

```text
CMS backup/restore smoke passed for isolated restore namespace concierge-cms-restore-test.
```

Do not paste MongoDB URIs into tickets, logs, PR descriptions, or screenshots.

## Inspect

After a passing smoke, inspect the restored namespace with read-only queries as needed:

```javascript
use concierge-cms-restore-test

db.collections.countDocuments({})
db.collection_versions.countDocuments({ status: 'published' })
db.collection_memberships.countDocuments({})
db.audit_events.countDocuments({})
db.audit_archive_manifests.countDocuments({})
db.collection_operations.countDocuments({ 'itemArchive.itemsPurgedAt': { $exists: true } })
db.collection_operations.countDocuments({ 'itemArchive.retentionBlockedAt': { $exists: true } })
db.collection_exports.countDocuments({ cleanupAttempts: { $gt: 0 } })
```

For a known published Collection, verify that `currentPublishedVersion`, the corresponding `collection_versions.membershipHash`, and membership interval counts agree with the source evidence.

For operational retention evidence, inspect representative records rather than assuming a lower row count is sufficient proof:

- `audit_archive_manifests` count/SHA/key metadata;
- operation `itemArchive` count/status/reason/SHA plus purge/quarantine metadata;
- export `cleanupAttempts`, `cleanupLastAttemptAt`, `cleanupNextAttemptAt` where storage cleanup has retried.

## Cleanup

Drop only the explicitly named restore-test database after inspection. Never parameterize cleanup from the source database variable.

```javascript
use concierge-cms-restore-test
db.dropDatabase()
```

## Failure handling

- **Source changed during dump:** keep source untouched, quiesce Web/Worker writes, retry.
- **Restore namespace guard failed:** choose a new database ending in `-restore-test`; do not relax the guard.
- **Invariant mismatch:** keep restored DB for investigation, do not promote a release, compare collection counts and CollectionVersion hashes.
- **Missing database tools:** install MongoDB Database Tools / `mongosh`; do not replace the smoke with an unverified copy.
- **Operational evidence unexpectedly absent:** do not infer loss from counts alone; compare the original namespace and relevant maintenance/archival records before promotion.

## Retention notes

Operational retention is conservative and must not undermine restore evidence:

- Worker heartbeats are retained for seven days by the operational-retention migration.
- Export records do not use Mongo TTL. `expiresAt` is a maintenance scan key; private object deletion must succeed before the CMS reference is removed.
- Failed export object deletion records bounded cleanup backoff. The reference remains authoritative until a later successful DeleteObject + CMS deletion.
- Staged draft rows older than `CMS_ORPHAN_STAGING_RETENTION_DAYS` are purged only when their owning operation is terminal or missing.
- Terminal operation-item detail is compacted only after the parent stores deterministic counts/SHA evidence. Purge bookkeeping does not renew semantic `updatedAt`.
- Permanent intact-evidence contradictions are preserved under `itemArchive.retentionBlocked*`; quarantine means “operator review required”, not “evidence deleted”.
- Admin audit events older than `CMS_AUDIT_RETENTION_DAYS` are archived to private deterministic NDJSON-gzip and manifested before hot-row deletion; `audit_events` itself has no TTL.
- Audit archive manifest mismatch is an integrity incident and intentionally blocks forward archival rather than being skipped.
- Collection versions, membership intervals, applications and credentials have no TTL.

The closeout migration tail through `20260904_016_operation_retention_quarantine` must be present in the source before production readiness is considered valid.
